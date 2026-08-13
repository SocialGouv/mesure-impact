// Runner du CronJob de collecte.
//
// Un CronJob par produit : le chart injecte PRODUIT=<dept>/<nom>, le runner charge le seul
// ETL concerné. Un produit qui échoue n'affecte donc pas la collecte des autres.
//
// La config non sensible (MATOMO_URL, MATOMO_SITE_ID, GRIST_URL, GRIST_DOC_ID) vient de
// produit.yaml via le chart ; seuls les deux tokens arrivent par le Secret déscellé.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PRODUIT = process.env.PRODUIT;
if (!PRODUIT) {
  throw new Error(
    "PRODUIT n'est pas défini. Le chart l'injecte depuis produit.yaml (ex. PRODUIT=sante/basavi)."
  );
}
if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(PRODUIT)) {
  throw new Error(`PRODUIT invalide : « ${PRODUIT} ». Attendu <departement>/<nom> en minuscules.`);
}

const racine = dirname(fileURLToPath(import.meta.url));
const etl = join(racine, 'produits', PRODUIT, 'etl.mjs');
if (!existsSync(etl)) {
  throw new Error(`Aucun collecteur pour « ${PRODUIT} » : ${etl} est introuvable dans l'image.`);
}

console.log(`collecte du produit ${PRODUIT}`);
await import(etl);
