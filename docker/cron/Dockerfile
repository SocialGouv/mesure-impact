# Collecteur Matomo → Grist. Node 20 (fetch natif), aucune dépendance npm.
FROM node:20-alpine
# node:20-alpine fournit déjà un utilisateur non-root `node` en uid 1000.
WORKDIR /app

# Le runner + les produits (chaque etl.mjs est du Node pur, sans install).
COPY docker/cron/collect.mjs /app/collect.mjs
COPY produits/ /app/produits/

USER 1000
ENTRYPOINT ["node", "/app/collect.mjs"]
