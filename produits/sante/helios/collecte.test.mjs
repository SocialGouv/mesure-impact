// Tests de bout en bout du collecteur HELIOS : l'ETL RÉEL est exécuté comme le fera
// le CronJob, contre des serveurs Matomo et Grist bouchonnés en local. Aucun réseau
// externe, aucune dépendance.
//
// Ce qui se joue ici : le code de SORTIE (0 = le Job réussit, 1 = il échoue et
// MesureImpactCollecteEnEchec sonne), ce qui part RÉELLEMENT vers Grist (aucun
// identifiant de visiteur), et la migration depuis l'ancien grain brut.
//
// Lancer : task test  —  ou  node produits/sante/helios/collecte.test.mjs

import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ici = path.dirname(fileURLToPath(import.meta.url));
const MOIS = new Date().toISOString().slice(0, 7);
const VID = 'feed0000beef0001';

let echecs = 0;
const verifier = (titre, condition, detail) => {
  console.log(`${condition ? '  ok  ' : 'ÉCHEC '}${titre}`);
  if (!condition) { echecs += 1; if (detail) console.log(`        ${detail}`); }
};
const erreurs = (texte) => texte.split('\n').filter((l) => l.startsWith('✗')).join(' | ');

const visiteReelle = {
  visitorId: VID, dimension1: 'ars', serverDate: `${MOIS}-02`,
  actionDetails: [
    { type: 'event', eventCategory: 'session', eventAction: 'connexion' },
    { type: 'event', eventCategory: 'export', eventAction: 'lancer', eventName: 'fiche_et' },
    { type: 'event', eventCategory: 'indicateur', eventAction: 'utilisateurs_actifs', eventName: 'ars', eventValue: 5, timestamp: 10 },
    { type: 'event', eventCategory: 'indicateur', eventAction: 'utilisateurs_inactifs', eventName: 'ars', eventValue: 23, timestamp: 10 },
  ],
};

const CORPS_MATOMO = {
  vide: () => ({ statut: 200, type: 'application/json', corps: '[]' }),
  reel: () => ({ statut: 200, type: 'application/json', corps: JSON.stringify([visiteReelle]) }),
  // Schéma Matomo qui change : l'identifiant de visiteur est renommé.
  sansVisiteur: () => ({ statut: 200, type: 'application/json',
    corps: JSON.stringify([{ ...visiteReelle, visitorId: undefined, visiteur: VID }]) }),
  html: () => ({ statut: 200, type: 'text/html', corps: '<html>maintenance\n✓ Push : Events=42\n</html>' }),
  erreurToken: () => ({ statut: 200, type: 'application/json',
    corps: JSON.stringify({ result: 'error', message: 'token_auth JETON-SECRET invalide' }) }),
  cinqCents: () => ({ statut: 500, type: 'text/plain', corps: 'boom\n✓ Push : Events=42' }),
  objet: () => ({ statut: 200, type: 'application/json', corps: JSON.stringify({ 'Jean Dupont, 12 rue des Lilas': { ...visiteReelle, pageTitle: 'Fiche - 12 rue des Lilas' } }) }),
  // Réponse de visites coupée par un proxy : plus du JSON, mais pleine de données individuelles.
  tronque: () => ({ statut: 200, type: 'application/json', corps: JSON.stringify([{ ...visiteReelle, visitIp: '10.1.2.3', pageTitle: 'Fiche - 12 rue des Lilas' }]).slice(0, -5) }),
  cinqCentDeuxVisites: () => ({ statut: 502, type: 'application/json', corps: JSON.stringify([{ ...visiteReelle, pageTitle: 'Fiche - 12 rue des Lilas' }]) }),
  chaine: () => ({ statut: 200, type: 'application/json', corps: JSON.stringify(`Jean Dupont 12 rue des Lilas ${VID}`) }),
  panneSansSchema: () => ({ statut: 500, type: 'text/plain', corps: 'boom' }),
};

