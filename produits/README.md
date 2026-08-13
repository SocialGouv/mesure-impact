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
| `secrets/<env>.sealedsecret.yaml` | les 2 tokens Matomo + Grist du produit | **chiffré** |

Le `produit.yaml` est lu par le socle : `scripts/produits-values.sh <env>` en dérive le
CronJob, ses variables et l'URL du dashboard. Un champ obligatoire absent fait échouer la CI.
Le **chemin du dossier** fait autorité pour l'identité du produit (`sante/basavi` → CronJob
`mesure-impact-sante-basavi-collect`, URL `/sante/basavi/`) : `nom` et `departement` du YAML
sont de l'affichage.

Le champ `envs` liste les environnements où le produit est **collecté**, et
`chaine.matomo.site_id` / `chaine.grist.doc_id` portent une valeur par env. Un produit qui ne
déclare pas `prod` n'y reçoit aucun CronJob : c'est le garde-fou qui empêche la prod de
collecter la source de préprod. Le dashboard, lui, est servi dans tous les envs.
