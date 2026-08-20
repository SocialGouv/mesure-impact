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
- **`secrets/`** : les tokens Matomo et Grist, **scellés** (chiffrés), jamais en clair.

## Lancer la collecte en local (dev)

Poser les 6 variables du contrat (voir `produit.yaml` → `secrets_requis` + identifiants) dans
un fichier `.env` local (gitignoré) à côté de ce README, puis :

```bash
node produits/sante/basavi/etl.mjs --from 2026-08-06
```

## Sceller les tokens (préprod)

Depuis la racine du dépôt, avec les valeurs dans l'environnement :

```bash
export MATOMO_TOKEN_AUTH=... GRIST_API_KEY=...
PRODUIT=sante/basavi ENV=dev task seal
```

Produit `secrets/dev.sealedsecret.yaml` (chiffré, commitable). Seuls les deux tokens y sont ;
le site Matomo et le doc Grist restent en clair dans `produit.yaml`. Voir `doc/conventions.md`.

## État

Pilote, **collecte de préprod activée le 20/08/2026**. Les deux tokens sont scellés
(`secrets/dev.sealedsecret.yaml`) et `cron.suspend` est repassé à `false` dans
`envs/dev/values.yaml` : le CronJob tourne chaque nuit à 6h sur le site Matomo 168, vers le
doc Grist « Preprod - BASAVI ».

L'accès Grist passe par un **compte de service** (décision 0003), pas par une clé personnelle.
Il a l'accès éditeur au doc, vérifié en lecture et en écriture avant scellement.

Front en préprod, itéré au fil des retours de l'équipe produit. `dashboard.html` est aligné sur
la version servie aujourd'hui dans le doc Grist.

Trois points de vigilance :

- **La clé du compte de service expire le 31/12/2027.** Passé cette date la collecte s'arrête.
- Le compte de service est rattaché à un compte personnel. Le rattacher à une identité DNUM
  durable reste le point ouvert de la décision 0003.
- Un ETL local (LaunchAgent, toutes les heures) écrit encore sur le même doc. Il sera coupé
  dès la première collecte réussie de la fabrique. Le push étant idempotent, le recouvrement
  est sans conséquence.
