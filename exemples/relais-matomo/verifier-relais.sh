#!/usr/bin/env bash
# Vérifie un relais Matomo déployé, depuis n'importe quel poste.
#   ./verifier-relais.sh https://monproduit.gouv.fr/k7f3a9
#   ./verifier-relais.sh https://monproduit.gouv.fr/api/a1b2c3 s1234.js t5678   (noms Next.js du build)
# Ne remplace pas le test depuis un poste agent équipé du bloqueur (voir doc).
# Aucun hit n'est enregistré : les requêtes envoyées ne portent pas d'identifiant de site.
set -u
BASE="${1:?Usage : $0 https://domaine-du-produit/prefixe}"
BASE="${BASE%/}"
SCRIPT="${2:-a.js}"
COLLECTE="${3:-c}"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
echec=0

ok() { echo "OK   $1"; }
ko() { echo "KO   $1"; echec=1; }

# Signatures propres aux réponses de Matomo (le mot « matomo » seul peut figurer dans la page du produit).
SIGNATURE_MATOMO='free/libre analytics platform|Matomo tracking API|GIF89a|^\{"(value|result)":'

# 1. Le script servi est celui de Matomo.
code=$(curl -s -o "$tmp/script" -w '%{http_code}' "$BASE/$SCRIPT")
if [ "$code" = "200" ] && grep -q "free/libre analytics platform" "$tmp/script"; then ok "Le script de mesure est servi par Matomo"
else ko "Le script de mesure n'est pas servi par Matomo (statut $code)"; fi

# 2. Un POST avec un corps atteint Matomo, comme les hits envoyés par sendBeacon.
#    Un 403 trahit une protection CSRF, un 500 un parseur de corps monté avant le relais.
entetes=$(curl -s -D - -o "$tmp/collecte" -X POST -H 'Content-Type: application/x-www-form-urlencoded' --data 'relais=verification' "$BASE/$COLLECTE")
code=$(printf '%s' "$entetes" | head -1 | awk '{print $2}')
# Selon sa version, Matomo répond 200 ou 400 à cette requête sans site. Seul le GIF prouve que le corps
# est arrivé : sans corps, Matomo renvoie une page HTML qui ne doit pas suffire.
if printf '%s' "$entetes" | grep -qi '^content-type: image/gif' || grep -q 'GIF89a' "$tmp/collecte"
then ok "Le point de collecte relaie un POST jusqu'à Matomo (statut $code)"
else ko "Le point de collecte ne relaie pas un POST jusqu'à Matomo (statut ${code:-aucun})"; fi

# 3. Rien d'autre n'est relayé. Le statut dépend du produit (404 ou page de l'application) :
#    on vérifie que la réponse ne vient pas de Matomo.
for chemin in "index.php?module=API&method=API.getMatomoVersion&format=json" "$COLLECTE/index.php" "x/matomo.php"; do
  : > "$tmp/autre"
  curl -s -o "$tmp/autre" "$BASE/$chemin"
  if grep -qE "$SIGNATURE_MATOMO" "$tmp/autre"; then ko "Matomo répond sur /$chemin : le relais en expose trop"
  else ok "Rien de Matomo sur /$chemin"; fi
done

exit $echec
