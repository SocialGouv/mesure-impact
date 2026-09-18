# 0004 — Collecte côté navigateur via un relais sur le domaine du produit

**Date** : 17/09/2026 · **Statut** : **proposé**

Passe en **accepté** quand, et seulement quand, l'étape 2 de la recette est faite : une visite
depuis un poste agent réellement équipé du bloqueur, retrouvée dans Matomo. Tout le reste est
vérifié ; cette étape porte la prémisse entière de la décision et ne peut pas l'être depuis un
poste de développement.

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
  adresses dans le snippet et à une règle sur le serveur web ou quelques lignes dans
  l'application, sans token dans le produit.
- Une solution existe déjà à la DNUM pour Next.js (`@socialgouv/matomo-next`).

## Conséquences

- Chaque produit choisit un préfixe neutre et met en place le relais selon sa stack.
- La recette inclut un test depuis un poste agent équipé du bloqueur.
- Le relais masque l'IP avant de la transmettre (`/16` en IPv4, `/48` en IPv6). Côté instance,
  il reste à activer `proxy_client_headers[]`, `proxy_ip_read_last_in_list` et `proxy_ips[]` —
  à trancher avec les opérateurs de l'instance. Sans ce réglage, la mesure fonctionne mais la
  géolocalisation est fausse et les visiteurs sans cookie fusionnent.
- **Les exemples sont un catalogue, pas encore un artefact partagé.** Cinq implémentations
  portent le même contrat : chaque correction doit être rejouée cinq fois, et cette PR l'a déjà
  fait deux fois (écrasement de `X-Forwarded-For`, puis masquage de l'IP). Dès le **deuxième
  produit adoptant**, on publie depuis ce dépôt un sidecar nginx et un fragment de chart, et le
  catalogue devient la documentation de ce qu'ils font. Avant deux adoptants, l'artefact
  coûterait plus que la duplication qu'il évite.
- Le plan de tagging HELIOS repasse en client-side avec relais.
