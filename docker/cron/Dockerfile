# Collecteur Matomo → Grist. Node 20 (fetch natif), aucune dépendance npm.
FROM node:20-alpine

# node:20-alpine fournit déjà l'utilisateur `node` en uid 1000, celui qu'attend
# le podSecurityContext du chart — ne pas en créer un second sur le même uid.
WORKDIR /app

# Racine du contenu en lecture seule pour l'uid 1000 : l'image n'écrit nulle part,
# le chart monte un emptyDir sur /tmp et impose readOnlyRootFilesystem.

# Le runner + les produits (chaque etl.mjs est du Node pur, sans install).
COPY docker/cron/collect.mjs /app/collect.mjs
COPY produits/ /app/produits/

# uid NUMÉRIQUE obligatoire, jamais `USER node` : avec runAsNonRoot le kubelet doit
# pouvoir constater que l'utilisateur n'est pas root sans résoudre /etc/passwd, sinon
# le pod échoue sur « container has runAsNonRoot and image has non-numeric user ».
USER 1000
ENTRYPOINT ["node", "/app/collect.mjs"]