// `existant` décrit le doc Grist avant le run : tables présentes, colonnes, lignes.
const DOC_VIDE = { tables: [], colonnes: {}, lignes: {} };
const DOC_HERITE = {
  tables: ['Events', 'Base', 'KPI', 'Extractions'],
  colonnes: {
    Events: ['event_id', 'month', 'date', 'visitor_id', 'role', 'category', 'action', 'name', 'value'].map((id) => ({ id, fields: { isFormula: false } })),
    KPI: [{ id: 'kpi_id', fields: { isFormula: false } }, { id: 'utilisateurs_reguliers', fields: { isFormula: true, formula: 'len({...})' } }],
  },
  lignes: {
    Events: [
      { id: 11, fields: { event_id: `${VID}_1790845215_0`, month: MOIS, visitor_id: VID } },  // ancien grain, mois relu
      { id: 12, fields: { event_id: `${VID}_1700000000_0`, month: '2020-01', visitor_id: VID } }, // hors fenêtre
      { id: 13, fields: { event_id: '2020-01|ars|export|lancer|fiche_et', month: '2020-01', count: 3 } }, // agrégé, hors fenêtre
    ],
  },
};
// Même doc, sans aucun mois hors fenêtre : le seul où --reset est permis.
const DOC_DANS_FENETRE = { ...DOC_HERITE, lignes: { Events: [DOC_HERITE.lignes.Events[0]] } };
// Doc déjà migré : une seule ligne agrégée, aucun ancien grain.
const DOC_MIGRE = { tables: ['Events'], colonnes: {}, lignes: { Events: [{ id: 1, fields: { event_id: `${MOIS}|ars|liste|creer|`, month: MOIS, count: 1 } }] } };
// Historique AGRÉGÉ hors fenêtre, sans ligne héritée qui l'englobe : --reset l'effacerait.
const DOC_HISTORIQUE = { ...DOC_HERITE, lignes: { Events: [DOC_HERITE.lignes.Events[0], DOC_HERITE.lignes.Events[2]] } };

