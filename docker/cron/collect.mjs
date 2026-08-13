// Runner du CronJob de collecte.
//
// Pilote : un seul produit (BASAVI). Le socle injecte le Secret déscellé (envFrom) dans
// l'environnement, l'ETL du produit le lit via le contrat de variables commun.
//
// Généralisation à venir (multitenance, côté chart) : boucler sur produits/*/*/etl.mjs avec
// un jeu de secrets par produit. Cf. doc/architecture.md.
import './produits/sante/basavi/etl.mjs';
