# mesure-impact

CronJob de collecte **Matomo → Grist** et tableau de bord statique, déployés sur Kubernetes
par GitHub Actions.

`devbox install && task` suffit à savoir quoi faire. Toutes les commandes vivent dans
[Taskfile.yml](Taskfile.yml) — la doc n'en recopie aucune.

## État

Le socle est **multitenant** : chaque `produits/<dept>/<nom>/` reçoit son CronJob, son
SealedSecret et son URL de dashboard. Un seul produit est câblé à ce jour, **BASAVI**. Les
CronJobs restent déployés avec `suspend: true` tant que les tokens ne sont pas scellés.

`produit.yaml` déclare ses `envs` et un `site_id`/`doc_id` par env. BASAVI ne cible que `dev` :
la prod ne reçoit donc aucun CronJob tant que son site Matomo et son doc Grist n'existent pas.
C'est voulu — mieux vaut zéro collecte qu'une prod qui collecte la préprod.

## Cible de déploiement

| | |
|---|---|
| Cluster | `ovh-dev` (`c-m-97jxtvnv`), Rancher `https://rancher.fabrique.social.gouv.fr` |
| Projet Rancher | `mesure-impact` — `c-m-97jxtvnv:p-mrmrt` |
| Namespaces | `mesure-impact-dev`, `mesure-impact-prod` |
| URLs | `mesure-impact-dev.ovh.fabrique.social.gouv.fr`, `mesure-impact.ovh.fabrique.social.gouv.fr` |
| Images | `ghcr.io/socialgouv/mesure-impact-{cron,web}:sha-<gitsha>` |

Les deux envs cohabitent sur `ovh-dev`. `prod` n'est pas sur le cluster `ovh-prod` : c'est un
choix assumé pour démarrer, à réviser quand l'application portera un enjeu de production.

⚠️ Toujours passer `--context ovh-dev` explicitement — ne jamais se fier au contexte courant.

### Namespaces — créés hors CI, une seule fois

Ils portent deux métadonnées indispensables, posées **à la création** :

- annotation `field.cattle.io/projectId: c-m-97jxtvnv:p-mrmrt` → rattachement au projet
  Rancher, d'où le bot tire ses droits ;
- label `cert: wildcard` → Kyverno (`copy-wildcard-secret`) y recopie le certificat
  `wildcard-crt` utilisé par les Ingress.

Le chart ne gère pas les namespaces : un namespace créé par la CI n'hériterait pas de
l'annotation projet, et le bot perdrait ses droits dessus.

Piège éprouvé : la génération Kyverno du `wildcard-crt` ne part pas toujours au CREATE du
namespace. Un `kubectl label ns <ns> cert=wildcard --overwrite` la redéclenche.

## Authentification CI

Le secret de repo `KUBECONFIG` contient, **en base64**, le kubeconfig d'un bot Rancher :

- user local Rancher `rancherbot-ci-mesure-impact` (`u-h4dmz`) ;
- deux `projectRoleTemplateBinding` sur `c-m-97jxtvnv:p-mrmrt` :
  `project-member` et `rt-c7bjb` (rôle `sealed-secrets`, CRUD sur `bitnami.com/sealedsecrets`).

Périmètre exact, dérivé des bindings RBAC réels et confirmé par `SubjectAccessReview` :

- écriture **uniquement** dans `mesure-impact-dev` et `mesure-impact-prod` ;
- lecture cluster en `get/list/watch` seulement : `nodes`, `persistentvolumes`,
  `storageclasses`, `apiservices`, `clusterrepos`, `navlinks` — l'empreinte standard d'un
  `project-member` Rancher ;
- `create namespaces` à l'échelle du cluster (ClusterRole `create-ns`, posé par Rancher).
  Droit de création seul : le bot n'a ni `get`, ni `patch`, ni `delete` sur un namespace
  hors de ses deux, et ne peut pas rapatrier un namespace existant dans son projet
  (`patch` refusé sur tout namespace étranger). Il peut donc créer un namespace vide
  inutilisable — nuisance, pas accès ;
- aucune escalade : `clusterroles`, `clusterrolebindings`, `roles`, `rolebindings`,
  `escalate`, `bind`, `impersonate`, CSR, webhooks d'admission, CRD, ClusterPolicy Kyverno
  → tous refusés ;
