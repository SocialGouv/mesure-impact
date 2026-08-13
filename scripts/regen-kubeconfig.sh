#!/usr/bin/env bash
# Regénère le kubeconfig du bot Rancher et le repousse dans le secret GitHub KUBECONFIG.
#
# Le mot de passe du bot n'est stocké nulle part. Deux cas :
#   - tu l'as encore   → RANCHER_BOT_PASSWORD=... ./scripts/regen-kubeconfig.sh
#   - tu ne l'as plus  → réinitialise-le d'abord avec un token admin Rancher :
#       curl -sX POST -H "Authorization: Bearer $RANCHER_ADMIN_TOKEN" \
#         -H 'content-type: application/json' \
#         -d '{"newPassword":"<nouveau>"}' \
#         "$RANCHER_URL/v3/users/u-h4dmz?action=setpassword"
set -euo pipefail

RANCHER_URL=${RANCHER_URL:-https://rancher.fabrique.social.gouv.fr}
CLUSTER_ID=${CLUSTER_ID:-c-m-97jxtvnv}
BOT_USERNAME=${BOT_USERNAME:-rancherbot-ci-mesure-impact}
REPO=${REPO:-SocialGouv/mesure-impact}

: "${RANCHER_BOT_PASSWORD:?RANCHER_BOT_PASSWORD non défini — voir l'en-tête de ce script}"

umask 077
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

token=$(
  curl -sf -X POST -H 'content-type: application/json' \
    -d "$(jq -nc --arg u "$BOT_USERNAME" --arg p "$RANCHER_BOT_PASSWORD" \
          '{username:$u, password:$p, ttl:0}')" \
    "$RANCHER_URL/v3-public/localProviders/local?action=login" \
  | jq -r '.token'
)
[ -n "$token" ] && [ "$token" != "null" ] || { echo "login Rancher échoué" >&2; exit 1; }

curl -sf -X POST -H "Authorization: Bearer $token" -H 'content-type: application/json' \
  "$RANCHER_URL/v3/clusters/$CLUSTER_ID?action=generateKubeconfig" \
  | jq -re '.config' > "$tmp/kubeconfig"

KUBECONFIG="$tmp/kubeconfig" kubectl config get-contexts

base64 -w0 "$tmp/kubeconfig" | gh secret set KUBECONFIG --repo "$REPO"
echo "secret KUBECONFIG mis à jour sur $REPO"
