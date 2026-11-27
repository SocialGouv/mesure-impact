# 0006 : trois stratégies de collecte

**Date** : 27/11/2026 · **Statut** : **proposé**

Passe en **accepté** quand le premier produit de la stratégie C (D@CCORD ou Médlé) est collecté
en préprod : extraction lue à 6h, agrégats écrits dans Grist, contrôles en échec testés.

## Contexte

Le socle a été construit pour une seule source : Matomo. BASAVI et HELIOS s'en contentent. Mais
une partie des indicateurs d'un tableau ne passe pas par la navigation : volumes, délais,
statuts de dossiers, nombre de structures ou d'agents. Ces chiffres vivent dans la base du
produit.

HELIOS a contourné le problème : un cron applicatif compte les agents actifs le 1er du mois et
envoie le total à Matomo sous forme d'events. D@CCORD (environ 400 dépôts par jour, une
dizaine de blocs sur dix à lire en base) et Médlé (comptages par structure et par mois) ne
peuvent pas tout faire passer par Matomo.

## Décision

Un produit déclare l'une des trois stratégies suivantes. Le front, Grist et le déploiement ne
changent pas : seule la partie « extraire » de l'ETL diffère.

| | A. Matomo seul | B. Matomo + totaux poussés | C. Base lue par la collecte |
|---|---|---|---|
| Source | events de navigation | events de navigation + events serveur portant un total | events de navigation + extraction de la base du produit |
| Côté produit | plan de taggage, relais | plan de taggage, relais, un cron qui envoie le total à Matomo | plan de taggage, relais, une extraction prête avant 6h |
| Côté `mesure-impact` | ETL Matomo | ETL Matomo, qui sépare les events serveur | ETL Matomo + lecture de l'extraction, un secret de plus |
| Bon pour | usage pur | un ou deux totaux à petite cadence (mensuel) | volumes, délais, statuts, tout ce qui est compté par dossier |
| Exemple | BASAVI | HELIOS (base d'agents, le 1er du mois) | D@CCORD, Médlé (plans de taggage envoyés le 26/11/2026) |

### Règles de la stratégie C

- **Aucun identifiant dans l'extraction** : ni numéro de dossier, ni SIRET, ni nom, ni adresse.
  Une ligne par dossier est acceptée si elle ne permet de remonter à personne.
- **Des agrégats seulement dans Grist** : la collecte calcule, Grist ne reçoit que des comptages
  et des durées par mois (et par dimension utile).
- **Mode de livraison recommandé : un point d'accès authentifié.** Une route `GET` du produit
  renvoie l'extraction en JSON, protégée par un jeton dans `Authorization: Bearer`. Le jeton
  est scellé avec les autres secrets du produit (`secrets/<env>.sealedsecret.yaml`).
  Alternatives acceptées : une vue SQL en lecture seule (si la fabrique joint la base) ou un
  fichier déposé chaque nuit.
- **Tout ou rien** : si l'extraction manque, arrive hors délai ou échoue à un contrôle, la
  collecte n'écrit rien et sort en erreur. L'alerte `MesureImpactCollecteEnEchec` prévient.

## Conséquences

- `produit.yaml` déclarera la stratégie et, pour C, l'URL de l'extraction par env. Le contrat
  de variables (`doc/architecture.md`) gagnera une variable en clair (l'URL) et un secret (le
  jeton). Ce code n'existe pas encore : il arrivera avec le premier produit C, dans sa propre PR.
- Le guide d'exploitation (`doc/exploitation.md`) décrit comment vérifier chaque stratégie.
- La stratégie B reste réservée à quelques totaux : au-delà, elle surcharge Matomo et mélange
  usage et données métier.

## Alternatives écartées

- **Tout faire passer par Matomo** (étendre B) : Matomo n'est pas fait pour stocker des
  données métier, et un event perdu fausse un total sans que rien ne le signale.
- **Brancher Grist directement sur la base** : Grist n'a pas de connecteur base de données
  planifié, et on perdrait les contrôles et le calcul des agrégats côté collecte.
