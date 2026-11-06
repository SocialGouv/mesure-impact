# Sites Eaux : tableau de bord (démo)

Refonte des sites publics qui donnent les résultats du contrôle sanitaire de l'eau potable
(Orobnat) et des eaux de baignade (département Santé). Ce tableau de bord est en démo : il
tourne sur des données fictives, dans le doc Grist « Démo - Sites Eaux », en attendant la
mise en ligne du nouveau site et son tagging.

## La chaîne

```
doc Grist « Démo - Sites Eaux » (données fictives) ──> dashboard.html (widget)
```

- **`dashboard.html`** : le front DSFR au gabarit commun, embarqué comme widget dans le doc
  Grist (il lit les tables `Territoires`, `Suivi_mensuel` et `Avis` via l'API plugin Grist,
  aucun token dans la page). Polices Marianne embarquées : l'image web ne publie que ce fichier.
- Pas de `produit.yaml` ni de collecte : le dossier est publié sans CronJob, sous
  `/sante/siteseaux/`. Ils arriveront avec le tagging Matomo du nouveau site.

Hors de Grist, la page affiche « Données indisponibles » : aucune donnée n'est publiée.

La colonne `Mois` doit rester de type **Date** (pas DateTime) : un fuseau horaire décalerait
tout d'un mois. Une ligne dont le mois est vide ou illisible est ignorée.

## Indicateurs (V1 proposée le 06/11/2026)

| Pilier | Indicateur principal | Source cible |
|---|---|---|
| Utilisable | Recherches qui aboutissent à la page d'une UDI ou d'un site de baignade | events Matomo |
| Utilisé | Visites par type d'eau, comparées au même mois un an plus tôt | Matomo |
| Utile | Données jugées claires | « Je donne mon avis » |
| Impactant | Visiteurs rassurés (cible) | question à ajouter à « Je donne mon avis » |

Filtres : mois, type d'eau, région. La comparaison se fait au même mois de l'année précédente,
à cause de la saisonnalité de la baignade.
