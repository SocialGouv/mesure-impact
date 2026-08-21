# Doc technique — déploiement

## Le modèle à deux environnements

Deux environnements séparés cohabitent sur le cluster :

| | préprod (`dev`) | prod |
|---|---|---|
| Namespace | `mesure-impact-dev` | `mesure-impact-prod` |
| URL | `mesure-impact-dev.ovh.fabrique…` | `mesure-impact.ovh.fabrique…` |
| Déclencheur | push sur `main` (**auto**) | `workflow_dispatch` env=prod (**manuel**) |

**Partagé** entre les deux : le code (`etl.mjs`, `dashboard.html`), le chart, les images.
**Propre à chaque env** : ses valeurs (`envs/<env>/values.yaml`), son secret scellé, l'état de
son CronJob (suspendu ou non), sa cadence.

Un même dossier produit sert les deux envs. On ne duplique pas le code par env : seuls la
config et les secrets changent, portés par le secret scellé de chaque env.

## Déployer un produit, de bout en bout

1. Copier le moule `produits/<dept>/<produit>/`, remplir `produit.yaml`, adapter `etl.mjs`,
   poser `dashboard.html`.
2. Sceller les tokens du produit (`PRODUIT=<dept>/<nom> ENV=dev task seal`) → fichier chiffré commité.
3. PR → la CI vérifie → relecture → merge sur `main` → **déploiement dev auto**.
4. Vérifier que Grist se peuple, **repointer** le widget du doc Grist vers l'URL fabrique.
   La collecte démarre dès l'étape 3 : `cron.suspend` vaut pour **tout l'env**, et `dev`
   est déjà à `false`. C'est pourquoi l'étape 2 n'est pas optionnelle — la CI refuse un
   produit d'inventaire sans son secret scellé, précisément pour éviter un CronJob actif
   et muet.
5. Itérer le front à chaque push.

## Passer de préprod à prod

Préprod et prod sont **deux chaînes indépendantes contre des sources différentes**. Le code
est identique ; seuls la config et les secrets scellés changent. Passer en prod, c'est
instancier le même produit contre les sources de prod.

Ce qui change, concrètement :

1. **Source Matomo** : un `MATOMO_SITE_ID` différent (le vrai site public au lieu du site de
   préprod), avec un token qui peut le lire.
2. **Destination Grist** : un `GRIST_DOC_ID` différent (un doc prod séparé, pour que les tests
   de préprod ne polluent jamais la prod), dans l'espace d'équipe durable, avec le compte de
   service en éditeur.
3. **Scellement** : `PRODUIT=<dept>/<nom> ENV=prod task seal` avec les deux tokens de prod
   → `produits/<dept>/<nom>/secrets/prod.sealedsecret.yaml`.
4. **Déploiement** : manuel et volontaire (`workflow_dispatch` env=prod), puis réveil du
   CronJob prod.
5. **Repointage** du widget du doc prod vers l'URL fabrique de prod.

`produit.yaml` porte un `site_id` et un `doc_id` **par env**, et la liste `envs` des envs où
le produit est collecté. Un produit qui ne déclare pas `prod` ne reçoit aucun CronJob de prod :
c'est ce qui empêche la prod de collecter la source de préprod tant que la vraie source
n'existe pas. Ouvrir la prod d'un produit = créer le site Matomo et le doc Grist, renseigner
leurs identifiants, puis ajouter `prod` à `envs`.

## Points à connaître (état actuel)

- **Emplacement des secrets** : un secret scellé par produit et par env, dans
  `produits/<dept>/<nom>/secrets/<env>.sealedsecret.yaml`. Il ne porte que
  `MATOMO_TOKEN_AUTH` et `GRIST_API_KEY`.
- **Cadence** : `envs/<env>/values.yaml` fixe le défaut de l'env (`0 6 * * *`), et un
  produit qui déclare `collecte.schedule` dans son `produit.yaml` s'en affranchit — la
  valeur du produit gagne toujours, l'env ne la surcharge pas.
- **Un CronJob par produit** : nommé `mesure-impact-<dept>-<nom>-collect`. Un ETL qui échoue
  n'empêche pas les autres de collecter.

## Garde-fous

- **Marqueur d'inventaire** : le chart refuse de rendre si l'inventaire des produits n'a pas
  été passé, ou s'il a été généré pour un autre env. Un `-f` oublié déploierait sinon zéro
  CronJob sans un mot ; un inventaire de dev passé à la prod ferait collecter la préprod.
- **Déploiement prod protégé** : le job est rattaché à l'environnement GitHub `prod`, où se
  posent les règles de protection (relecteurs requis).
- **Alertes** : deux `PrometheusRule` par env — collecte en échec, et collecte muette depuis
  plus de 48 h. La panne qui compte ici est silencieuse : rien ne casse, les données vieillissent.
- **Réseau** : ingress fermé par défaut, ouvert au seul contrôleur d'ingress et au monitoring.
