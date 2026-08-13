# Conventions & contribution

## Deux règles de documentation

1. **Avant de travailler une issue**, lire `doc/` pour le contexte (produit, architecture,
   décisions). L'issue ne se traite pas sans ce contexte.
2. **Avant de merger une PR**, la doc concernée est à jour. Une modif qui change un
   comportement, une décision ou la structure met à jour la page `doc/` correspondante.

Ces deux règles valent pour les humains (modèles de PR et d'issue) comme pour l'agent
(rappelées dans `CLAUDE.md`).

## Ajouter un produit

Voir `produits/README.md`. En résumé : copier `produits/sante/basavi/`, remplir `produit.yaml`,
adapter `etl.mjs`, poser `dashboard.html`, sceller les tokens, mettre à jour `doc/produit.md`.

## Sceller un secret

```bash
# Poser les valeurs dans l'environnement (jamais en clair sur la ligne de commande)
export MATOMO_URL=... MATOMO_SITE_ID=... MATOMO_TOKEN_AUTH=...
export GRIST_URL=... GRIST_DOC_ID=... GRIST_API_KEY=...
task seal ENV=dev     # produit envs/dev/sealed-secrets/tokens.sealedsecret.yaml (chiffré)
```

Seul le fichier **chiffré** est commité. Renouveler une clé = re-sceller + commiter.

## Critères d'achèvement

Chaque produit déclare ses critères dans `produit.yaml`. Ils définissent « c'est sain quand… »
et servent de portes de qualité : on ne considère un produit livré que si ses critères passent.

## Style

- Français, direct, concret.
- Pas de secret en clair, jamais, le dépôt est public.
- Commits courts et parlants ; une PR = une intention.
