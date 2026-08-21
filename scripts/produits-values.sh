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
# Collation POSIX : sous une locale UTF-8, les classes de caractères laissent
# passer un millier de codepoints exotiques.
export LC_ALL=C

env=${1:-}
[ -n "$env" ] || { echo "usage: $0 <env>" >&2; exit 1; }
command -v yq >/dev/null || { echo "yq est requis (devbox install)" >&2; exit 1; }

racine=$(cd "$(dirname "$0")/.." && pwd)
manifests=$(find "$racine/produits" -mindepth 3 -maxdepth 3 -name produit.yaml | sort)

[ -n "$manifests" ] || { echo "aucun produits/<dept>/<nom>/produit.yaml trouvé" >&2; exit 1; }

# Marqueur : atteste que l'inventaire a été généré, et pour QUEL env. Le chart
# refuse de rendre si ce marqueur ne correspond pas à l'env déployé — ça attrape
# aussi bien un `-f` oublié qu'un inventaire de dev passé à la prod.
ENVNOM="$env" yq -n '{"produitsInventaire": strenv(ENVNOM)}'
echo "produits:"

vus=""

# Le doc Grist est ÉCRIT, et les clés naturelles des tables (day|device) ne portent
# aucun discriminant, ni de produit ni d'env : deux collectes sur le même doc
# s'écrasent chaque nuit, la dernière gagnant, en silence. L'invariant est donc
# GLOBAL — il ne suffit pas de le vérifier entre produits d'un même env, ni entre
# envs d'un même produit : la diagonale (produit A en dev, produit B en prod)
# passerait à travers les deux.
docs_vus=""
while IFS= read -r manifeste; do
  [ -n "$manifeste" ] || continue
  dossier=$(dirname "$manifeste")
  slug_doc="$(basename "$(dirname "$dossier")")/$(basename "$dossier")"
  for e in $(yq -r '.chaine.grist.doc_id // {} | keys | .[]' "$manifeste"); do
    d=$(E="$e" yq -r '.chaine.grist.doc_id[strenv(E)] // ""' "$manifeste")
    [ -n "$d" ] && [ "$d" != "null" ] || continue
    case " $docs_vus " in
      *" $d "*)
        echo "doc Grist $d déclaré par $slug_doc ($e) et déjà par un autre couple produit/env — les deux collectes s'écraseraient" >&2
        exit 1 ;;
    esac
    docs_vus="$docs_vus $d"
  done
done <<EOF
$manifests
EOF


