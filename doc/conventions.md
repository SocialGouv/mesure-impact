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

Seuls les **deux tokens** sont scellés, et par produit. Le reste de la config (URLs, site
Matomo, doc Grist) vit en clair dans `produit.yaml` : la changer doit rester une PR relisible.

```bash
# Poser les valeurs dans l'environnement (jamais en clair sur la ligne de commande)
export MATOMO_TOKEN_AUTH=... GRIST_API_KEY=...
PRODUIT=sante/basavi ENV=dev task seal
# -> produits/sante/basavi/secrets/dev.sealedsecret.yaml (chiffré)
```

Seul le fichier **chiffré** est commité. Renouveler une clé = re-sceller + commiter. Un token
qui fuit ou qu'on révoque n'affecte que son produit.

## Critères d'achèvement

Chaque produit déclare ses critères dans `produit.yaml`. Ils définissent « c'est sain quand… »
et servent de portes de qualité : on ne considère un produit livré que si ses critères passent.

## Style

- Français, direct, concret.
- Pas de secret en clair, jamais, le dépôt est public.
- Commits courts et parlants ; une PR = une intention.
