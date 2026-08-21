#!/usr/bin/env bash
# Joue chart/alerts.test.yaml contre les règles TELLES QUE LE CHART LES REND — pas
# contre une copie qui divergerait en silence. Le rendu et le fichier de test sont
# réunis dans un répertoire temporaire, `rule_files` y étant résolu relativement.
#
# Usage : scripts/test-alerts.sh [env]   (défaut : dev)
set -euo pipefail

env=${1:-dev}
racine=$(cd "$(dirname "$0")/.." && pwd)
command -v promtool >/dev/null || { echo "promtool est requis (devbox install)" >&2; exit 1; }

travail=$(mktemp -d)
trap 'rm -rf "$travail"' EXIT

"$racine/scripts/produits-values.sh" "$env" > "$travail/produits.yaml"

# Un env sans produit collecté ne rend aucune PrometheusRule, et `--show-only`
# échoue alors sur « could not find template ». Rien à jouer n'est pas un échec.
if ! helm template mesure-impact "$racine/chart" \
      --namespace "mesure-impact-$env" \
      --values "$racine/envs/$env/values.yaml" \
      --values "$travail/produits.yaml" \
      --show-only templates/alerts.yaml > "$travail/rendu.yaml" 2>/dev/null; then
  echo "aucune règle d'alerte rendue pour $env (aucun produit collecté) — rien à jouer"
  exit 0
fi
yq '{"groups": .spec.groups}' "$travail/rendu.yaml" > "$travail/rules.yaml"

cp "$racine/chart/alerts.test.yaml" "$travail/alerts.test.yaml"

promtool check rules "$travail/rules.yaml"
promtool test rules "$travail/alerts.test.yaml"
