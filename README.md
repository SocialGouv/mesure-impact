# mesure-impact

Collecte de données [Matomo](https://matomo.org/) et publication vers
[Grist](https://www.getgrist.com/), plus un tableau de bord statique.

## Démarrer

```bash
devbox install   # kubectl, helm, kubeseal, task, gh, jq, yq
task             # liste des commandes
```

## Structure

| Chemin | Rôle |
|---|---|
| `docker/cron/` | image du CronJob de collecte |
| `docker/web/` | image nginx servant `site/` |
| `site/` | tableau de bord statique |
| `chart/` | chart Helm (CronJob, Deployment, Service, Ingress) |
| `envs/<env>/values.yaml` | surcharges par environnement |
| `envs/<env>/sealed-secrets/` | tokens chiffrés (SealedSecrets) |
| `.github/workflows/deploy.yml` | build des images + déploiement |

## Environnements

| Env | Namespace | URL |
|---|---|---|
| dev | `mesure-impact-dev` | https://mesure-impact-dev.ovh.fabrique.social.gouv.fr |
| prod | `mesure-impact-prod` | https://mesure-impact.ovh.fabrique.social.gouv.fr |

Push sur `main` → déploiement `dev`. Déploiement `prod` : `workflow_dispatch` avec
`environment: prod`.

## Contribuer

Les secrets ne sont jamais commités en clair : `task seal ENV=dev` produit un SealedSecret
chiffré à partir de variables d'environnement. Voir [CLAUDE.md](CLAUDE.md) pour le détail de
l'infrastructure (projet Rancher, bot de déploiement, certificats).
