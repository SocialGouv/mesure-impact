# produits/ — un dossier par tableau de bord

Chaque tableau de bord vit dans `produits/<département>/<produit>/`. Le socle technique
(`chart/`, `docker/`, `.github/`, `Taskfile.yml`) est partagé et consomme ces dossiers.

## Ajouter un produit

1. **Copier un dossier existant** : `cp -r produits/sante/basavi produits/<dept>/<nom>`.
2. **Remplir `produit.yaml`** : site Matomo, doc Grist, grain, critères d'achèvement.
3. **Adapter `etl.mjs`** : la recette de collecte propre au produit (pour l'instant un script
   par produit ; un moteur générique sera extrait quand le pattern se stabilisera).
4. **Poser `dashboard.html`** : le front, embarqué dans le doc Grist.
5. **Sceller les tokens** : `task seal ENV=dev` (voir `doc/conventions.md`).
6. **Documenter** : mettre à jour `doc/produit.md` et ouvrir la PR (le modèle de PR rappelle
   la checklist).

On ne touche jamais aux autres produits ni au socle. La référence, c'est le dossier
`sante/basavi/` : reproduire ce qu'il fait.

## Anatomie d'un produit

| Fichier | Rôle | Secret ? |
|---|---|---|
| `produit.yaml` | identifiants publics + critères d'achèvement | non |
| `etl.mjs` | collecte Matomo → Grist | non |
| `dashboard.html` | le front (widget Grist) | non |
| `README.md` | à quoi sert le tableau de bord | non |
| `secrets/<env>.sealedsecret.yaml` | tokens Matomo + Grist | **chiffré** |
