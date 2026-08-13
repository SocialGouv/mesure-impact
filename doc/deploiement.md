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
3. **Scellement** : `PRODUIT=<dept>/<nom> ENV=prod task seal` avec les deux tokens de prod
   → `produits/<dept>/<nom>/secrets/prod.sealedsecret.yaml`.
4. **Déploiement** : manuel et volontaire (`workflow_dispatch` env=prod), puis réveil du
   CronJob prod.
5. **Repointage** du widget du doc prod vers l'URL fabrique de prod.

Attention à ce qui distingue réellement les deux envs : le `MATOMO_SITE_ID` et le
`GRIST_DOC_ID` vivent dans `produit.yaml`, donc **en une seule version**. Viser un site ou un
doc différent en prod suppose de les rendre dépendants de l'env — voir « Reste à faire ».

## Points à connaître (état actuel)

- **Emplacement des secrets** : un secret scellé par produit et par env, dans
  `produits/<dept>/<nom>/secrets/<env>.sealedsecret.yaml`. Il ne porte que
  `MATOMO_TOKEN_AUTH` et `GRIST_API_KEY`.
- **Cadence** : défaut quotidien (`0 6 * * *`), surchargeable par produit via
  `collecte.schedule` dans `produit.yaml`, et par env via `envs/<env>/values.yaml`.
- **Un CronJob par produit** : nommé `mesure-impact-<dept>-<nom>-collect`. Un ETL qui échoue
  n'empêche pas les autres de collecter.

## Reste à faire

- **Pointeurs par env** : `produit.yaml` ne décrit qu'un jeu de site/doc. Tant qu'on ne l'a
  pas rendu conscient de l'env, dev et prod collectent la même source vers la même
  destination. À traiter avant d'ouvrir la prod.
