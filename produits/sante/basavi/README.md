# BASAVI — tableau de bord d'usage

Annuaire des structures d'aide aux femmes victimes de violences (département Santé).
Ce tableau de bord mesure l'usage réel : recherches lancées, mises en relation
(clic téléphone, copie d'adresse), abandon, par jour et par device.

## La chaîne

```
Matomo (site 168) ──> etl.mjs ──> doc Grist « Preprod - BASAVI » ──> dashboard.html (widget)
```

- **`etl.mjs`** : extrait les visites Matomo, agrège au grain jour × device, peuple les
  5 tables du doc Grist. Idempotent (rejouable sans doublon). Node pur, aucune dépendance.
- **`dashboard.html`** : le front DSFR, embarqué comme widget dans le doc Grist (il lit les
  données via l'API plugin Grist, aucun token dans la page).
- **`produit.yaml`** : les identifiants publics et les critères d'achèvement.
- Les tokens Matomo et Grist sont **scellés** (chiffrés), jamais en clair. Aujourd'hui
  `task seal` les écrit dans `envs/<env>/sealed-secrets/` ; le dossier `secrets/` de ce produit
  est la cible (un secret par produit), effective avec la multitenance du chart.

## Lancer la collecte en local (dev)

Poser les 6 variables du contrat (voir `produit.yaml` → `secrets_requis` + identifiants) dans
un fichier `.env` local (gitignoré) à côté de ce README, puis :

```bash
node produits/sante/basavi/etl.mjs --from 2026-08-06
```

## Sceller les tokens (préprod)

Depuis la racine du dépôt, avec les valeurs dans l'environnement :

```bash
task seal ENV=dev
```

Produit `envs/dev/sealed-secrets/tokens.sealedsecret.yaml` (chiffré, commitable). Voir
`doc/conventions.md`.

## État

Pilote. **Tokens de préprod scellés le 20/08/2026**, CronJob activé (`cron.suspend: false`
dans `envs/dev/values.yaml`), collecte quotidienne à 6h sur le site Matomo 168 vers le doc
Grist « Preprod - BASAVI ».

Front en préprod, itéré au fil des retours de l'équipe produit. `dashboard.html` est aligné
sur la version déployée (widget embarqué dans le doc Grist, servi aussi depuis Netlify).

Deux réserves connues :

- Les tokens scellés sont ceux d'un compte personnel. La version durable passe par un compte
  de service Grist et un token Matomo dédié, à faire avant la bascule en prod.
- L'ETL local (LaunchAgent sur le poste de Phil, toutes les heures) écrit encore sur le même
  doc. Il doit être coupé dès la première collecte réussie de la fabrique. Le push étant
  idempotent, un recouvrement passager est sans conséquence.
