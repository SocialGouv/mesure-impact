#!/usr/bin/env bash
# Vérifie un relais Matomo déployé, depuis n'importe quel poste.
#   ./verifier-relais.sh https://monproduit.gouv.fr/k7f3a9
# Ne remplace pas le test depuis un poste agent équipé du bloqueur (voir doc).
set -u
BASE="${1:?Usage : $0 https://domaine-du-produit/prefixe}"
echec=0

verifier() { # libellé, code attendu (regex), code obtenu
  if [[ "$3" =~ ^($2)$ ]]; then echo "OK   $1 ($3)"; else echo "KO   $1 : attendu $2, obtenu $3"; echec=1; fi
}

code=$(curl -s -o /tmp/relais-script.js -w '%{http_code}' "$BASE/a.js")
verifier "Le script de mesure est servi" "200" "$code"
if grep -qi "matomo" /tmp/relais-script.js 2>/dev/null; then echo "OK   Le script servi est bien celui de Matomo"
else echo "KO   Le script servi n'est pas celui de Matomo"; echec=1; fi

verifier "Le point de collecte répond" "200|204" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/c")"
verifier "Un autre chemin est refusé" "404|403" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/index.php?module=API")"
verifier "Un token_auth est refusé" "400" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/c?idsite=0&token_auth=test")"

exit $echec
