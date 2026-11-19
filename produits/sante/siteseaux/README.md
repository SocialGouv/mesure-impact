# Sites Eaux : tableau de bord (démo)

Refonte du site public qui donne les résultats du contrôle sanitaire de l'eau potable
(Orobnat, département Santé). Le MVP ne couvre que l'eau du robinet : les eaux de baignade
viendront dans une version ultérieure du site. Ce tableau de bord est en démo : il
tourne sur des données fictives, dans le doc Grist « Démo - Sites Eaux », en attendant la
mise en ligne du nouveau site et son tagging.

## La chaîne

```
doc Grist « Démo - Sites Eaux » (données fictives) ──> dashboard.html (widget)
```

- **`dashboard.html`** : la V1 du 06/11 (page « Tableau » du doc), front DSFR au gabarit commun
  embarqué comme widget dans le doc Grist (il lit les tables `Territoires`, `Suivi_mensuel` et `Avis` via l'API plugin Grist,
  aucun token dans la page). Polices Marianne embarquées : l'image web ne publie que ce fichier.
- **`versions/1.1.html`** : la V1.1 (page « Tableau 1.1 »), servie sous `/sante/siteseaux/1.1/`.
  Elle ne lit que les lignes eau potable : le doc démo garde les lignes baignade pour la V1.
- Pas de `produit.yaml` ni de collecte : le dossier est publié sans CronJob, sous
  `/sante/siteseaux/`. Ils arriveront avec le tagging Matomo du nouveau site.

Hors de Grist, la page affiche « Données indisponibles » : aucune donnée n'est publiée.

La colonne `Mois` doit rester de type **Date** (pas DateTime) : un fuseau horaire décalerait
tout d'un mois. Une ligne dont le mois est vide ou illisible est ignorée.

## Indicateurs (V1.1, revue du 13/11/2026 avec Estelle)

| Pilier | Indicateur principal | Source cible |
|---|---|---|
| Utilisable | Recherches qui aboutissent à la page d'une UDI | events Matomo |
| Utilisé | Visites, comparées au mois précédent | Matomo |
| Utile | Données jugées claires | « Je donne mon avis » |
| Impactant | Confiance dans l'eau du robinet (cible, question type CIEau) | question à ajouter à « Je donne mon avis » |

Filtres : mois, région. La comparaison se fait au **mois précédent** : l'eau potable n'a pas de
saisonnalité marquée. En Synthèse, les régions les plus recherchées avec la **part des habitants**
(visiteurs uniques du mois ÷ population). Les pages d'erreur (404, 500, délai de l'API) remplacent
les recherches sans résultat : toute commune a une UDI rattachée.

Colonnes ajoutées à `Suivi_mensuel` pour la V1.1 : `Visiteurs_uniques`, `Erreurs_404`,
`Erreurs_500` et `Erreurs_delai` (vides ou à 0 sur les lignes baignade). La V1.1 ignore
`Sans_resultat`, gardé pour la V1.
