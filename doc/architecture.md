# Doc technique — architecture

## La chaîne, de bout en bout

```
Matomo ──(API)──> ETL (Node) ──(REST)──> Grist ──(API plugin)──> dashboard.html (widget)
 collecte          agrège jour×device      stocke + calcule        affiche
```

Deux briques tournent dans l'infra (Kubernetes / fabrique) :

- un **CronJob** qui exécute l'ETL périodiquement (image `docker/cron`) ;
- un **service web** qui sert les fronts statiques derrière l'ingress (image `docker/web`).

## Socle partagé vs couche produits

- **Socle** (`chart/`, `docker/`, `.github/`, `Taskfile.yml`) : le déploiement, les images,
  la CI, les commandes. Commun à tous les produits.
- **Produits** (`produits/<dept>/<nom>/`) : le contenu propre à chaque tableau de bord
  (config, ETL, front, secrets scellés).

Un même dépôt héberge N tableaux de bord (monorepo). Cf. `decisions/0001`.

## Contrat de variables

L'ETL lit sa config dans l'environnement (injecté par le Secret déscellé, `envFrom`).
Le contrat est commun au socle (chart, Taskfile) et à chaque `etl.mjs` :

| Variable | Rôle | Secret ? |
|---|---|---|
| `MATOMO_URL` | instance Matomo | non |
| `MATOMO_SITE_ID` | site du produit | non |
| `MATOMO_TOKEN_AUTH` | token de lecture Matomo | **oui** |
| `GRIST_URL` | instance Grist | non |
| `GRIST_DOC_ID` | doc cible du produit | non |
| `GRIST_API_KEY` | clé d'écriture Grist | **oui** |

Optionnelles : `COLLECT_FROM` (date de début), `GRIST_DOC_NAME` (vérif de sécurité), `RUN_ID`.

## Secrets

Aucun token en clair dans le dépôt (il est **public**). `task seal ENV=<env>` chiffre les
tokens en un SealedSecret commitable, déchiffrable uniquement par le cluster. Cf. `decisions/0003`.

## Front : widget embarqué dans Grist

Le front est chargé comme **widget custom dans le doc Grist**, pas servi en page autonome :
il obtient ses données via l'API plugin Grist (`grist.docApi.fetchTable`), sans token. La
fabrique remplace simplement Netlify comme hébergeur du fichier ; le doc Grist repointe vers
la nouvelle URL. Cf. `decisions/0002`.

## État de la multitenance (à date)

Le pilote (BASAVI) tourne dans la forme mono-produit actuelle du chart : un CronJob, un
secret, une image qui lance la collecte du produit. **Généraliser le chart et la CI pour
boucler sur `produits/` (un job et un secret par produit) est le prochain chantier du socle.**
C'est la « multitenance » : elle est portée côté infra, pas côté produit.

## Intégration continue

- `.github/workflows/deploy.yml` : build des images + déploiement (push `main` → dev,
  `workflow_dispatch` → prod).
- `.github/workflows/ci.yml` : portes de qualité sur chaque PR (lint du chart, vérification
  de syntaxe des collecteurs).
