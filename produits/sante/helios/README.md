# HELIOS : tableau de bord d'adoption

Outil de consultation des établissements sanitaires et médico-sociaux (département Santé),
utilisé par les agents des ARS, les référents régionaux et l'administration centrale.
Ce tableau de bord mesure l'adoption : taux d'utilisateurs réguliers (RC1) par rôle,
fonctionnalités utilisées (comparaison, export, listes), recherche et navigation, par mois.

## La chaîne

```
Matomo (site 162) ──> etl.mjs ──> doc Grist « Préprod - Hélios » ──> dashboard.html (widget)
```

- **`etl.mjs`** : extrait les visites Matomo mois par mois, agrège au grain mois × rôle et
  peuple les 4 tables du doc Grist (Events, Base, KPI, Extractions). Node pur, aucune dépendance.
- **`dashboard.html`** : le front DSFR, embarqué comme widget dans le doc Grist.
- **`produit.yaml`** : les identifiants publics et les critères d'achèvement.
- **`secrets/`** : les tokens Matomo et Grist, **scellés** (chiffrés), jamais en clair.

## Le RC1, et pourquoi l'ETL compte lui-même les visiteurs

RC1 = visiteurs distincts ayant ouvert une session dans le mois (event `session/connexion`)
÷ agents en base (actifs + inactifs). La base arrive par des events dédiés
`indicateur/utilisateurs_actifs|inactifs`, rôle dans le nom, effectif dans la valeur ; on
retient l'instantané le plus récent du mois.

Le numérateur exige l'identifiant de visiteur Matomo. Il est lu par l'ETL, en mémoire, et
**seul le nombre** part dans Grist (`KPI.utilisateurs_reguliers`). Aucun identifiant de
visiteur n'est écrit sur la fabrique. Conséquences :

- chaque run recalcule les mois de la fenêtre **en entier** (un nombre de visiteurs distincts
  ne se somme pas d'un jour sur l'autre) ;
- une connexion sans identifiant lisible fait échouer le run : publier quand même ferait
  tomber le RC1 à zéro en silence ;
- les lignes d'un mois recalculé que le run n'a pas produites sont retirées (ancien grain
  brut, combinaison disparue). Un mois revenu vide de Matomo n'est pas touché.

Rôles : `ars`, `regional`, `central` (dimension de visite `dimension1`), plus le scope
`global` dans KPI, qui compte aussi les visiteurs sans rôle.

## Lancer la collecte en local (dev)

Poser les 6 variables du contrat dans un fichier `.env` local (gitignoré) à côté de ce
README, puis :

```bash
node produits/sante/helios/etl.mjs --from 2026-10
```

## État

Collecte de préprod prête (site Matomo 162, doc « Préprod - Hélios »), secret dev scellé.
Le doc Grist a été migré le 15/10/2026 vers le grain agrégé : colonnes `visitor_id`, `date`
et `value` retirées d'Events, `KPI.utilisateurs_reguliers` passé de formule à donnée.

L'accès Grist passe par le compte de service `mesure-impact` (décision 0003), éditeur du doc.
Le token Matomo scellé est celui de préprod, **en intérim** : à remplacer par un token dédié.

Points de vigilance :

- **Le script local `sandbox-impact/grist/preprod-etl.mjs` doit être arrêté.** Il écrit encore
  le grain brut, avec `visitor_id`, sur le même doc.
- Le widget servi par Netlify (`dnum-helios-shell`) doit être aligné sur `dashboard.html` :
  il lit désormais `Events.count` au lieu de compter les lignes.
- La prod (site Matomo 72) viendra avec son propre doc Grist et son propre secret.
