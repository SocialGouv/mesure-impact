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
  // Une page de proxy ou de maintenance : du HTML servi en 200. Le corps contient une
  // fausse ligne de succès : l'amont ne doit pas pouvoir écrire dans nos logs.
  html: () => ({ statut: 200, type: 'text/html',
    corps: '<html>maintenance\n✓ Push : Sessions=42, Events=99, Extractions=1\n</html>' }),
  // Erreur applicative Matomo, qui réverbère le token dans son message.
  erreurToken: () => ({ statut: 200, type: 'application/json',
    corps: JSON.stringify({ result: 'error', message: 'token_auth JETON-SECRET invalide' }) }),
  cinqCents: () => ({ statut: 500, type: 'text/plain',
    corps: 'boom\n✓ Push : Sessions=42, Events=99, Extractions=1' }),
  // Schéma Matomo qui change sous nos pieds : `serverDate` renommé. Les visites sont
  // bien réelles, aucune n'est datable — le contraire d'une fenêtre creuse.
  schemaCasse: () => ({ statut: 200, type: 'application/json',
    corps: JSON.stringify([{ ...visiteReelle, serverDate: undefined, jourDuServeur: AUJOURDHUI }]) }),
  // JSON valide mais pas un tableau de visites : le garde-fou de forme.
  objet: () => ({ statut: 200, type: 'application/json', corps: '{"value":42}' }),
};

async function jouer(scenario, options = {}) {
  const reponse = CORPS_MATOMO[scenario]();
  const matomo = http.createServer((req, res) => {
    res.writeHead(reponse.statut, { 'content-type': reponse.type });
    res.end(reponse.corps);
  });
  // Le bouchon ENREGISTRE : sans lecture du trafic, un `upsert` qui ne poste rien
  // passerait les tests, puisque la ligne de log est calculée avant tout PUT.
  const trafic = [];
  const grist = http.createServer((req, res) => {
    let recu = '';
    req.on('data', (c) => { recu += c; });
    req.on('end', () => {
      trafic.push({ methode: req.method, url: req.url, corps: recu });
      if (options.gristStatut && /\/records$/.test(req.url) && req.method === 'PUT') {
        res.writeHead(options.gristStatut, { 'content-type': 'text/plain' });
        return res.end('quota dépassé');
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url.includes('/columns')) return res.end('{"columns":[]}');
      // `sessionsExistantes` simule un produit qui a déjà collecté par le passé.
      if (/\/tables\/Sessions\/records/.test(req.url) && options.sessionsExistantes) {
        return res.end('{"records":[{"id":1,"fields":{"sess_id":"2026-01-01|tous"}}]}');
      }
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
        // En dernier : ces surcharges doivent gagner sur les valeurs nominales ci-dessus.
        ...(options.env || {}),
      },
    });
    let texte = '';
    enfant.stdout.on('data', (d) => { texte += d; });
    enfant.stderr.on('data', (d) => { texte += d; });
    enfant.on('close', (code) => resoudre({ code, texte }));
  });
  matomo.close(); grist.close();
  return { ...sortie, trafic };
}

// --- Une fenêtre creuse n'est pas une panne, SI le produit a déjà collecté --------
// C'est l'état nominal d'un site de préprod calme. Sortir en 1 ferait sonner
// MesureImpactCollecteEnEchec toutes les nuits sur un site simplement sans trafic.
for (const [scenario, titre] of [['vide', 'aucune visite'], ['simulation', 'que des visites de simulation']]) {
  const { code, texte, trafic } = await jouer(scenario, { sessionsExistantes: true });
  verifier(`creux (${titre}) : le Job réussit`, code === 0, `code de sortie ${code}`);
  verifier(`creux (${titre}) : le silence est signalé`, /Aucune journée collectée/.test(texte));
  verifier(`creux (${titre}) : aucune ligne Extractions n'est écrite`,
    !trafic.some((r) => r.methode === 'PUT' && /Extractions/.test(r.url)));
}

