# D@CCORD : tableau de bord (démo)

Dépôt et suivi des demandes d'accord (département IDN). Ce tableau de bord est en démo : il
tourne sur des données **synthétiques**, dans le doc Grist « Démo - DACCORD ».

## La chaîne

```
doc Grist « Démo - DACCORD » (données synthétiques) ──> dashboard.html (widget)
```

- **`dashboard.html`** : le front DSFR, embarqué comme widget dans le doc Grist (il lit les tables
  `Mensuel` et `Actions` via l'API plugin Grist, aucun token dans la page). Polices Marianne
  embarquées : l'image web ne publie que ce fichier.
- Pas de `produit.yaml` ni de collecte : le dossier est publié sans CronJob, sous `/idn/daccord/`.

Hors de Grist, la page affiche « Données indisponibles » : aucune donnée n'est publiée.

## Données synthétiques

Aucune valeur ne vient de la base D@CCORD. Seule la forme est reprise (mois, types de demande,
régions, colonnes, classes des histogrammes, relations entre compteurs) ; les volumes sortent d'un
modèle inventé (poids de région proches de la population, poids de type fixés à la main, tendance
mensuelle douce). Ils servent à cadrer les indicateurs avec l'équipe, pas à les lire.
