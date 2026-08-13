#!/usr/bin/env bash
# Émet sur stdout les valeurs Helm décrivant les produits collectés dans un env,
# lues depuis les produits/<dept>/<nom>/produit.yaml. Le chemin du dossier fait
# autorité pour le slug : `nom` et `departement` du YAML sont de l'affichage.
#
# Un produit qui ne liste pas l'env dans `envs` est ignoré : c'est ainsi qu'un
# produit sans source de prod ne collecte pas la source de préprod par erreur.
#
# Usage : scripts/produits-values.sh <env> > /tmp/produits.values.yaml
set -euo pipefail

env=${1:-}
[ -n "$env" ] || { echo "usage: $0 <env>" >&2; exit 1; }
command -v yq >/dev/null || { echo "yq est requis (devbox install)" >&2; exit 1; }

racine=$(cd "$(dirname "$0")/.." && pwd)
manifests=$(find "$racine/produits" -mindepth 3 -maxdepth 3 -name produit.yaml | sort)

[ -n "$manifests" ] || { echo "aucun produits/<dept>/<nom>/produit.yaml trouvé" >&2; exit 1; }

# Marqueur : atteste que l'inventaire a été généré, et pour QUEL env. Le chart
# refuse de rendre si ce marqueur ne correspond pas à l'env déployé — ça attrape
# aussi bien un `-f` oublié qu'un inventaire de dev passé à la prod.
echo "produitsInventaire: \"$env\""
echo "produits:"

for manifeste in $manifests; do
  dossier=$(dirname "$manifeste")
  nom=$(basename "$dossier")
  departement=$(basename "$(dirname "$dossier")")
  slug="$departement/$nom"

  # ENVCIBLE traverse yq par strenv() : l'env n'est jamais concaténé dans
  # l'expression, donc jamais interprété comme du yq.
  cible=$(ENVCIBLE="$env" yq -r '[.envs[]? | select(. == strenv(ENVCIBLE))] | length' "$manifeste")
  [ "$cible" != "0" ] || { echo "  # $slug : non collecté en $env" >&2; continue; }

  # Chaque champ est obligatoire : un produit mal décrit doit casser le rendu,
  # pas produire un CronJob qui échouera silencieusement au premier run.
  lire() {
    local valeur
    valeur=$(ENVCIBLE="$env" yq -r "$1 // \"\"" "$manifeste")
    [ -n "$valeur" ] && [ "$valeur" != "null" ] || {
      echo "$slug : champ obligatoire absent de produit.yaml pour l'env $env -> $1" >&2; exit 1; }
    printf '%s' "$valeur"
  }

  matomo_url=$(lire '.chaine.matomo.url')
  matomo_site=$(lire '.chaine.matomo.site_id[strenv(ENVCIBLE)]')
  grist_url=$(lire '.chaine.grist.url')
  grist_doc=$(lire '.chaine.grist.doc_id[strenv(ENVCIBLE)]')
  # Optionnel : le chart applique son schedule par défaut si absent.
  schedule=$(yq -r '.collecte.schedule // ""' "$manifeste")

  cat <<EOF
  - slug: "$slug"
    nom: "$nom"
    departement: "$departement"
    matomoUrl: "$matomo_url"
    matomoSiteId: "$matomo_site"
    gristUrl: "$grist_url"
    gristDocId: "$grist_doc"
EOF
  [ -z "$schedule" ] || echo "    schedule: \"$schedule\""
done
