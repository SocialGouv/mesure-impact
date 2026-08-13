# 0002 — Front embarqué dans Grist

**Date** : 13/08/2026 · **Statut** : acté (Jo, Philippe)

## Décision

Le front reste un **widget embarqué dans le doc Grist**. La fabrique remplace Netlify comme
hébergeur du fichier ; le doc Grist repointe vers la nouvelle URL.

## Pourquoi

- Le widget obtient ses données via l'API plugin Grist, **sans token dans la page**.
- Une page autonome et publique ne pourrait pas lire Grist sans exposer un token, ce qui est
  interdit sur un dépôt public.

## Conséquence

Après déploiement, mettre à jour l'URL du widget custom dans chaque doc Grist. Le fichier
`dashboard.html` peut dépendre de ressources externes (DSFR via CDN) : à surveiller côté CSP
de la fabrique, et à auto-héberger si besoin.
