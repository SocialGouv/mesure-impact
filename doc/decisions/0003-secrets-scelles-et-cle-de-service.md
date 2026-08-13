# 0003 — Secrets scellés et compte de service Grist

**Date** : 13/08/2026 · **Statut** : acté

## Décision

Les tokens Matomo et Grist ne figurent jamais en clair dans le dépôt (public). Ils sont
**scellés** (`task seal`) en SealedSecret chiffré, déchiffrable seulement par le cluster.

L'accès Grist se fait via un **compte de service**, pas une clé personnelle. Grist supporte
nativement les comptes de service (feature développée par la DINUM) : **chaque utilisateur
peut en créer, en self-service**, chacun avec sa propre clé API et un accès restreint aux
documents choisis. Configuration via l'API.

## Pourquoi

- Survie de la chaîne : une clé personnelle meurt avec le compte.
- Moindre privilège : le compte de service n'a accès qu'aux docs produits, sa clé est scopée.
- Self-service : pas de dépendance à un admin ni à une boîte mail fonctionnelle.

## Conséquence

- On peut sceller une **clé de compte de service dès la préprod** (option « propre dès le
  jour 1 »), sans attendre personne.
- Donner au compte de service l'accès **éditeur** au doc **avant** de sceller sa clé (sinon la
  collecte échoue en 403).
- Déplacer un doc vers l'espace d'équipe garde son `doc_id` (pas de config à changer).

## Point ouvert (gouvernance)

Un compte de service créé sous un compte **personnel** reste rattaché à lui. Pour une survie
totale, le compte de service (et les docs) devraient être possédés par une **identité DNUM
durable**. À trancher avec Olivier, non bloquant pour le pilote.
