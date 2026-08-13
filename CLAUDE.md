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
| Projets Rancher | `mesure-impact-dev` (`p-mrmrt`), `mesure-impact-prod` (`p-bxkq6`) |
| Namespaces | `mesure-impact-dev`, `mesure-impact-prod` |
| URLs | `mesure-impact-dev.ovh.fabrique.social.gouv.fr`, `mesure-impact.ovh.fabrique.social.gouv.fr` |
| Images | `ghcr.io/socialgouv/mesure-impact-{cron,web}:sha-<gitsha>` |
| Chart OCI | `oci://ghcr.io/socialgouv/mesure-impact/charts`, version `0.0.0-sha.<sha8>` |
| GitOps | [SocialGouv/mesure-impact-gitops](https://github.com/SocialGouv/mesure-impact-gitops) |

Les deux envs cohabitent sur `ovh-dev`. `prod` n'est pas sur le cluster `ovh-prod` : c'est un
choix assumé pour démarrer, à réviser quand l'application portera un enjeu de production.

⚠️ Toujours passer `--context ovh-dev` explicitement — ne jamais se fier au contexte courant.

### Namespaces — créés hors CI, une seule fois

Ils portent deux métadonnées indispensables, posées **à la création** :

- annotation `field.cattle.io/projectId` → rattachement au projet Rancher de l'env, d'où le
  bot de cet env tire ses droits ;
- label `cert: wildcard` → Kyverno (`copy-wildcard-secret`) y recopie le certificat
  `wildcard-crt` utilisé par les Ingress.

Le chart ne gère pas les namespaces : un namespace créé par la CI n'hériterait pas de
l'annotation projet, et le bot perdrait ses droits dessus.

Piège éprouvé : la génération Kyverno du `wildcard-crt` ne part pas toujours au CREATE du
namespace. Un `kubectl label ns <ns> cert=wildcard --overwrite` la redéclenche.

## Authentification CI

**Un bot par environnement, cloisonné à son seul namespace.** Chaque env a son projet Rancher,
et l'appartenance à un projet est ce qui donne les droits — un bot membre d'un projet a tous
les namespaces de ce projet, d'où un projet par env.

| Env | Projet Rancher | Bot | Namespace |
|---|---|---|---|
| dev | `c-m-97jxtvnv:p-mrmrt` | `rancherbot-ci-mesure-impact-dev` (`u-h4dmz`) | `mesure-impact-dev` |
| prod | `c-m-97jxtvnv:p-bxkq6` | `rancherbot-ci-mesure-impact-prod` (`u-7nzxq`) | `mesure-impact-prod` |

Chaque bot porte deux `projectRoleTemplateBinding` sur son projet : `project-member` et
`rt-c7bjb` (rôle `sealed-secrets`).

Les kubeconfigs sont des secrets **d'environnement** GitHub, pas des secrets de dépôt : le job
`dev` ne peut pas lire celui de `prod`. Le job étant rattaché à `environment:`, le workflow
lit `secrets.KUBECONFIG` sans savoir lequel il obtient.

Cloisonnement vérifié par `SubjectAccessReview` croisés — chaque bot obtient `yes` sur son
namespace et `no` sur l'autre, pour `deployments`, `cronjobs`, `secrets` et `sealedsecrets`.
Hors de leurs namespaces, l'empreinte reste celle d'un `project-member` Rancher : lecture
cluster en `get/list/watch` sur `nodes`, `persistentvolumes`, `storageclasses`, `apiservices` ;
`create namespaces` sans aucun droit sur ce qui serait créé ; aucune escalade RBAC ; aucune
lecture transverse ; aucun binding sur `ovh-prod`.

Les tokens n'expirent pas (`kubeconfig-default-token-ttl-minutes=0`).

**Les mots de passe des bots ne sont stockés nulle part.** Pour regénérer un kubeconfig, voir
l'en-tête de [scripts/regen-kubeconfig.sh](scripts/regen-kubeconfig.sh) : il documente le
reset admin `POST /v3/users/<id>?action=setpassword`.

## Secrets applicatifs — SealedSecrets

**Un secret par produit et par env.** `PRODUIT=<dept>/<nom> ENV=<env> task seal` lit les deux
tokens depuis l'environnement et produit
`produits/<dept>/<nom>/secrets/<env>.sealedsecret.yaml` — c'est ce fichier chiffré qui est
commité. **Le dépôt est public** : rien d'autre qu'un SealedSecret ne doit y figurer.

Seuls `MATOMO_TOKEN_AUTH` et `GRIST_API_KEY` sont scellés. Les quatre pointeurs
(`MATOMO_URL`, `MATOMO_SITE_ID`, `GRIST_URL`, `GRIST_DOC_ID`) viennent de `produit.yaml` et
sont injectés en clair : corriger un site ou un doc doit rester une PR relisible.

Scellés en scope **strict** — liés au couple namespace + nom — contre
`https://kubeseal.ovh.fabrique.social.gouv.fr/v1/cert.pem`. Un fichier chiffré n'est donc
déscellable que là où il a été scellé : recopier `dev.sealedsecret.yaml` en
`prod.sealedsecret.yaml` ne marche pas, il faut re-sceller pour chaque env. C'est le prix de
ne pas laisser un co-locataire du cluster déchiffrer un fichier public.

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
