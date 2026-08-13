# Sert la page d'accueil et un dashboard par produit, sous /<departement>/<nom>/.
# Ces URL sont celles que les docs Grist chargent comme widget custom (cf. doc/decisions/0002).
FROM alpine:3.21 AS build
WORKDIR /out

COPY site/ ./
COPY produits/ /produits/

RUN set -eu; \
    liste=""; \
    for fichier in /produits/*/*/dashboard.html; do \
      [ -e "$fichier" ] || continue; \
      dossier=$(dirname "$fichier"); \
      nom=$(basename "$dossier"); \
      departement=$(basename "$(dirname "$dossier")"); \
      mkdir -p "/out/$departement/$nom"; \
      cp "$fichier" "/out/$departement/$nom/index.html"; \
      liste="$liste<li><a href=\"/$departement/$nom/\">$departement / $nom</a></li>"; \
      echo "publié: /$departement/$nom/"; \
    done; \
    [ -n "$liste" ] || liste="<li>aucun tableau de bord publié</li>"; \
    sed -i "s#<!--PRODUITS-->#$liste#" /out/index.html

# nginx-unprivileged : uid 101, écoute sur 8080, compatible readOnlyRootFilesystem
# (pid dans /tmp, cache dans /var/cache/nginx — tous deux montés en emptyDir).
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY --from=build /out/ /usr/share/nginx/html/
