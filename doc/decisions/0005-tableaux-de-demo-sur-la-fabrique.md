# 0005 : tableaux de démo et de préprod servis par la fabrique

**Date** : 29/10/2026 · **Statut** : **proposé**

Passe en **accepté** après le pilote Médlé : page servie par l'URL dev, widget du doc
« Démo - Médlé » rebranché dessus, onglets contrôlés.

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
  Netlify le 24/09 pour pouvoir les mettre à jour en une minute. L'URL dev se met à jour à
  chaque merge, ce qui suffit pour une démo.
- L'URL prod ne bouge qu'au déploiement prod manuel : un doc de prod n'affiche jamais une
  version non validée.

## Conséquences

- Chaque mise à jour d'une démo passe par une PR. Le délai entre le merge et la page en ligne
  est mesuré pendant le pilote.
- L'image ne publie que `dashboard.html` : les ressources sont embarquées dans la page.
- Les sites Netlify sont archivés deux semaines après la bascule de leur doc, puis supprimés.

## Suite prévue : versions côte à côte

Pour comparer deux itérations dans un même doc Grist, publier aussi
`produits/<dept>/<nom>/versions/<v>.html` sous `/<dept>/<nom>/<v>/`. Cela demande une boucle
de plus dans `docker/web/Dockerfile` : PR séparée, qui touche le socle.
