# Doc produit — mesure d'impact

## À quoi sert ce dépôt

Donner à chaque produit de la DNUM un **tableau de bord d'usage** fondé sur ses données
réelles, sans dépendre d'un poste de travail. Une collecte lit les sources chaque nuit,
agrège dans Grist, et un front DSFR affiche.

La source principale est Matomo (la navigation). Selon le produit, des totaux poussés dans
Matomo ou une extraction de la base du produit la complètent : ce sont les trois stratégies de
collecte de `decisions/0006`.

L'enjeu n'est pas la dataviz pour elle-même : c'est de rendre visible l'usage d'un produit
(qui l'utilise, sur quoi, où ça décroche) pour piloter par l'impact.

## Les tableaux de bord

| Produit | Dossier | Stratégie | État |
|---|---|---|---|
| BASAVI | `sante/basavi` | A. Matomo seul | Prod depuis le 24/09/2026 (V1.2 validée le 30/10, en prod le 05/11) |
| HELIOS | `sante/helios` | B. Matomo + base d'agents poussée le 1er du mois | Prod depuis le 26/11/2026 (plan de taggage posé à la MEP du 23/11), grain mois × rôle |
| Médlé | `sante/medle` | C. Matomo + base (prévue) | Démo, plan de taggage chez l'éditeur |
| D@CCORD | `idn/daccord` | C. Matomo + base (prévue) | Démo V1.2, plan de taggage chez le dev |
| Sites Eaux | `sante/siteseaux` | À définir | Démo V1 et V1.1 côte à côte |
| Honorabilité | `gps/honorabilite` | À définir (sources techniques en plus de Matomo) | Démo V3 et V4 côte à côte |
| VAO | `gps/vao` | À définir | Démo |

« Démo » : front seul sur données fictives, sans collecte (`produits/README.md`, « Tableau
sans collecte »).

**App Data Ops** (`site/data-ops/`, servie sous `/data-ops/`) : le cockpit du doc Grist « Data
Ops DNUM ». Elle suit les produits accompagnés, les livrables et les retours envoyés par le
bouton « Faire un retour » des tableaux.

La longue traîne du portefeuille (200 à 300 produits) rejoindra au fil de l'eau, un dossier
par produit sous `produits/`.

## Glossaire

- **Matomo** : l'outil d'analyse d'audience (souverain, hébergé fabrique). Source des données.
- **Grist** : le tableur/base souverain (`grist.numerique.gouv.fr`). Stocke les données
  agrégées et calcule les ratios. Sert aussi de cadre au front (widget embarqué).
- **ETL** : le script qui extrait les sources (Matomo, et selon la stratégie la base du
  produit), transforme (agrège) et charge dans Grist.
- **Widget** : le front DSFR embarqué dans un doc Grist ; il lit les données via l'API plugin
  Grist, sans jamais porter de token.
- **SealedSecret** : un secret chiffré, commitable même dans un dépôt public. Seul le cluster
  peut le déchiffrer. C'est le seul objet contenant un token qui a le droit de figurer ici.
- **Critères d'achèvement** : les conditions vérifiables qui définissent « c'est fini/sain »
  pour un produit. Elles servent de portes de qualité.

## Où trouver quoi

- La logique technique et la chaîne : `doc/architecture.md`.
- Le déploiement, les environnements préprod/prod : `doc/deploiement.md`.
- Les gestes du quotidien (vérifier une collecte, lire un test, donner un accès) :
  `doc/exploitation.md`.
- Comment ajouter un produit, les règles de contribution : `doc/conventions.md`.
- Les choix structurants et leur raison : `doc/decisions/`.
