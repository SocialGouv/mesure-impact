// Tests de bout en bout du collecteur : l'ETL RÉEL est exécuté comme le fera le
// CronJob, contre des serveurs Matomo et Grist bouchonnés en local. Aucun réseau
// externe, aucune dépendance.
//
// Pourquoi ce fichier existe : `etl.test.mjs` retire le point d'entrée pour tester
// l'agrégation. Toute la couche HTTP — `main()`, ses garde-fous, `upsert`,
// `ensureTable`, la redaction des tokens — n'était donc jouée nulle part, alors que
// c'est exactement le chemin qui s'exécute chaque nuit. Un site Matomo sans trafic
// faisait sortir le Job en erreur et sonner l'alerte, toutes les nuits.
//
// Ce qui se joue ici : le code de SORTIE. 0 = le Job réussit, 1 = il échoue,
// `backoffLimit` s'épuise et MesureImpactCollecteEnEchec sonne.
//
// Lancer : task test  —  ou  node produits/sante/basavi/collecte.test.mjs

import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ici = path.dirname(fileURLToPath(import.meta.url));
const AUJOURDHUI = new Date().toISOString().slice(0, 10);

let echecs = 0;
const verifier = (titre, condition, detail) => {
  console.log(`${condition ? '  ok  ' : 'ÉCHEC '}${titre}`);
  if (!condition) { echecs += 1; if (detail) console.log(`        ${detail}`); }
};

const visiteReelle = {
  visitorId: 'ffff0000ffff0000', serverDate: AUJOURDHUI, deviceType: 'smartphone',
  actionDetails: [
    { type: 'event', eventCategory: 'recherche', eventAction: 'lancer', eventName: 'saisie' },
    { type: 'event', eventCategory: 'contact', eventAction: 'clic_telephone', eventName: 'asso-1' },
  ],
};
// `ba5a51*` : les visites de simulation que l'ETL écarte lui-même.
const visiteSimulee = { ...visiteReelle, visitorId: 'ba5a51deadbeef00' };

const CORPS_MATOMO = {
  vide: () => ({ statut: 200, type: 'application/json', corps: '[]' }),
  simulation: () => ({ statut: 200, type: 'application/json', corps: JSON.stringify([visiteSimulee]) }),
  reel: () => ({ statut: 200, type: 'application/json', corps: JSON.stringify([visiteReelle]) }),
  // Une page de proxy ou de maintenance : du HTML servi en 200.
  html: () => ({ statut: 200, type: 'text/html', corps: '<html>maintenance</html>' }),
  // Erreur applicative Matomo, qui réverbère le token dans son message.
  erreurToken: () => ({ statut: 200, type: 'application/json',
    corps: JSON.stringify({ result: 'error', message: 'token_auth JETON-SECRET invalide' }) }),
  cinqCents: () => ({ statut: 500, type: 'text/plain', corps: 'boom' }),
};

async function jouer(scenario) {
  const reponse = CORPS_MATOMO[scenario]();
  const matomo = http.createServer((req, res) => {
    res.writeHead(reponse.statut, { 'content-type': reponse.type });
    res.end(reponse.corps);
  });
  const grist = http.createServer((req, res) => {
    let recu = '';
    req.on('data', (c) => { recu += c; });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url.includes('/columns')) return res.end('{"columns":[]}');
      if (req.url.includes('/records')) return res.end('{"records":[]}');
      if (req.url.includes('/tables')) return res.end('{"tables":[]}');
      return res.end('{}');
    });
  });
  await new Promise((r) => matomo.listen(0, '127.0.0.1', r));
  await new Promise((r) => grist.listen(0, '127.0.0.1', r));

  const sortie = await new Promise((resoudre) => {
    const enfant = spawn(process.execPath, [path.join(ici, 'etl.mjs')], {
      env: {
        ...process.env,
        MATOMO_URL: `http://127.0.0.1:${matomo.address().port}`,
        MATOMO_SITE_ID: '168',
        MATOMO_TOKEN_AUTH: 'JETON-SECRET',
        GRIST_URL: `http://127.0.0.1:${grist.address().port}`,
        GRIST_DOC_ID: 'doc-test',
        GRIST_API_KEY: 'CLE-SECRETE',
        COLLECT_FROM: '2026-08-06',
      },
    });
    let texte = '';
    enfant.stdout.on('data', (d) => { texte += d; });
    enfant.stderr.on('data', (d) => { texte += d; });
    enfant.on('close', (code) => resoudre({ code, texte }));
  });
  matomo.close(); grist.close();
  return sortie;
}

// --- Une fenêtre sans trafic n'est pas une panne ---------------------------------
// C'est l'état nominal d'un site de préprod, et celui de tout produit au jour de son
// onboarding. Sortir en 1 fait sonner MesureImpactCollecteEnEchec toutes les nuits.
for (const [scenario, titre] of [['vide', 'aucune visite'], ['simulation', 'que des visites de simulation']]) {
  const { code, texte } = await jouer(scenario);
  verifier(`fenêtre sans trafic (${titre}) : le Job réussit`, code === 0, `code de sortie ${code}`);
  verifier(`fenêtre sans trafic (${titre}) : le silence est signalé`,
    /Aucune journée collectée/.test(texte));
  verifier(`fenêtre sans trafic (${titre}) : l’horodatage n’est pas rafraîchi`,
    !/Extractions=1/.test(texte));
}

// --- Le cas nominal publie et le dit ---------------------------------------------
{
  const { code, texte } = await jouer('reel');
  verifier('collecte nominale : le Job réussit', code === 0, `code de sortie ${code}`);
  verifier('collecte nominale : les 5 tables sont poussées', /Extractions=1/.test(texte));
}

// --- Une panne amont doit échouer BRUYAMMENT, et sans fuiter les tokens ----------
for (const [scenario, titre] of [['html', 'page de maintenance HTML'], ['cinqCents', 'erreur 500'],
  ['erreurToken', 'erreur applicative Matomo']]) {
  const { code, texte } = await jouer(scenario);
  verifier(`panne amont (${titre}) : le Job échoue`, code === 1, `code de sortie ${code}`);
  if (scenario === 'html') {
    verifier('panne amont (HTML) : le message nomme le content-type, pas une SyntaxError',
      /réponse non-JSON \(content-type text\/html/.test(texte) && !/SyntaxError/.test(texte),
      texte.split('\n').filter((l) => l.startsWith('✗')).join(' | '));
  }
  verifier(`panne amont (${titre}) : aucun token en clair dans la sortie`,
    !texte.includes('JETON-SECRET') && !texte.includes('CLE-SECRETE'),
    texte.split('\n').filter((l) => l.includes('JETON') || l.includes('CLE-')).join(' | '));
}

console.log(echecs ? `\n${echecs} échec(s)` : '\nTous les tests passent.');
process.exit(echecs ? 1 : 0);
