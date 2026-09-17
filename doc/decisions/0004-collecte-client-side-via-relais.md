# 0004 — Collecte côté navigateur via un relais sur le domaine du produit

**Date** : 17/09/2026 · **Statut** : proposé (Philippe), à valider par le studio tech (Jo)

## Décision

Pour échapper aux bloqueurs de publicité, les produits gardent la **mesure côté navigateur**
et font passer les appels à Matomo par un **relais sur leur propre domaine**. Le contrat du
relais est commun à tous les produits ; son implémentation dépend de la stack. Détail et
exemples : [`doc/collecte-relais-matomo.md`](../collecte-relais-matomo.md).

## Pourquoi

- Une **émission côté serveur** (le back du produit appelle l'API de tracking) avait été
  étudiée. Elle obligeait chaque produit à gérer un token Matomo, un identifiant visiteur
  calculé, un envoi asynchrone et un point de collecte sécurisé : trop lourd à reproduire
  sur tout le portefeuille.
- Le relais ne change **ni le plan de tagging ni le code des events**. Il se résume à deux
  adresses dans le snippet et à une règle sur le serveur web, sans token dans le produit.
- Une solution existe déjà à la DNUM pour Next.js (`@socialgouv/matomo-next`).

## Conséquences

- Chaque produit choisit un préfixe neutre et met en place le relais selon sa stack.
- La recette inclut un test depuis un poste agent équipé du bloqueur.
- Le réglage de l'instance Matomo sur `X-Forwarded-For` est à trancher avec ses opérateurs.
- Le plan de tagging HELIOS repasse en client-side avec relais.
