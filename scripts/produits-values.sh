#!/usr/bin/env bash
# Émet sur stdout les valeurs Helm décrivant les produits, lues depuis les
# produits/<dept>/<nom>/produit.yaml. Le chemin du dossier fait autorité pour le
# slug : `nom` et `departement` du YAML sont de l'affichage, pas des identifiants.
#
# Usage : scripts/produits-values.sh > /tmp/produits.values.yaml
set -euo pipefail

command -v yq >/dev/null || { echo "yq est requis (devbox install)" >&2; exit 1; }

racine=$(cd "$(dirname "$0")/.." && pwd)
manifests=$(find "$racine/produits" -mindepth 3 -maxdepth 3 -name produit.yaml | sort)

[ -n "$manifests" ] || { echo "aucun produits/<dept>/<nom>/produit.yaml trouvé" >&2; exit 1; }

echo "produits:"
for manifeste in $manifests; do
  dossier=$(dirname "$manifeste")
  nom=$(basename "$dossier")
  departement=$(basename "$(dirname "$dossier")")
  slug="$departement/$nom"

  # Chaque champ est obligatoire : un produit mal décrit doit casser le rendu,
  # pas produire un CronJob qui échouera silencieusement au premier run.
  lire() {
    local valeur
    valeur=$(yq -r "$1 // \"\"" "$manifeste")
    [ -n "$valeur" ] && [ "$valeur" != "null" ] || {
      echo "$slug : champ obligatoire absent de produit.yaml -> $1" >&2; exit 1; }
    printf '%s' "$valeur"
  }

  matomo_url=$(lire '.chaine.matomo.url')
  matomo_site=$(lire '.chaine.matomo.site_id')
  grist_url=$(lire '.chaine.grist.url')
  grist_doc=$(lire '.chaine.grist.doc_id')
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
