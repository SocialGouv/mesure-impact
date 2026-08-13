# Doc technique — déploiement

## Le modèle à deux environnements

Deux environnements séparés cohabitent sur le cluster :

| | préprod (`dev`) | prod |
|---|---|---|
| Namespace | `mesure-impact-dev` | `mesure-impact-prod` |
| URL | `mesure-impact-dev.ovh.fabrique…` | `mesure-impact.ovh.fabrique…` |
| Déclencheur | push sur `main` (**auto**) | `workflow_dispatch` env=prod (**manuel**) |

**Partagé** entre les deux : le code (`etl.mjs`, `dashboard.html`), le chart, les images.
**Propre à chaque env** : ses valeurs (`envs/<env>/values.yaml`), son secret scellé, l'état de
son CronJob (suspendu ou non), sa cadence.

Un même dossier produit sert les deux envs. On ne duplique pas le code par env : seuls la
config et les secrets changent, portés par le secret scellé de chaque env.

## Déployer un produit, de bout en bout

1. Copier le moule `produits/<dept>/<produit>/`, remplir `produit.yaml`, adapter `etl.mjs`,
   poser `dashboard.html`.
2. Sceller les tokens de l'env (`task seal ENV=dev`) → fichier chiffré commité.
3. PR → la CI vérifie → relecture → merge sur `main` → **déploiement dev auto**.
4. Réveiller la collecte (`suspend: false`), vérifier que Grist se peuple, **repointer** le
   widget du doc Grist vers l'URL fabrique.
5. Itérer le front à chaque push.

## Passer de préprod à prod

Préprod et prod sont **deux chaînes indépendantes contre des sources différentes**. Le code
est identique ; seuls la config et les secrets scellés changent. Passer en prod, c'est
instancier le même produit contre les sources de prod.

Ce qui change, concrètement :

1. **Source Matomo** : un `MATOMO_SITE_ID` différent (le vrai site public au lieu du site de
   préprod), avec un token qui peut le lire.
2. **Destination Grist** : un `GRIST_DOC_ID` différent (un doc prod séparé, pour que les tests
   de préprod ne polluent jamais la prod), dans l'espace d'équipe durable, avec le compte de
   service en éditeur.
3. **Scellement** : `task seal ENV=prod` avec les 6 valeurs de prod → `envs/prod/sealed-secrets/`.
4. **Déploiement** : manuel et volontaire (`workflow_dispatch` env=prod), puis réveil du
   CronJob prod.
5. **Repointage** du widget du doc prod vers l'URL fabrique de prod.

Le secret scellé d'un env porte les **6 variables** (voir `architecture.md`), donc c'est lui
qui « pointe » vers le site et le doc de cet env. Sceller `dev` vs `prod` = pointer vers les
ressources de préprod vs de prod.

## Points à connaître (état actuel)

- **Emplacement des secrets** : `task seal` écrit dans `envs/<env>/sealed-secrets/` (un secret
  par env). Le dossier `produits/<produit>/secrets/` est la cible propre (un secret par produit),
  effective une fois la multitenance du chart faite (chantier socle).
- **Cadence** : défaut quotidien (`0 6 * * *`). Réglable par env (plus fréquent en préprod
  pendant les tests).
- **Split config/secret** : aujourd'hui les 4 pointeurs non sensibles (site, doc, URLs) sont
  scellés avec les 2 vrais secrets. Les séparer (pointeurs en clair, tokens seuls scellés) est
  une amélioration à discuter avec le socle.
