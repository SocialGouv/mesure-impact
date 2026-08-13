# 0003 — Secrets scellés et clé Grist de service

**Date** : 13/08/2026 · **Statut** : acté (préprod) / en cours (prod)

## Décision

Les tokens Matomo et Grist ne figurent jamais en clair dans le dépôt (public). Ils sont
**scellés** (`task seal`) en SealedSecret chiffré, déchiffrable seulement par le cluster.

Pour la **prod**, la clé Grist sera celle d'un **compte de service** dédié (pas un compte
personnel), et les docs produits vivront côté espace d'équipe DNUM, pas dans un Grist perso.

## Pourquoi

- Survie de la chaîne : une clé ou un doc attachés à un compte personnel meurent avec lui.
- Moindre privilège : le compte de service n'a accès qu'aux docs produits.

## Conséquence

- Préprod : on démarre avec le token perso scellé (risque négligeable), pour prouver la chaîne.
- Prod : re-sceller avec la clé de service (une commande + un commit). Donner au compte de
  service l'accès éditeur au doc **avant** de basculer la clé (sinon la collecte échoue en 403).
- Déplacer un doc vers l'espace d'équipe garde son `doc_id` (pas de config à changer).
