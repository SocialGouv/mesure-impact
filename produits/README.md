# produits/ — un dossier par tableau de bord

Chaque tableau de bord vit dans `produits/<département>/<produit>/`. Le socle technique
(`chart/`, `docker/`, `.github/`, `Taskfile.yml`) est partagé et consomme ces dossiers.

## Ajouter un produit

1. **Copier un dossier existant** : `cp -r produits/sante/basavi produits/<dept>/<nom>`.
2. **Remplir `produit.yaml`** : site Matomo, doc Grist, grain, critères d'achèvement.
3. **Adapter `etl.mjs`** : la recette de collecte propre au produit (pour l'instant un script
   par produit ; un moteur générique sera extrait quand le pattern se stabilisera).
4. **Poser `dashboard.html`** : le front, embarqué dans le doc Grist.
5. **Sceller les tokens** : `PRODUIT=<dept>/<nom> ENV=dev task seal` (voir `doc/conventions.md`).
   Sans ce fichier, la CI refuse la PR : `cron.suspend` vaut pour tout l'env, donc un
   produit sans secret naîtrait actif et échouerait chaque nuit.
6. **Premier run** : un produit qui ne collecte rien du tout échoue volontairement — c'est
   presque toujours un `site_id` faux ou un tag absent. Si l'absence de trafic est
   attendue, poser `ALLOW_EMPTY_COLLECT: "1"` dans `cron.env` de l'env, et le retirer dès
   la première collecte réussie.
7. **Doc Grist distinct** : deux produits ne peuvent pas partager un `doc_id`. Les clés des
   tables sont `day|device`, sans discriminant de produit : les deux collectes s'écraseraient.
   Le générateur d'inventaire refuse ce cas.
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

## Tableau sans collecte (démo)

Un produit peut être publié **avant d'avoir sa collecte** : une démo sur données fictives,
pour cadrer les indicateurs avec l'équipe produit. Le dossier ne contient alors que :

| Fichier | Rôle |
|---|---|
| `dashboard.html` | le front, embarqué dans le doc Grist de démo |
| `README.md` | à quoi il sert, et pourquoi il n'a pas encore de collecte |

Sans `produit.yaml`, l'inventaire ignore le dossier : pas de CronJob, pas de secret exigé.
L'image web publie quand même le `dashboard.html` sous `/<dept>/<nom>/`.

Deux règles, parce que l'image ne copie que ce fichier et que le dépôt est public :

- **aucune donnée dans la page**, même fictive : les données viennent du doc Grist par
  l'API plugin. Hors de Grist, la page affiche « Données indisponibles » ;
- **ressources embarquées** : polices en base64, pas de fichier à côté du `dashboard.html`.
  Seule exception, l'API plugin, chargée depuis `grist.numerique.gouv.fr` comme pour BASAVI.

Quand la collecte arrive, on ajoute `produit.yaml`, `etl.mjs` et `secrets/` dans le même
dossier : l'URL ne change pas. Exemple : `sante/medle/`. Voir `doc/decisions/0005`.
