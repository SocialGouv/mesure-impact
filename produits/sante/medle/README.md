# Médlé : tableau de bord (démo)

Déclaration des actes médico-légaux et des ETP des unités médico-judiciaires (département
Santé, sponsor DGOS). Ce tableau de bord est en démo : il tourne sur des données fictives,
dans le doc Grist « Démo - Médlé ».

## La chaîne

```
doc Grist « Démo - Médlé » (données fictives) ──> dashboard.html (widget)
```

- **`dashboard.html`** : le front DSFR, embarqué comme widget dans le doc Grist (il lit les
  données via l'API plugin Grist, aucun token dans la page). Polices Marianne embarquées :
  l'image web ne publie que ce fichier.
- Pas de `produit.yaml` ni de collecte : le dossier est publié sans CronJob, sous
  `/sante/medle/`. Ils arriveront avec le tagging Matomo du produit.

Hors de Grist, la page n'affiche aucune donnée.
