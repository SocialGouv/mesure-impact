# 0001 — Un dépôt, N tableaux de bord (monorepo)

**Date** : 13/08/2026 · **Statut** : acté (Jo, Olivier, Philippe)

## Décision

Tous les tableaux de bord d'impact vivent dans **un seul dépôt** (`mesure-impact`), rangés
sous `produits/<département>/<produit>/`. Le socle technique est mutualisé.

## Pourquoi

- Mutualise la plomberie (déploiement, images, CI, secrets) au lieu de la dupliquer par repo.
- Ajouter un produit devient copier un dossier, pas monter un projet.
- Cohérent avec l'objectif « un tableau de bord par produit » sur un large portefeuille.

## Conséquence

Le socle (chart, CI) doit devenir « conscient des produits » : boucler sur `produits/`.
C'est le chantier multitenance, porté côté infra.
