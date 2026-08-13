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

L'ETL lit toute sa config dans l'environnement. Le contrat est commun au socle (chart,
Taskfile) et à chaque `etl.mjs`, mais les variables n'arrivent pas par le même chemin :

| Variable | Rôle | Origine |
|---|---|---|
| `MATOMO_URL` | instance Matomo | `produit.yaml`, en clair (`env:`) |
| `MATOMO_SITE_ID` | site du produit | `produit.yaml`, en clair (`env:`) |
| `GRIST_URL` | instance Grist | `produit.yaml`, en clair (`env:`) |
| `GRIST_DOC_ID` | doc cible du produit | `produit.yaml`, en clair (`env:`) |
| `MATOMO_TOKEN_AUTH` | token de lecture Matomo | **SealedSecret** du produit (`envFrom`) |
| `GRIST_API_KEY` | clé d'écriture Grist | **SealedSecret** du produit (`envFrom`) |

Seuls les deux vrais secrets sont scellés. Les quatre pointeurs restent en clair : corriger
un `site_id` doit être une PR relisible, pas un rescellement opaque.

Le chart injecte aussi `PRODUIT` (`<dept>/<nom>`, qui indique au runner quel ETL charger),
`RUN_ID` et `ENVIRONMENT`. Optionnelles : `COLLECT_FROM` (date de début), `GRIST_DOC_NAME`
(vérif de sécurité).

## Secrets

Aucun token en clair dans le dépôt (il est **public**). `task seal ENV=<env>` chiffre les
tokens en un SealedSecret commitable, déchiffrable uniquement par le cluster. Cf. `decisions/0003`.

## Front : widget embarqué dans Grist

Le front est chargé comme **widget custom dans le doc Grist**, pas servi en page autonome :
il obtient ses données via l'API plugin Grist (`grist.docApi.fetchTable`), sans token. La
fabrique remplace simplement Netlify comme hébergeur du fichier ; le doc Grist repointe vers
la nouvelle URL. Cf. `decisions/0002`.

L'image `docker/web` publie chaque `produits/<dept>/<nom>/dashboard.html` sous
`https://<host>/<dept>/<nom>/` — c'est cette URL qu'attend le widget. La racine `/` liste les
tableaux de bord publiés, générée au build de l'image.

## Multitenance

Le chart est conscient de `produits/`. La liste n'est jamais écrite à la main :
`scripts/produits-values.sh` parcourt les `produits/<dept>/<nom>/produit.yaml` et émet les
valeurs Helm ; le Taskfile et les deux workflows la passent en `-f`. **Le chemin du dossier
fait autorité** pour l'identité d'un produit — `nom` et `departement` du YAML sont de
l'affichage. Un `produit.yaml` incomplet fait échouer la CI plutôt que de produire un CronJob
qui planterait au premier run.

Chaque produit reçoit :

- un **CronJob** `mesure-impact-<dept>-<nom>-collect`, avec sa cadence (`collecte.schedule`,
  à défaut celle du chart) et son propre échec — un ETL qui plante n'affecte pas les autres ;
- un **SealedSecret** `mesure-impact-<dept>-<nom>-tokens`, scellé dans
  `produits/<dept>/<nom>/secrets/<env>.sealedsecret.yaml` ;
- une **URL** `/<dept>/<nom>/`, servie par l'image web, à coller comme widget dans le doc Grist.

Le runner `docker/cron/collect.mjs` reçoit `PRODUIT=<dept>/<nom>` et n'importe que l'ETL
concerné. Il refuse un `PRODUIT` absent, malformé ou introuvable dans l'image.

Ajouter un produit ne touche donc pas au socle : un dossier, un `produit.yaml` complet, un
`etl.mjs`, un `dashboard.html`, et les tokens scellés.

## Intégration continue

- `.github/workflows/deploy.yml` : build des images + déploiement (push `main` → dev,
  `workflow_dispatch` → prod).
- `.github/workflows/ci.yml` : portes de qualité sur chaque PR (lint du chart, vérification
  de syntaxe des collecteurs).
