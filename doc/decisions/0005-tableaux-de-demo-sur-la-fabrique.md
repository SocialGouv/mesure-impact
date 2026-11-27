# 0005 : tableaux de démo et de préprod servis par la fabrique

**Date** : 29/10/2026 · **Statut** : **accepté** (27/11/2026)

Passait en **accepté** après le pilote Médlé : page servie par l'URL dev, widget du doc
« Démo - Médlé » rebranché dessus, onglets contrôlés. Pilote réussi, puis migration générale le
05/11/2026 : tous les tableaux sont servis par ce dépôt, les sites Netlify des widgets sont
hors ligne.

## Décision

Tous les tableaux, démo comprise, sont servis par l'image web de ce dépôt. Netlify n'héberge
plus aucun widget.

| Doc Grist | URL du widget |
|---|---|
| démo ou préprod | `https://mesure-impact-dev.ovh.fabrique.social.gouv.fr/<dept>/<nom>/` |
| prod | `https://mesure-impact.ovh.fabrique.social.gouv.fr/<dept>/<nom>/` |

Une démo sans collecte est un dossier `produits/<dept>/<nom>/` avec un `dashboard.html` seul
(voir `produits/README.md`, « Tableau sans collecte »).

## Pourquoi

- Les widgets vivaient sur un compte Netlify personnel, déployés à la main : pas de relecture,
  pas d'historique, et une dépendance à une seule personne.
- La 0002 avait déjà fait de ce dépôt l'hébergeur du front ; il restait les démos, gardées sur
  Netlify pour pouvoir les mettre à jour en une minute. L'URL dev se met à jour à
  chaque merge, ce qui suffit pour une démo.
- L'URL prod ne bouge qu'au déploiement prod manuel : un doc de prod n'affiche jamais une
  version non validée.

## Conséquences

- Une mise à jour de démo passe par une PR mergée sur `main`. Le délai entre le merge et la page en ligne
  est mesuré pendant le pilote.
- L'image ne publie que `dashboard.html` : les ressources sont embarquées dans la page, hors
  l'API plugin chargée depuis `grist.numerique.gouv.fr`.
- Les sites Netlify sont archivés deux semaines après la bascule de leur doc, puis supprimés.

## Versions côte à côte (19/11/2026)

Pour comparer deux itérations dans un même doc Grist, `produits/<dept>/<nom>/versions/<v>.html`
est publié sous `/<dept>/<nom>/<v>/` (boucle dans `docker/web/Dockerfile`). Premier usage :
Sites Eaux V1.1 à côté de la V1. Reste à faire boucler `task url` sur les `dashboard.html` plutôt
que sur les `produit.yaml`, pour contrôler aussi les démos.
