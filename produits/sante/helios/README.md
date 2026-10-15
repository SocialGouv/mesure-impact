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
retient l'instantané le plus récent du mois. Un instantané incomplet (actifs sans inactifs)
n'est pas publié, et la base globale n'est calculée que si les trois rôles ont leur
instantané : sinon le RC1 global vaut « non calculable » plutôt qu'un taux gonflé. Plus de
réguliers que d'agents en base donne aussi un taux vide.

Le numérateur exige l'identifiant de visiteur Matomo. Il est lu par l'ETL, en mémoire, et
**seul le nombre** part dans Grist (`KPI.utilisateurs_reguliers`). Aucun identifiant de
visiteur n'est écrit sur la fabrique. Conséquences :

- chaque run recalcule les mois de sa fenêtre **en entier** (un nombre de visiteurs distincts
  ne se somme pas d'un jour sur l'autre). La fenêtre nocturne est le mois précédent + le mois
  en cours : un mois clos n'est plus réécrit, une purge des logs bruts Matomo ne peut donc
  pas le faire baisser en silence. Après une panne de plus d'un mois, la fenêtre repart du
  mois du dernier succès (lu dans Extractions), qui n'avait été écrit que partiellement.
  `COLLECT_FROM` n'est qu'un plancher. Un run manuel (`--from` ou `--to`) publie sous le
  `run_id` `helios-manuel` : il ne compte pas comme dernier succès nocturne, ni pour le
  widget qui en déduit les mois partiels. Lors de la migration depuis l'ancien grain brut, le
  run nocturne relit dans le même run les mois qu'il couvrait (jamais sous le plancher) ; un
  run manuel dont la fenêtre ne les couvre pas est refusé avant toute écriture ;
- le mois en cours est partiel : le widget le signale « (en cours) » et ne calcule pas
  d'évolution contre un mois complet. Un mois au taux vide (base incomplète ou incohérente)
  n'est ni affiché en pourcentage, ni tracé, ni pris comme référence d'évolution ;
- une connexion sans identifiant lisible fait échouer le run : publier quand même ferait
  tomber le RC1 à zéro en silence ;
- les lignes d'un mois recalculé que le run n'a pas produites sont retirées (combinaison
  disparue). Les lignes de l'ancien grain brut, dont la clé porte un identifiant de visiteur,
  sont retirées quel que soit leur mois. Un mois revenu vide de Matomo n'est pas touché ;
- les valeurs hors plan de tag sont comptées par emplacement (`nom=export/lancer/?`), jamais
  recopiées : elles peuvent être une saisie de l'agent. La valeur se retrouve dans Matomo.

Rôles : `ars`, `regional`, `central` (dimension de visite `dimension1`), plus le scope
`global` dans KPI, qui compte aussi les visiteurs sans rôle.

## Lancer la collecte en local (dev)

Poser les 6 variables du contrat dans un fichier `.env` local (gitignoré) à côté de ce
README, puis :

```bash
node produits/sante/helios/etl.mjs                 # fenêtre nocturne : mois précédent + mois en cours
node produits/sante/helios/etl.mjs --from 2026-05  # reconstruit l'historique depuis mai
```

`--reset` vide les tables entières : il est refusé tant que la fenêtre ne relit pas tous les
mois déjà présents dans le doc (`--reset --from 2026-05`).

Les formules Grist évitent le motif « `and` … `<` » sur une même ligne : le WAF devant
`grist.numerique.gouv.fr` le prend pour une injection SQL et répond 403. Un test le vérifie.

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