- aucune lecture transverse : `list secrets|configmaps|pods|serviceaccounts` cluster-wide
  → refusés ;
- aucun `globalRoleBinding` ni `clusterRoleTemplateBinding` côté Rancher, et **zéro binding
  sur le cluster `ovh-prod`** : un kubeconfig `ovh-prod` frappé avec ce compte
  s'authentifierait mais n'autoriserait rien.

Le token n'expire pas : le cluster a `kubeconfig-default-token-ttl-minutes=0` et
`auth-token-max-ttl-minutes=0`.

**Le mot de passe du bot n'est stocké nulle part.** Pour regénérer le kubeconfig, voir
l'en-tête de [scripts/regen-kubeconfig.sh](scripts/regen-kubeconfig.sh) : il documente le
reset admin `POST /v3/users/u-h4dmz?action=setpassword`.

## Secrets applicatifs — SealedSecrets

**Un secret par produit et par env.** `PRODUIT=<dept>/<nom> ENV=<env> task seal` lit les deux
tokens depuis l'environnement et produit
`produits/<dept>/<nom>/secrets/<env>.sealedsecret.yaml` — c'est ce fichier chiffré qui est
commité. **Le dépôt est public** : rien d'autre qu'un SealedSecret ne doit y figurer.

Seuls `MATOMO_TOKEN_AUTH` et `GRIST_API_KEY` sont scellés. Les quatre pointeurs
(`MATOMO_URL`, `MATOMO_SITE_ID`, `GRIST_URL`, `GRIST_DOC_ID`) viennent de `produit.yaml` et
sont injectés en clair : corriger un site ou un doc doit rester une PR relisible.

Scellés avec `--scope cluster-wide` (portable d'un namespace à l'autre), contre
`https://kubeseal.ovh.fabrique.social.gouv.fr/v1/cert.pem`.

Une variable manquante fait échouer le job bruyamment, elle n'est jamais compensée par une
valeur par défaut. Une fois les secrets en place, repasser `cron.suspend` à `false` dans
`envs/<env>/values.yaml`.

## Images

Packages ghcr **publics** → aucun `imagePullSecret` côté cluster. Si un package repasse en
privé, il faut créer un secret `ghcr-pull` dans chaque namespace (c'est ce que font les
namespaces `*-debug-demo` du cluster).

`docker/web` part de `nginx-unprivileged` : uid 101, écoute sur 8080, `/tmp` et
`/var/cache/nginx` montés en `emptyDir` pour rester compatible `readOnlyRootFilesystem`. Une
étape de build publie chaque `produits/*/*/dashboard.html` sous `/<dept>/<nom>/` — c'est
l'URL que le doc Grist charge comme widget.

Les deux images doivent déclarer un `USER` **numérique** non-root : avec `runAsNonRoot`, le
kubelet doit pouvoir constater que l'utilisateur n'est pas root sans résoudre `/etc/passwd`.
La CI le vérifie et casse la PR sinon.

## CI

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) : push sur `main` → `dev` ;
`workflow_dispatch` avec choix d'env → `dev` ou `prod`. Build des deux images en matrice,
puis `kubectl apply` des sealed secrets et `helm upgrade --install --atomic`.

L'org SocialGouv est en `actions.enabled_repositories = "selected"` : un repo neuf doit être
inscrit explicitement (`PUT /orgs/SocialGouv/actions/permissions/repositories/<id>`). C'est
fait pour celui-ci.

## Documentation & conventions

La doc du dépôt vit dans [doc/](doc/) : `produit.md` (fonctionnel), `architecture.md`
(technique), `conventions.md` (contribution), `decisions/` (choix structurants). Deux règles :

- **Au démarrage d'une issue ou d'une tâche** : lire `doc/` pour le contexte avant d'agir.
- **Avant d'ouvrir une PR** : mettre à jour la page `doc/` concernée si le comportement, une
  décision ou la structure change.

Les tableaux de bord vivent dans `produits/<département>/<produit>/` (un dossier par produit,
cf. [produits/README.md](produits/README.md)). Le collecteur du CronJob est
`docker/cron/collect.mjs` : il importe aujourd'hui l'ETL du seul produit pilote (Node pur,
contrat de variables commun décrit dans `doc/architecture.md`).
