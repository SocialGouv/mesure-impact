#!/bin/sh
# Placeholder : valide le câblage (secrets, réseau, RBAC) tant que le code métier
# Matomo → Grist n'est pas intégré. Remplacé à l'arrivée du projet.
set -eu

missing=""
for var in MATOMO_URL MATOMO_TOKEN_AUTH MATOMO_SITE_ID GRIST_URL GRIST_API_KEY GRIST_DOC_ID; do
  eval "value=\${$var:-}"
  [ -n "$value" ] || missing="$missing $var"
done

if [ -n "$missing" ]; then
  echo "ERREUR: variables d'environnement manquantes :$missing" >&2
  echo "Elles proviennent du Secret '\${secretName}' déscellé par sealed-secrets." >&2
  exit 1
fi

echo "environment=${ENVIRONMENT:-?}"
echo "matomo=${MATOMO_URL} site=${MATOMO_SITE_ID}"
echo "grist=${GRIST_URL} doc=${GRIST_DOC_ID}"

echo "--- joignabilité Matomo ---"
curl -fsS --max-time 15 -o /dev/null -w 'HTTP %{http_code}\n' "${MATOMO_URL}"
echo "--- joignabilité Grist ---"
curl -fsS --max-time 15 -o /dev/null -w 'HTTP %{http_code}\n' \
  -H "Authorization: Bearer ${GRIST_API_KEY}" "${GRIST_URL}/api/orgs"

echo "OK — câblage validé. Logique de collecte non encore intégrée."
