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
task seal ENV=dev
```

Produit `secrets/dev.sealedsecret.yaml` (chiffré, commitable). Voir `doc/conventions.md`.

## État

Pilote. Le CronJob reste suspendu tant que les tokens ne sont pas scellés.
Front en préprod, itéré au fil des retours équipe.