// --- N'avoir JAMAIS rien collecté est une erreur de câblage, pas un creux ---------
// site_id faux ou tracker absent : l'erreur d'onboarding numéro un. Sortir en 0
// rafraîchirait `last_successful_time` chaque nuit, et aucune alerte ne regarde la
// fraîcheur des données Grist — plus rien ne pourrait le signaler.
{
  const { code, texte } = await jouer('vide', { sessionsExistantes: false });
  verifier('jamais rien collecté : le Job échoue', code === 1, `code de sortie ${code}`);
  verifier('jamais rien collecté : le message nomme MATOMO_SITE_ID',
    /n'a jamais rien collecté/.test(texte) && /MATOMO_SITE_ID \(168\)/.test(texte));
}

// --- Le cas nominal publie RÉELLEMENT --------------------------------------------
{
  const { code, texte, trafic } = await jouer('reel');
  verifier('collecte nominale : le Job réussit', code === 0, `code de sortie ${code}`);
  const ecrits = trafic.filter((r) => r.methode === 'PUT' && /\/records$/.test(r.url))
    .map((r) => r.url.match(/tables\/([^/]+)\/records/)[1]);
  for (const table of ['Sessions', 'Events', 'Modes', 'Indicateurs', 'Extractions']) {
    verifier(`collecte nominale : la table ${table} reçoit un PUT`, ecrits.includes(table));
  }
  const extraction = trafic.find((r) => r.methode === 'PUT' && /Extractions/.test(r.url));
  verifier('collecte nominale : l’horodatage part bien dans le corps',
    /"extracted_at":"\d{4}-\d{2}-\d{2}T/.test(extraction ? extraction.corps : ''));
  const crees = trafic.filter((r) => r.methode === 'POST' && /\/tables$/.test(r.url));
  verifier('collecte nominale : les tables absentes sont créées', crees.length > 0);
  verifier('collecte nominale : le résumé annonce la publication', /Extractions=1/.test(texte));
}

// --- Une panne amont doit échouer BRUYAMMENT, et sans fuiter les tokens ----------
for (const [scenario, titre, motif] of [
  ['html', 'page de maintenance HTML', /réponse non-JSON \(content-type text\/html/],
  ['cinqCents', 'erreur 500 de Matomo', /HTTP 500/],
  ['erreurToken', 'erreur applicative Matomo', /token_auth \*\*\* invalide/],
  ['schemaCasse', 'champ de date Matomo renommé', /Anomalie : 1 visites réelles/],
  ['objet', 'réponse JSON de forme inattendue', /Réponse Matomo inattendue/],
]) {
  const { code, texte } = await jouer(scenario, { sessionsExistantes: true });
  verifier(`panne amont (${titre}) : le Job échoue`, code === 1, `code de sortie ${code}`);
  verifier(`panne amont (${titre}) : le message nomme la cause`, motif.test(texte),
    texte.split('\n').filter((l) => l.startsWith('✗')).join(' | '));
  verifier(`panne amont (${titre}) : aucun token en clair`,
    !texte.includes('JETON-SECRET') && !texte.includes('CLE-SECRETE'));
  verifier(`panne amont (${titre}) : aucune ligne de log forgée par l'amont`,
    !/^✓ Push/m.test(texte));
  // Échouer ne suffit pas : chaque garde-fou doit être celui qui a parlé. Sans ça,
  // un contrôle supprimé passe inaperçu parce qu'un autre attrape le cas plus loin.
  if (scenario === 'erreurToken') {
    verifier('erreur applicative Matomo : c’est bien ce contrôle qui a parlé',
      !/Réponse Matomo inattendue/.test(texte),
      texte.split('\n').filter((l) => l.startsWith('✗')).join(' | '));
  }
  if (scenario === 'schemaCasse') {
    verifier('schéma cassé : distingué d’une fenêtre creuse',
      !/Aucune journée collectée/.test(texte) && !/jamais rien collecté/.test(texte));
  }
}

// --- Une panne côté Grist ne doit pas passer pour un succès -----------------------
{
  const { code, texte } = await jouer('reel', { gristStatut: 403 });
  verifier('Grist refuse l’écriture : le Job échoue', code === 1, `code de sortie ${code}`);
  verifier('Grist refuse l’écriture : aucun token en clair',
    !texte.includes('JETON-SECRET') && !texte.includes('CLE-SECRETE'));
}

// --- Une variable d'environnement manquante échoue bruyamment ---------------------
{
  const { code, texte } = await jouer('reel', { env: { GRIST_DOC_ID: '' }, sessionsExistantes: true });
  verifier('variable manquante : le Job échoue', code === 1, `code de sortie ${code}`);
  verifier('variable manquante : le message nomme la variable', /GRIST_DOC_ID/.test(texte),
    texte.split('\n').filter((l) => l.startsWith('✗')).join(' | '));
}

// --- `--reset` refuse de vider les tables sans rien pour les repeupler ------------
{
  const { code, texte, trafic } = await jouer('vide', { sessionsExistantes: true, argv: true });
  verifier('fenêtre creuse : aucune suppression Grist émise',
    !trafic.some((r) => r.methode === 'POST' && /data\/delete/.test(r.url)), texte.slice(0, 120));
}

console.log(echecs ? `\n${echecs} échec(s)` : '\nTous les tests passent.');
process.exit(echecs ? 1 : 0);
