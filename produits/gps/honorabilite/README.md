# Honorabilité : tableau de bord (démo)

Instruction des demandes d'honorabilité, pour les personnes qui travaillent au contact de mineurs
(département GPS, back-office PHR). Ce tableau de bord est en démo : il tourne sur des données
**fictives**, dans le doc Grist « Démo - Honorabilité ».

## La chaîne

```
doc Grist « Démo - Honorabilité » (données fictives) ──> dashboard.html (widget)
```

- **`dashboard.html`** : le front DSFR (Tableau V3), embarqué comme widget dans le doc Grist. Il lit
  les tables `Activite`, `Delais_departement`, `Hebdo`, `Agents` et `Flux` via l'API plugin Grist,
  aucun token dans la page. Polices Marianne embarquées : l'image web ne publie que ce fichier.
- Pas de `produit.yaml` ni de collecte : le dossier est publié sans CronJob, sous `/gps/honorabilite/`.

Ouverte directement, hors de Grist, la page affiche « Données indisponibles » : aucune donnée n'est publiée.

## Données fictives

Aucune valeur ne vient du PHR. Les ordres de grandeur (agents habilités, part des demandes revues à
la main par dispositif) sont calés sur les échanges avec l'équipe produit ; les volumes sortent d'un
générateur à graine fixe. Ils servent à cadrer les indicateurs avec l'équipe, pas à les lire.