async function jouer(scenario, options = {}) {
  const reponse = CORPS_MATOMO[scenario]();
  const doc = options.doc || DOC_VIDE;
  const matomo = http.createServer((req, res) => {
    res.writeHead(reponse.statut, { 'content-type': reponse.type });
    res.end(reponse.corps);
  });
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
      const table = (req.url.match(/tables\/([^/]+)/) || [])[1];
      if (/\/columns/.test(req.url)) return res.end(JSON.stringify({ columns: req.method === 'GET' ? (doc.colonnes[table] || []) : [] }));
      if (/\/records$/.test(req.url) && req.method === 'GET') return res.end(JSON.stringify({ records: doc.lignes[table] || [] }));
      if (/\/tables$/.test(req.url) && req.method === 'GET') return res.end(JSON.stringify({ tables: doc.tables.map((id) => ({ id })) }));
      if (/\/docs\/[^/]+$/.test(req.url)) return res.end('{"name":"Préprod - Hélios"}');
      return res.end('{}');
    });
  });
  await new Promise((r) => matomo.listen(0, '127.0.0.1', r));
  await new Promise((r) => grist.listen(0, '127.0.0.1', r));

  const sortie = await new Promise((resoudre) => {
    const enfant = spawn(process.execPath, [path.join(ici, 'etl.mjs'), ...(options.argv || [])], {
      env: {
        ...process.env,
        MATOMO_URL: `http://127.0.0.1:${matomo.address().port}`,
        MATOMO_SITE_ID: '162',
        MATOMO_TOKEN_AUTH: 'JETON-SECRET',
        GRIST_URL: `http://127.0.0.1:${grist.address().port}`,
        GRIST_DOC_ID: 'doc-test',
        GRIST_API_KEY: 'CLE-SECRETE',
        COLLECT_FROM: MOIS,
        PRODUIT: 'sante/helios',
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
const puts = (trafic, table) => trafic.filter((r) => r.methode === 'PUT' && new RegExp(`tables/${table}/records$`).test(r.url));
const lignesPoussees = (trafic, table) => puts(trafic, table).flatMap((r) => JSON.parse(r.corps).records.map((x) => x.fields));

// --- Le cas nominal publie RÉELLEMENT, et rien d'individuel ------------------------
{
  const { code, texte, trafic } = await jouer('reel');
  verifier('collecte nominale : le Job réussit', code === 0, `code ${code} · ${erreurs(texte)}`);
  for (const table of ['Events', 'Base', 'KPI', 'Extractions']) {
    verifier(`collecte nominale : la table ${table} reçoit un PUT`, puts(trafic, table).length > 0);
  }
  const versGrist = trafic.map((r) => r.url + r.corps).join('\n');
  verifier('donnée individuelle : aucun identifiant de visiteur envoyé à Grist', !versGrist.includes(VID));
  verifier('donnée individuelle : aucune colonne visitor_id créée', !/visitor_id/.test(versGrist));
  const kpi = lignesPoussees(trafic, 'KPI');
  const glob = kpi.find((k) => k.scope === 'global');
  verifier(`KPI : le nombre de réguliers part dans le corps (${glob && glob.utilisateurs_reguliers})`,
    glob && glob.utilisateurs_reguliers === 1 && kpi.length === 4);
  const base = lignesPoussees(trafic, 'Base')[0];
  verifier('Base : actifs et inactifs du rôle', base && base.role === 'ars' && base.actifs === 5 && base.inactifs === 23);
  const ev = lignesPoussees(trafic, 'Events');
  verifier('Events : grain agrégé avec effectif', ev.length === 2 && ev.every((e) => e.count === 1 && e.event_id.startsWith(`${MOIS}|ars|`)));
  const ex = puts(trafic, 'Extractions')[0];
  verifier('Extractions : upsert clé sur run_id', ex && 'run_id' in JSON.parse(ex.corps).records[0].require);
  verifier('collecte nominale : le résumé annonce la publication', /Extractions=1/.test(texte));
}

// --- Migration depuis l'ancien grain brut -----------------------------------------
{
  const { code, texte, trafic } = await jouer('reel', { doc: DOC_HERITE });
  verifier('migration : le Job réussit', code === 0, `code ${code} · ${erreurs(texte)}`);
  const retirees = trafic.filter((r) => r.methode === 'DELETE').map((r) => decodeURIComponent(r.url.split('/columns/')[1] || ''));
  verifier(`migration : visitor_id, date, value retirées d'Events (${retirees})`,
    ['visitor_id', 'date', 'value'].every((c) => retirees.includes(c)));
  const conv = trafic.find((r) => r.methode === 'PATCH' && /KPI\/columns/.test(r.url)
    && JSON.parse(r.corps).columns[0].id === 'utilisateurs_reguliers');
  verifier('migration : KPI.utilisateurs_reguliers repasse en colonne de données',
    conv && JSON.parse(conv.corps).columns[0].fields.isFormula === false);
  const suppr = trafic.filter((r) => /Events\/data\/delete/.test(r.url)).flatMap((r) => JSON.parse(r.corps));
  // L'ancien grain porte l'identifiant de visiteur dans sa clé : retiré quel que soit
  // son mois. Une ligne agrégée hors fenêtre, elle, est de l'historique : conservée.
  verifier(`migration : toutes les lignes de l'ancien grain sont retirées, l'historique agrégé reste (${suppr})`,
    suppr.includes(11) && suppr.includes(12) && !suppr.includes(13));
  const ordre = (motif) => trafic.findIndex(motif);
  const conversion = ordre((r) => r.methode === 'PATCH' && /KPI\/columns/.test(r.url) && JSON.parse(r.corps).columns[0].id === 'utilisateurs_reguliers');
  const retraitCol = ordre((r) => r.methode === 'DELETE' && /visitor_id/.test(r.url));
  verifier(`migration : KPI converti avant le retrait de visitor_id (${conversion} < ${retraitCol})`, conversion >= 0 && conversion < retraitCol);
  const premierPut = trafic.findIndex((r) => r.methode === 'PUT');
  const premiereSuppr = trafic.findIndex((r) => /Events\/data\/delete/.test(r.url));
  verifier('migration : le retrait suit le push (jamais de table vidée sans remplaçant)', premierPut >= 0 && premiereSuppr > premierPut);
}

// --- Identifiant de visiteur illisible : le RC1 n'est pas publié -------------------
{
  const { code, texte, trafic } = await jouer('sansVisiteur', { doc: DOC_HERITE });
  verifier('visitorId illisible : le Job échoue', code === 1, `code ${code}`);
  verifier('visitorId illisible : le message nomme la cause', /sans identifiant de visiteur/.test(texte), erreurs(texte));
  verifier('visitorId illisible : rien n’est écrit, supprimé ni migré',
    !trafic.some((r) => ['PUT', 'PATCH', 'DELETE'].includes(r.methode) || /data\/delete/.test(r.url) || (r.methode === 'POST' && /\/(tables|columns)$/.test(r.url))));
}

// --- Creux et câblage -------------------------------------------------------------
{
  const { code, texte, trafic } = await jouer('vide', { doc: DOC_MIGRE });
  verifier('creux : le Job réussit si le produit a déjà collecté', code === 0, `code ${code} · ${erreurs(texte)}`);
  verifier('creux : le silence est signalé', /Aucune visite sur/.test(texte));
  verifier('creux : ni écriture ni suppression', !trafic.some((r) => r.methode === 'PUT' || /data\/delete/.test(r.url)));
}
{
  const { code, texte } = await jouer('vide');
  verifier('jamais rien collecté : le Job échoue', code === 1, `code ${code}`);
  verifier('jamais rien collecté : le message nomme MATOMO_SITE_ID', /MATOMO_SITE_ID \(162\)/.test(texte), erreurs(texte));
}
{
  const { code } = await jouer('vide', { env: { ALLOW_EMPTY_COLLECT: 'sante/helios' } });
  verifier('ALLOW_EMPTY_COLLECT nominatif : toléré', code === 0, `code ${code}`);
  const autre = await jouer('vide', { env: { ALLOW_EMPTY_COLLECT: 'sante/basavi' } });
  verifier('ALLOW_EMPTY_COLLECT d’un autre produit : ne couvre pas HELIOS', autre.code === 1, `code ${autre.code}`);
  const vide = await jouer('vide', { env: { PRODUIT: '', ALLOW_EMPTY_COLLECT: '' } });
  verifier('sans PRODUIT ni liste : la tolérance ne s’applique pas', vide.code === 1, `code ${vide.code}`);
}

// --- Pannes amont : bruyantes, sans fuite de token --------------------------------
for (const [scenario, motif] of [
  ['html', /réponse non-JSON \(content-type text\/html/],
  ['cinqCents', /HTTP 500/],
  ['erreurToken', /token_auth \*\*\* invalide/],
  ['objet', /Réponse Matomo inattendue/],
  ['chaine', /Réponse Matomo inattendue/],
  ['tronque', /réponse non-JSON/],
  ['cinqCentDeuxVisites', /HTTP 502/],
]) {
  const { code, texte } = await jouer(scenario, { doc: DOC_HERITE });
  verifier(`panne amont (${scenario}) : le Job échoue`, code === 1, `code ${code}`);
  verifier(`panne amont (${scenario}) : le message nomme la cause`, motif.test(texte), erreurs(texte));
  verifier(`panne amont (${scenario}) : aucun token en clair`, !texte.includes('JETON-SECRET') && !texte.includes('CLE-SECRETE'));
  verifier(`panne amont (${scenario}) : aucune ligne de log forgée`, !/^✓ Push/m.test(texte));
  verifier(`panne amont (${scenario}) : aucun contenu de visite dans le log`, !texte.includes(VID) && !/Lilas/.test(texte));
}
{
  const { code, texte } = await jouer('reel', { gristStatut: 403 });
  verifier('Grist refuse l’écriture : le Job échoue', code === 1, `code ${code}`);
  verifier('Grist refuse l’écriture : aucun token en clair', !texte.includes('JETON-SECRET') && !texte.includes('CLE-SECRETE'));
}
{
  const { code, texte } = await jouer('reel', { env: { GRIST_DOC_ID: '' } });
  verifier('variable manquante : le Job échoue en la nommant', code === 1 && /GRIST_DOC_ID/.test(texte), erreurs(texte));
}
{
  const { code, texte } = await jouer('reel', { env: { COLLECT_FROM: '2026-13' } });
  verifier('COLLECT_FROM invalide : refusé', code === 1 && /COLLECT_FROM invalide/.test(texte), erreurs(texte));
}
{
  // Fenêtre nocturne : mois précédent + mois en cours, COLLECT_FROM n'étant qu'un plancher.
  const { trafic } = await jouer('reel', { env: { COLLECT_FROM: '2026-01' } });
  const kpiMois = [...new Set(lignesPoussees(trafic, 'KPI').map((k) => k.month))].sort();
  const precedent = new Date(`${MOIS}-01T00:00:00Z`); precedent.setUTCMonth(precedent.getUTCMonth() - 1);
  verifier(`fenêtre nocturne : deux mois relus (${kpiMois})`,
    kpiMois.join() === [precedent.toISOString().slice(0, 7), MOIS].join());
  const { trafic: t2 } = await jouer('reel', { argv: ['--from', '2026-01', '--to', '2026-03'] });
  verifier('--from explicite : la fenêtre demandée est relue',
    [...new Set(lignesPoussees(t2, 'KPI').map((k) => k.month))].join() === '2026-01,2026-02,2026-03');
  // Après une panne de plus d'un mois, la fenêtre repart du mois du dernier succès :
  // ce mois n'avait été écrit que partiellement.
  const d4 = new Date(`${MOIS}-01T00:00:00Z`); d4.setUTCMonth(d4.getUTCMonth() - 3);
  const dernier = d4.toISOString().slice(0, 7);
  const docPanne = { ...DOC_VIDE, tables: ['Extractions'], lignes: { Extractions: [{ id: 1, fields: { run_id: 'helios', extracted_at: `${dernier}-19T06:00:00.000Z` } }] } };
  const { trafic: t4 } = await jouer('reel', { doc: docPanne, env: { COLLECT_FROM: '2026-01' } });
  const relus4 = [...new Set(lignesPoussees(t4, 'KPI').map((k) => k.month))].sort();
  verifier(`après une panne : rattrapage depuis le dernier succès (${relus4[0]} → ${relus4.at(-1)})`,
    relus4[0] === dernier && relus4.at(-1) === MOIS && relus4.length === 4);
  // Migration : les mois couverts par l'ancien grain sont relus dans le même run.
  const { trafic: t5 } = await jouer('reel', { doc: DOC_HERITE, env: { COLLECT_FROM: '2020-01' } });
  const relus5 = [...new Set(lignesPoussees(t5, 'KPI').map((k) => k.month))].sort();
  verifier(`migration : relit depuis le plus ancien mois hérité (${relus5[0]})`, relus5[0] === '2020-01');
  // Un run manuel ne publie pas sous le run_id nocturne.
  const { trafic: t6 } = await jouer('reel', { argv: ['--from', MOIS] });
  const ex6 = lignesPoussees(t6, 'Extractions')[0];
  verifier(`run manuel : run_id distinct (${ex6 && ex6.run_id})`, ex6 && ex6.run_id === 'helios-manuel');
  const ex7 = lignesPoussees((await jouer('reel')).trafic, 'Extractions')[0];
  verifier('run nocturne : run_id helios', ex7 && ex7.run_id === 'helios');
  // Fenêtre vide : jamais un vert sans un seul appel Matomo.
  const docMigre = { ...DOC_VIDE, tables: ['Events'], lignes: { Events: [{ id: 1, fields: { event_id: `${MOIS}|ars|liste|creer|`, month: MOIS, count: 1 } }] } };
  // Un mois hérité revenu vide de Matomo : son ancien grain n'est pas détruit.
  const docHeriteVide = { ...DOC_VIDE, tables: ['Events'], lignes: { Events: [{ id: 1, fields: { event_id: 'aa_1_0', month: MOIS } }] } };
  const hv = await jouer('vide', { doc: docHeriteVide });
  verifier('ancien grain d’un mois revenu vide : refusé, rien de retiré',
    hv.code === 1 && /revenu\(s\) vide\(s\)/.test(hv.texte) && !hv.trafic.some((r) => /data\/delete/.test(r.url)), erreurs(hv.texte));
  // Run manuel sur un doc à l'ancien grain hors fenêtre : refusé avant toute écriture.
  const docHerite3 = { ...DOC_VIDE, tables: ['Events'], lignes: { Events: [
    { id: 1, fields: { event_id: 'aa_1_0', month: '2026-06' } }, { id: 2, fields: { event_id: 'aa_2_0', month: MOIS } }] } };
  const man = await jouer('reel', { doc: docHerite3, argv: ['--from', MOIS], env: { COLLECT_FROM: '2026-01' } });
  verifier('manuel + ancien grain hors fenêtre : refusé', man.code === 1 && /--from 2026-06/.test(man.texte), erreurs(man.texte));
  verifier('manuel refusé : rien d’écrit ni retiré', !man.trafic.some((r) => ['PUT', 'PATCH', 'DELETE'].includes(r.methode) || /data\/delete/.test(r.url)));
  // Nocturne : l'extension ne descend jamais sous le plancher.
  const docAncien = { ...DOC_VIDE, tables: ['Events'], lignes: { Events: [{ id: 1, fields: { event_id: 'aa_1_0', month: '2001-01' } }] } };
  const anc = await jouer('reel', { doc: docAncien, env: { COLLECT_FROM: MOIS } });
  const relusAnc = [...new Set(lignesPoussees(anc.trafic, 'KPI').map((k) => k.month))];
  verifier(`ancien grain sous le plancher : pas relu, retiré (${relusAnc})`, relusAnc.join() === MOIS
    && anc.trafic.some((r) => /Events\/data\/delete/.test(r.url) && JSON.parse(r.corps).includes(1)));
  const futur = await jouer('reel', { doc: docMigre, env: { COLLECT_FROM: '2099-01' } });
  verifier('COLLECT_FROM dans le futur : le Job échoue', futur.code === 1 && /Fenêtre vide/.test(futur.texte), erreurs(futur.texte));
  const { code, trafic: t3 } = await jouer('panneSansSchema', { doc: DOC_HERITE });
  verifier('panne Matomo : le schéma du doc n’est pas touché',
    code === 1 && !t3.some((r) => ['PATCH', 'DELETE'].includes(r.methode)));
}

// --- --reset : seule opération qui vide des tables entières -----------------------
{
  const { code, texte, trafic } = await jouer('vide', { doc: DOC_MIGRE, argv: ['--reset'] });
  verifier('--reset sur extraction creuse : refusé', code === 1 && /aucune ligne construite/.test(texte), erreurs(texte));
  verifier('--reset refusé : aucune suppression', !trafic.some((r) => /data\/delete/.test(r.url)));
}
{
  // Le doc contient 2020-01, hors de la fenêtre relue : vider l'effacerait.
  const { code, texte, trafic } = await jouer('reel', { doc: DOC_HISTORIQUE, argv: ['--reset'] });
  verifier('--reset avec un mois hors fenêtre : refusé', code === 1 && /effacerait tout l.*2020-01/.test(texte), erreurs(texte));
  verifier('--reset refusé : aucune suppression', !trafic.some((r) => /data\/delete/.test(r.url)));
  verifier('--reset refusé : le schéma n’est pas migré', !trafic.some((r) => ['PATCH', 'DELETE'].includes(r.methode)));
  // COLLECT_FROM borne aussi la fenêtre : le contrôle ne doit pas dépendre de la ligne de commande.
  const viaEnv = await jouer('reel', { doc: DOC_HISTORIQUE, argv: ['--reset'], env: { COLLECT_FROM: MOIS } });
  verifier('--reset borné par COLLECT_FROM : refusé aussi', viaEnv.code === 1, `code ${viaEnv.code}`);
}
{
  // Une ligne au mois illisible peut porter de l'historique : le reset refuse et la nomme.
  const docIllisible = { ...DOC_DANS_FENETRE, lignes: { ...DOC_DANS_FENETRE.lignes, KPI: [{ id: 9, fields: { month: null, utilisateurs_reguliers: 12 } }] } };
  const il = await jouer('reel', { doc: docIllisible, argv: ['--reset'] });
  verifier('--reset : une ligne au mois illisible bloque, nommée', il.code === 1 && /KPI n°9 au mois illisible/.test(il.texte), erreurs(il.texte));
  // Une ligne KPI sans réguliers (mois vide créé par l'ancien script) ne bloque pas.
  const docKpiVide = { ...DOC_DANS_FENETRE, lignes: { ...DOC_DANS_FENETRE.lignes, KPI: [{ id: 5, fields: { month: '2020-02', utilisateurs_reguliers: 0 } }] } };
  const kv = await jouer('reel', { doc: docKpiVide, argv: ['--reset'] });
  verifier('--reset : une ligne KPI de mois vide ne bloque pas', kv.code === 0, erreurs(kv.texte));
  const docKpiPlein = { ...DOC_DANS_FENETRE, lignes: { ...DOC_DANS_FENETRE.lignes, KPI: [{ id: 5, fields: { month: '2020-02', utilisateurs_reguliers: 3 } }] } };
  const kp = await jouer('reel', { doc: docKpiPlein, argv: ['--reset'] });
  verifier('--reset : une ligne KPI porteuse de réguliers hors fenêtre bloque', kp.code === 1, `code ${kp.code}`);
  const { code, trafic } = await jouer('reel', { doc: DOC_DANS_FENETRE, argv: ['--reset'] });
  verifier('--reset nominal : le Job réussit', code === 0, `code ${code}`);
  const premierVidage = trafic.findIndex((r) => /data\/delete/.test(r.url));
  const premierPut = trafic.findIndex((r) => r.methode === 'PUT');
  verifier(`--reset nominal : le vidage précède le push (${premierVidage} < ${premierPut})`,
    premierVidage >= 0 && premierPut >= 0 && premierVidage < premierPut);
}

console.log(echecs ? `\n${echecs} échec(s)` : '\nTous les tests passent.');
process.exit(echecs ? 1 : 0);
