# Doc technique — architecture

## La chaîne, de bout en bout

```
Matomo ──(API)──┐
                ├──> ETL (Node) ──(REST)──> Grist ──(API plugin)──> dashboard.html (widget)
base du produit ┘     agrège                 stocke + calcule        affiche
 (stratégie C)
```

Matomo est toujours là : il mesure la navigation. La base du produit ne s'y ajoute que pour
les produits en stratégie C (voir plus bas). Le grain dépend du produit : jour × appareil pour
BASAVI, mois × rôle pour HELIOS.

Deux briques tournent dans l'infra (Kubernetes / fabrique) :

- un **CronJob** qui exécute l'ETL périodiquement (image `docker/cron`) ;
- un **service web** qui sert les fronts statiques derrière l'ingress (image `docker/web`).

## Trois stratégies de collecte

Chaque produit relève de l'une des trois. Le détail et les règles sont dans `decisions/0006`.

| Stratégie | Sources lues par l'ETL | Exemple |
|---|---|---|
| A. Matomo seul | events de navigation | BASAVI |
| B. Matomo + totaux poussés | events de navigation + events serveur portant un total (cron applicatif) | HELIOS, base d'agents le 1er du mois |
| C. Base lue par la collecte | events de navigation + extraction de la base du produit, sans identifiant | D@CCORD, Médlé (à venir) |

Aujourd'hui, seules A et B sont codées : la lecture d'une extraction (stratégie C) arrivera
avec son premier produit, avec ses variables dans le contrat ci-dessous.

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
| `MATOMO_SITE_ID` | site du produit, **par env** | `produit.yaml`, en clair (`env:`) |
| `GRIST_URL` | instance Grist | `produit.yaml`, en clair (`env:`) |
| `GRIST_DOC_ID` | doc cible du produit, **par env** | `produit.yaml`, en clair (`env:`) |
| `MATOMO_TOKEN_AUTH` | token de lecture Matomo | **SealedSecret** du produit (`envFrom`) |
| `GRIST_API_KEY` | clé d'écriture Grist | **SealedSecret** du produit (`envFrom`) |

Seuls les deux vrais secrets sont scellés. Les quatre pointeurs restent en clair : corriger
un `site_id` doit être une PR relisible, pas un rescellement opaque.

Le chart injecte aussi `PRODUIT` (`<dept>/<nom>`, qui indique au runner quel ETL charger),
`RUN_ID` et `ENVIRONMENT`. Optionnelles : `COLLECT_FROM` (date de début), `GRIST_DOC_NAME`
(vérif de sécurité), `ALLOW_EMPTY_COLLECT` (slugs des produits dont une collecte vide est
tolérée, séparés par des virgules).

## Secrets

Aucun token en clair dans le dépôt (il est **public**). `PRODUIT=<dept>/<nom> ENV=<env> task seal` chiffre les
tokens en un SealedSecret commitable, déchiffrable uniquement par le cluster. Cf. `decisions/0003`.

## Front : widget embarqué dans Grist

Le front est chargé comme **widget custom dans le doc Grist**, pas servi en page autonome :
il obtient ses données via l'API plugin Grist (`grist.docApi.fetchTable`), sans token. Tous
les tableaux, démos comprises, sont servis par ce dépôt : Netlify n'en héberge plus aucun.
Cf. `decisions/0002` et `decisions/0005`.

L'image `docker/web` publie chaque `produits/<dept>/<nom>/dashboard.html` sous
`https://<host>/<dept>/<nom>/` — c'est cette URL qu'attend le widget. La racine `/` liste les
tableaux de bord publiés, générée au build de l'image.

L'image publie aussi :

- les **versions côte à côte** : `produits/<dept>/<nom>/versions/<v>.html` sous
  `/<dept>/<nom>/<v>/`, pour comparer deux itérations dans le même doc Grist ;
- les **tableaux sans collecte** : un dossier sans `produit.yaml` est publié sans CronJob
  (démo sur données fictives) ;
- l'**app Data Ops** : `site/data-ops/` sous `/data-ops/`, widget du doc « Data Ops DNUM ».

Chaque tableau porte un bouton **« Faire un retour »** qui ouvre un formulaire Grist public
(table `Retours` du doc « Data Ops DNUM »), avec le contexte du tableau dans l'URL. Le détail
est dans `produits/README.md`.

## Multitenance

Le chart est conscient de `produits/`. La liste n'est jamais écrite à la main :
`scripts/produits-values.sh <env>` parcourt les `produits/<dept>/<nom>/produit.yaml` et émet
les valeurs Helm ; le Taskfile et les deux workflows la passent en `-f`. **Le chemin du dossier
fait autorité** pour l'identité d'un produit — `nom` et `departement` du YAML sont de
l'affichage. Un `produit.yaml` incomplet fait échouer la CI plutôt que de produire un CronJob
qui planterait au premier run.

L'inventaire est **par env** : un produit n'est collecté que dans les envs listés dans son
`envs`, avec le `site_id` et le `doc_id` de cet env. L'inventaire porte un marqueur que le
chart compare à l'env déployé — un `-f` oublié ou un inventaire de dev passé à la prod fait
échouer le rendu au lieu de déployer silencieusement à côté.

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
  de syntaxe des collecteurs, tests des tableaux, des ETL et des règles d'alerte).
- `.github/workflows/collecte.yml` : collecte manuelle d'un produit dans un env, sans attendre
  le créneau du CronJob (voir `doc/exploitation.md`).
