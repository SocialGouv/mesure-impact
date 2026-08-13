# Doc produit — mesure d'impact

## À quoi sert ce dépôt

Donner à chaque produit de la DNUM un **tableau de bord d'usage** fondé sur ses données
réelles, sans dépendre d'un poste de travail. La chaîne est toujours la même :
Matomo collecte, un ETL agrège dans Grist, un front DSFR affiche.

L'enjeu n'est pas la dataviz pour elle-même : c'est de rendre visible l'usage d'un produit
(qui l'utilise, sur quoi, où ça décroche) pour piloter par l'impact.

## Les tableaux de bord

| Produit | Département | État |
|---|---|---|
| BASAVI | Santé | Pilote (préprod) |

La longue traîne du portefeuille (200 à 300 produits) rejoindra au fil de l'eau, un dossier
par produit sous `produits/`.

## Glossaire

- **Matomo** : l'outil d'analyse d'audience (souverain, hébergé fabrique). Source des données.
- **Grist** : le tableur/base souverain (`grist.numerique.gouv.fr`). Stocke les données
  agrégées et calcule les ratios. Sert aussi de cadre au front (widget embarqué).
- **ETL** : le script qui extrait Matomo, transforme (agrège) et charge dans Grist.
- **Widget** : le front DSFR embarqué dans un doc Grist ; il lit les données via l'API plugin
  Grist, sans jamais porter de token.
- **SealedSecret** : un secret chiffré, commitable même dans un dépôt public. Seul le cluster
  peut le déchiffrer. C'est le seul objet contenant un token qui a le droit de figurer ici.
- **Critères d'achèvement** : les conditions vérifiables qui définissent « c'est fini/sain »
  pour un produit. Elles servent de portes de qualité.

## Où trouver quoi

- La logique technique et la chaîne : `doc/architecture.md`.
- Le déploiement, les environnements préprod/prod : `doc/deploiement.md`.
- Comment ajouter un produit, les règles de contribution : `doc/conventions.md`.
- Les choix structurants et leur raison : `doc/decisions/`.