while IFS= read -r manifeste; do
  [ -n "$manifeste" ] || continue
  dossier=$(dirname "$manifeste")
  nom=$(basename "$dossier")
  departement=$(basename "$(dirname "$dossier")")
  slug="$departement/$nom"

  # Le chemin devient un nom de ressource Kubernetes : il doit être un label DNS.
  # Sans ce contrôle, `produits/Santé/BASAVI` passe Helm et se fait rejeter par l'API.
  # Le chemin sert aussi de VALEUR de label (mesure-impact/produit), qui ne tolère
  # pas de tiret en tête ni en queue — un nom de CronJob valide n'y suffit pas.
  case "$departement-$nom" in
    *[!a-z0-9-]* | -* | *- | "" )
      echo "$slug : dossier en minuscules, chiffres et tirets, sans tiret en tête ni en queue" >&2; exit 1 ;;
  esac

  # `mesure-impact-` + <dept>-<nom> + `-collect` doit tenir sous les 52 caractères
  # d'un nom de CronJob. Dépasser ne casse qu'au déploiement, après le build des images.
  if [ ${#departement} -gt 0 ] && [ $(( ${#departement} + ${#nom} + 1 )) -gt 30 ]; then
    echo "$slug : <departement>-<nom> dépasse 30 caractères, le CronJob serait rejeté" >&2; exit 1
  fi

  # Deux chemins distincts peuvent s'aplatir sur le même nom (a-b/c et a/b-c) :
  # même CronJob, même Secret, le dernier appliqué gagne en silence.
  aplati="$departement-$nom"
  case " $vus " in
    *" $aplati "*) echo "$slug : collision de nom avec un autre produit ($aplati)" >&2; exit 1 ;;
  esac
  vus="$vus $aplati"

  # `envs` doit être une liste d'envs connus. Sans ce contrôle, `envs: dev` (chaîne),
  # une clé absente ou une typo `prd` sortent le produit de l'inventaire en silence —
  # et `helm upgrade` supprime alors son CronJob sans que rien ne le signale.
  yq -e '.envs | tag == "!!seq"' "$manifeste" >/dev/null 2>&1 || {
    echo "$slug : le champ envs doit être une liste, ex. envs: [dev]" >&2; exit 1; }
  inconnus=$(yq -r '[.envs[] | select(. != "dev" and . != "prod")] | join(", ")' "$manifeste")
  [ -z "$inconnus" ] || {
    echo "$slug : env inconnu dans envs -> $inconnus (attendu: dev, prod)" >&2; exit 1; }

  # ENVCIBLE traverse yq par strenv() : l'env n'est jamais concaténé dans
  # l'expression, donc jamais interprété comme du yq.
  cible=$(ENVCIBLE="$env" yq -r '[.envs[] | select(. == strenv(ENVCIBLE))] | length' "$manifeste")
  [ "$cible" != "0" ] || { echo "  # $slug : non collecté en $env" >&2; continue; }

  # Chaque champ est obligatoire : un produit mal décrit doit casser le rendu,
  # pas produire un CronJob qui échouera silencieusement au premier run.
  lire() {
    local valeur
    valeur=$(ENVCIBLE="$env" yq -r "$1 // \"\"" "$manifeste")
    [ -n "$valeur" ] && [ "$valeur" != "null" ] || {
      echo "$slug : champ obligatoire absent de produit.yaml pour l'env $env -> $1" >&2; exit 1; }
    # Ces valeurs deviennent des variables d'environnement d'un conteneur : un
    # saut de ligne ou un guillemet n'y a rien à faire, et signale une tentative
    # d'injection plutôt qu'une faute de frappe.
    case "$valeur" in
      *[!A-Za-z0-9./:_-]*)
        echo "$slug : caractère interdit dans $1 (attendu: lettres, chiffres, . / : _ -)" >&2
        exit 1 ;;
    esac
    printf '%s' "$valeur"
  }

  matomo_url=$(lire '.chaine.matomo.url')
  matomo_site=$(lire '.chaine.matomo.site_id[strenv(ENVCIBLE)]')
  grist_url=$(lire '.chaine.grist.url')
  grist_doc=$(lire '.chaine.grist.doc_id[strenv(ENVCIBLE)]')
  # Le doc Grist est ÉCRIT : le partager entre dev et prod fait polluer la prod par
  # la préprod, c'est l'accident que la séparation par env existe pour empêcher.
  # Le site Matomo, lui, est seulement LU : mesurer un même site depuis deux envs
  # est légitime, on se contente de le signaler.
  autre=dev; [ "$env" = dev ] && autre=prod
  if AUTRE="$autre" yq -e '[.envs[] | select(. == strenv(AUTRE))] | length > 0' "$manifeste" >/dev/null 2>&1; then
    doc_ici=$(ENVCIBLE="$env" yq -r '.chaine.grist.doc_id[strenv(ENVCIBLE)] // ""' "$manifeste")
    doc_la=$(AUTRE="$autre" yq -r '.chaine.grist.doc_id[strenv(AUTRE)] // ""' "$manifeste")
    [ "$doc_ici" != "$doc_la" ] || {
      echo "$slug : le doc Grist est le même en $env et $autre ($doc_ici) — les deux envs écriraient au même endroit" >&2
      exit 1; }
    site_ici=$(ENVCIBLE="$env" yq -r '.chaine.matomo.site_id[strenv(ENVCIBLE)] // ""' "$manifeste")
    site_la=$(AUTRE="$autre" yq -r '.chaine.matomo.site_id[strenv(AUTRE)] // ""' "$manifeste")
    [ "$site_ici" != "$site_la" ] || \
      echo "$slug : note — $env et $autre lisent le même site Matomo ($site_ici)" >&2
  fi

  # Optionnel : le chart applique son schedule par défaut si absent.
  schedule=$(yq -r '.collecte.schedule // ""' "$manifeste")

  # L'entrée est construite par yq, jamais par concaténation : les valeurs passent
  # par strenv() et sont échappées par l'émetteur YAML. Un heredoc laisserait un
  # guillemet ou un saut de ligne dans produit.yaml injecter des clés arbitraires
  # dans l'inventaire — Helm garde la dernière clé dupliquée, en silence.
  SLUG="$slug" NOM="$nom" DEPT="$departement" \
  MURL="$matomo_url" MSITE="$matomo_site" GURL="$grist_url" GDOC="$grist_doc" \
  SCHED="$schedule" \
  yq -n '
    {
      "slug": strenv(SLUG),
      "nom": strenv(NOM),
      "departement": strenv(DEPT),
      "matomoUrl": strenv(MURL),
      "matomoSiteId": strenv(MSITE),
      "gristUrl": strenv(GURL),
      "gristDocId": strenv(GDOC)
    }
    | (select(strenv(SCHED) != "") | .schedule = strenv(SCHED)) // .
  ' | yq -P '[.]' | sed 's/^/  /'
done <<EOF
$manifests
EOF
