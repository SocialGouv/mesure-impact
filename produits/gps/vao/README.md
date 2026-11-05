# VAO : tableau de bord (démo)

Agrément et déclaration des séjours de vacances adaptées organisées (VAO), pour les organisateurs
et les agents qui instruisent (département GPS). Ce tableau de bord est en démo : il tourne sur des
données **fictives**, dans le doc Grist « Démo - VAO ».

## La chaîne

```
doc Grist « Démo - VAO » (données fictives) ──> dashboard.html (widget)
```

- **`dashboard.html`** : le front DSFR, embarqué comme widget dans le doc Grist. Il lit la table
  `Jours` (une ligne par jour et par appareil ; étapes, blocages et temps en JSON dans des colonnes
  texte) via l'API plugin Grist, aucun token dans la page.
- Pas de `produit.yaml` ni de collecte : le dossier est publié sans CronJob, sous `/gps/vao/`.

Ouverte directement, hors de Grist, la page affiche « Données indisponibles » : aucune donnée
n'est publiée.

## Données fictives

Aucune valeur ne vient de VAO. Les 120 jours sont produits par un générateur à graine fixe, gardé
hors du dépôt avec le doc de démo ; ils servent à cadrer les indicateurs avec l'équipe, pas à les
lire.
