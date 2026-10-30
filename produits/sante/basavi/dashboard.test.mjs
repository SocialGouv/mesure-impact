// Tests de non-régression du tableau de bord (V1.2). Node pur, aucune dépendance :
// le <script> de dashboard.html est extrait et exécuté dans un vm, avec un DOM
// bouchonné dont on relit le innerHTML produit.
//
// Ce que ces tests verrouillent, et pourquoi : les deux modes d'échec de cette page
// sont un CHIFFRE FAUX affiché comme vrai (le pire sur un tableau de bord de pilotage)
// et une DONNÉE HOSTILE qui atteint innerHTML (l'endpoint de tracking Matomo est public).
// La V1.2 en ajoute un troisième : une mesure récente lue comme « 0 » avant d'exister.
//
// Les fixtures prennent des valeurs toutes différentes : deux compteurs égaux masquent
// une permutation, et une seule ligne d'appareil masque un segment ignoré.
//
// Lancer : task test  —  ou  node produits/sante/basavi/dashboard.test.mjs

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(ici, 'dashboard.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (!scripts.length) throw new Error('aucun <script> inline trouvé dans dashboard.html');
const source = scripts.reduce((a, b) => (a.length > b.length ? a : b));

// Passerelle vers les liaisons `let`/`const` du script, qui ne sont pas exposées
// sur l'objet global d'un contexte vm.
const PASSERELLE = ';this.__t = { S, render, appliquerPreset, get D(){ return D; } };';

let echecs = 0;
const verifier = (titre, condition, detail) => {
  console.log(`${condition ? '  ok  ' : 'ÉCHEC '}${titre}`);
  if (!condition) { echecs += 1; if (detail) console.log(`        ${String(detail).slice(0, 400)}`); }
};
// Texte visible d'un fragment : balises retirées, espaces resserrés.
const texte = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// Charge la page sur un jeu de tables, attend le premier rendu, et rend un onglet.
// `grist` : bouchon de l'API plugin ; absent, la page lit window.BASAVI_DATA.
async function ouvrir(data, { grist } = {}) {
  const els = {};
  const noeud = (id) => els[id] || (els[id] = {
    id, _h: '', value: '', min: '', max: '', clientWidth: 1200,
    set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; },
    addEventListener() {}, setAttribute() {},
  });
  const ctx = {
    document: { getElementById: noeud, querySelectorAll: () => [] },
    window: { addEventListener() {}, BASAVI_DATA: data },
    setTimeout, clearTimeout, Intl, Math, Date, Number, String, Object, Array, Set, JSON, isFinite, Promise,
    console: { ...console, error() {} },
  };
  ctx.window.self = ctx.window;
  ctx.window.top = grist ? {} : ctx.window;
  if (grist) { ctx.window.grist = grist; ctx.grist = grist; }
  vm.createContext(ctx);
  vm.runInContext(source + PASSERELLE, ctx, { filename: 'dashboard.html' });
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  const t = ctx.__t;
  const onglet = (id, reglages = {}) => { Object.assign(t.S, { tab: id }, reglages); if (reglages.per) t.appliquerPreset(); t.render(); return els.main.innerHTML; };
  return { t, els, onglet };
}

// --- Fixtures -----------------------------------------------------------------------
const COLS = ['visites', 's_recherche', 's_resultats', 's_contact', 's_tel', 's_copie', 's_rech_multi', 's_filtre', 's_rech_sans_filtre',
  's_email', 's_site', 's_erreur', 's_sortie_urgence', 's_sortie_alv',
  's_f_violences_conjugales', 's_f_violences_sexuelles', 's_f_mutilations_sexuelles', 's_f_prostitution', 's_f_mariages_forces', 's_f_harcelement_sexuel'];
const sess = (day, champs = {}, device = 'tous') => ({ day, device, ...Object.fromEntries(COLS.map((c) => [c, 0])), ...champs });
const evt = (day, category, action, name, count, device = 'tous') => ({ day, device, category, action, name, count });
const meta = (ext = '2026-12-31') => ({ extracted_at: `${ext}T06:00:00Z`, source: 'Matomo réel, site 170' });
const tables = (s, e = [], ext) => ({ sess: s, evt: e, modes: [], meta: meta(ext) });
const N = (j) => `2026-11-${String(j).padStart(2, '0')}`; // jours après la recette du tag (30/10)

// --- Données hostiles : tout libellé venu du tracker est échappé ----------------------
{
  const { onglet, els } = await ouvrir({ ...tables(
    [sess(N(2), { visites: 10, s_recherche: 5, s_filtre: 2 })],
    [evt(N(2), 'aide', 'clic_telephone', '<img src=x onerror=alert(1)>', 1),
      evt(N(2), 'recherche', 'filtrer', '<svg onload=alert(2)>', 1)],
  ), meta: { extracted_at: '2026-12-31', source: '<b onmouseover=x>' } });
  const tout = ['synthese', 'utilisable', 'utilise', 'utile', 'lire'].map((o) => onglet(o)).join('');
  verifier('libellé hostile : aucune balise injectée', !/<img src=x|<svg onload/.test(tout));
  verifier('libellé hostile : le numéro forgé est rendu échappé', tout.includes('&lt;img src=x'));
  verifier('source hostile : la ligne de source est échappée', !els['f-src'].innerHTML.includes('<b onmouseover'));
}

// --- Fenêtre vide : jamais de chiffre inventé ----------------------------------------
{
  const { onglet } = await ouvrir(tables([sess(N(2))]));
  const tout = ['synthese', 'utilisable', 'utilise', 'utile'].map((o) => onglet(o)).join('');
  verifier('fenêtre vide : aucun NaN ni Infinity', !/NaN|Infinity/.test(tout));
  verifier('fenêtre vide : aucun 100 % inventé', !tout.includes('100,0 %'));
}

// --- Mesure récente : « pas encore mesuré », jamais 0 --------------------------------
{
  const { onglet } = await ouvrir(tables([sess(N(2), { visites: 100, s_contact: 20 })], [evt(N(2), 'recherche', 'lancer', 'geoloc', 5)]));
  verifier('sorties sans tag : message d’attente affiché', onglet('utile').includes('La mesure démarre à la mise en production du tag'));
  verifier('sorties sans tag : pas de « Sans sortie identifiée » chiffré', !onglet('utile').includes('Sans sortie identifiée'));
  verifier('géoloc sans tag : message d’attente, pas 0 %', onglet('utilisable').includes('Échecs de la géolocalisation : aucun event'));
}
{
  // Tag arrivé le 03/11 : la fenêtre 01/11 → 04/11 n'est lue qu'à partir du 03/11.
  const s = [1, 2, 3, 4].map((j) => sess(N(j), { visites: 100, s_contact: j < 3 ? 50 : 10, s_sortie_urgence: j < 3 ? 0 : 6, s_sortie_alv: j < 3 ? 0 : 4 }));
  const e = [evt(N(3), 'aide', 'clic_telephone', '3919', 7), evt(N(4), 'navigation', 'retour_alv', '', 4)];
  const u = texte((await ouvrir(tables(s, e))).onglet('utile'));
  verifier('sorties partielles : « mesuré depuis le 03/11 » annoncé', u.includes('mesuré depuis le 03/11'));
  // Sur 03-04/11 : 200 sessions, 20 contacts, 12 urgence, 8 ALV, 160 sans sortie = 80 %.
  verifier('sorties partielles : la base est celle des jours mesurés', /Sans sortie identifiée 80,0 % 160/.test(u), u);
}
{
  // Un hit forgé (ou un essai) avant la recette n'ouvre pas la mesure plus tôt.
  const s = [sess('2026-10-05', { visites: 300, s_contact: 30 }), sess(N(3), { visites: 100, s_contact: 10, s_sortie_urgence: 6, s_sortie_alv: 4 })];
  const e = [evt('2026-10-05', 'aide', 'clic_telephone', '3919', 1), evt(N(3), 'aide', 'clic_telephone', '17', 6)];
  const u = texte((await ouvrir(tables(s, e))).onglet('utile'));
  verifier('hit avant la recette : la mesure part du 03/11, pas du 05/10', u.includes('mesuré depuis le 03/11'), u);
}
{
  // Une action `aide` hors plan de tag n'ouvre pas la mesure et n'est pas un clic d'urgence.
  const s = [sess(N(2), { visites: 100, s_contact: 10 }), sess(N(5), { visites: 100, s_contact: 10, s_sortie_urgence: 7, s_sortie_alv: 3 })];
  const e = [evt(N(2), 'aide', 'autre', '', 1), evt(N(5), 'aide', 'autre', '', 2), evt(N(5), 'aide', 'clic_sms', '114', 7)];
  const u = texte((await ouvrir(tables(s, e))).onglet('utile'));
  verifier('action aide forgée : la mesure part du 05/11', u.includes('mesuré depuis le 05/11'), u);
  verifier('action aide forgée : pas comptée dans les numéros', u.includes('Numéros d’urgence : 7 clics') && !u.includes('Non précisé'), u);
}

// --- Les sorties se partagent les sessions, sans permutation -------------------------
{
  const s = [sess(N(5), { visites: 50, s_contact: 10, s_sortie_urgence: 6, s_sortie_alv: 4 })];
  const u = texte((await ouvrir(tables(s, [evt(N(5), 'aide', 'clic_sms', '114', 6), evt(N(5), 'navigation', 'retour_alv', '', 4)]))).onglet('utile'));
  verifier('sorties : contact 20 %', u.includes('Contact avec une association 20,0 % 10'), u);
  verifier('sorties : urgence 12 % (6), distinct de l’ALV', u.includes('Numéro d’urgence 12,0 % 6'));
  verifier('sorties : ALV 8 % (4)', u.includes('Retour vers ALV 8,0 % 4'));
  verifier('sorties : sans sortie 60 % (30)', u.includes('Sans sortie identifiée 60,0 % 30'));
  verifier('sorties : le 114 est libellé SMS', u.includes('114 (SMS)'));
}

// --- Géolocalisation : échecs sur tentatives ------------------------------------------
{
  const s = [1, 2, 3].map((j) => sess(N(j), { visites: 40 }));
  const e = [evt(N(1), 'recherche', 'lancer', 'geoloc', 9), evt(N(2), 'recherche', 'geoloc_reussite', '', 7), evt(N(2), 'recherche', 'geoloc_echec', '', 3),
    evt(N(3), 'recherche', 'geoloc_reussite', '', 5), evt(N(3), 'recherche', 'geoloc_echec', '', 5)];
  const u = texte((await ouvrir(tables(s, e))).onglet('utilisable'));
  verifier('géoloc : mesurée depuis le premier event (02/11)', u.includes('mesuré depuis le 02/11'), u);
  verifier('géoloc : 8 échecs sur 20 tentatives = 40 %', u.includes('40,0 % 8 sur 20 tentatives'), u);
}

// --- Segment appareil : numérateur et base suivent le même segment -------------------
{
  const s = [sess(N(6), { visites: 300, s_contact: 60, s_site: 45 }), sess(N(6), { visites: 200, s_contact: 50, s_site: 30 }, 'mobile'), sess(N(6), { visites: 100, s_contact: 10, s_site: 15 }, 'desktop')];
  const { onglet } = await ouvrir(tables(s));
  const m = texte(onglet('utile', { dev: 'mobile' }));
  verifier('segment mobile : mise en relation 25 % (50 sur 200)', m.includes('25,0 % 50'), m);
  verifier('segment mobile : site 15 % (30 sur 200)', m.includes('15,0 % 30'));
  const d = texte(onglet('utile', { dev: 'desktop' }));
  verifier('segment ordinateur : site 15 % (15 sur 100) et contact 10 %', d.includes('15,0 % 15') && d.includes('10,0 % 10'), d);
}

// --- Canaux, filtres, parcours : valeurs distinctes ----------------------------------
{
  const s = [sess(N(7), { visites: 200, s_recherche: 120, s_resultats: 150, s_rech_multi: 30, s_contact: 40, s_site: 25, s_email: 9, s_tel: 3, s_copie: 5,
    s_filtre: 14, s_rech_sans_filtre: 108, s_f_prostitution: 4, s_f_violences_conjugales: 7 })];
  const { onglet } = await ouvrir(tables(s));
  const u = texte(onglet('utile'));
  verifier('canaux : site 12,5 %, e-mail 4,5 %, copie 2,5 %, téléphone 1,5 %',
    ['Site de l’association 12,5 % 25', 'E-mail 4,5 % 9', 'Copie d’adresse 2,5 % 5', 'Téléphone 1,5 % 3'].every((x) => u.includes(x)), u);
  const f = texte(onglet('utilise'));
  verifier('filtres : cherchent et filtrent = 120 − 108 = 12', f.includes('Cherchent et filtrent 6,0 % 12'), f);
  verifier('filtres : ne cherchent pas = 200 − 120 = 80 (complément de la tuile recherche)', f.includes('Ne cherchent pas 40,0 % 80'));
  verifier('filtres : recherches sans filtre = 108 sur 120 = 90 %', f.includes('90,0 % 108 sur 120'));
  verifier('filtres : détail parmi les sessions qui filtrent (7 sur 14 = 50 %)', f.includes('50,0 % 7'));
  const p = texte(onglet('synthese'));
  verifier('parcours : après 1 recherche = 120 − 30 = 90', p.includes('après 1 recherche 45,0 % 90'), p);
  verifier('parcours : après plusieurs = 30', p.includes('après plusieurs 15,0 % 30'));
}

// --- Erreurs en sessions ---------------------------------------------------------------
{
  const s = [sess(N(8), { visites: 1000, s_erreur: 7, s_recherche: 400 })];
  const p = texte((await ouvrir(tables(s, [evt(N(8), 'erreur', '404', '', 10), evt(N(8), 'erreur', '500', '', 4)]))).onglet('synthese'));
  verifier('erreurs : part des sessions touchées (7 sur 1000 = 0,7 %), pas sur la base recherche', p.includes('0,7 % 7'), p);
  verifier('erreurs : le nombre d’erreurs reste lisible (14)', p.includes('14 erreurs'));
}

// --- Période : jour d'extraction exclu, comparaison et signe -------------------------
{
  // 14 jours pleins puis le jour d'extraction (partiel), qui ne doit pas compter.
  const s = [...Array.from({ length: 14 }, (_, i) => sess(N(i + 1), { visites: 100, s_contact: i < 7 ? 10 : 30 })), sess(N(15), { visites: 1000, s_contact: 0 })];
  const { onglet, els } = await ouvrir(tables(s, [], N(15)));
  const u = texte(onglet('utile', { per: '7' }));
  verifier('période : le jour d’extraction est exclu', els['f-src'].innerHTML.includes('du 08/11 au 14/11'), els['f-src'].innerHTML);
  verifier('période : 30 % sur les 7 derniers jours', u.includes('30,0 % 210'), u);
  verifier('comparaison : +20 pts contre les 7 jours d’avant (sans chevauchement)', u.includes('▲ +20 pts'), u);
}

// --- Doc à l'ancien schéma : non mesuré, pas 0 ----------------------------------------
{
  const vieux = { day: N(9), device: 'tous', visites: 100, s_recherche: 60, s_resultats: 70, s_contact: 10, s_tel: 2, s_copie: 1 };
  const { onglet } = await ouvrir(tables([vieux], [evt(N(9), 'erreur', '404', '', 12), evt(N(9), 'aide', 'clic_telephone', '3919', 9)]));
  const p = texte(onglet('synthese'));
  verifier('ancien schéma : tuile erreur à –, pas 0,0 %', p.includes('Sessions touchées par une erreur – –') && p.includes('12 erreurs'), p);
  verifier('ancien schéma : 1 ou plusieurs recherches non chiffrés', p.includes('après 1 recherche –') && p.includes('après plusieurs –'), p);
  verifier('ancien schéma : sorties en attente, pas 0 %', onglet('utile').includes('La mesure démarre'));
  verifier('ancien schéma : usage des filtres non chiffré', !texte(onglet('utilise')).includes('Ne cherchent pas'));
}

// --- Table Extractions absente : la page s'affiche quand même ------------------------
{
  // Format colonnes de grist.docApi.fetchTable : { id: [...], col: [...] }.
  const cols = (rows) => ({ id: rows.map((_, k) => k + 1), ...Object.fromEntries(Object.keys(rows[0] || {}).map((c) => [c, rows.map((r) => r[c])])) });
  const T = { Sessions: cols([sess(N(10), { visites: 50, s_contact: 5 })]), Events: cols([]), Modes: cols([]) };
  const grist = { ready() {}, onRecords() {}, docApi: { fetchTable: (t) => T[t] ? Promise.resolve(T[t]) : Promise.reject(new Error(`Table not found "${t}"`)) } };
  const { els } = await ouvrir(null, { grist });
  verifier('Extractions absente : la page est rendue', !els.main.innerHTML.includes('Données indisponibles') && els.main.innerHTML.includes('Indicateurs principaux'), els.main.innerHTML);
}

console.log(echecs ? `\n${echecs} échec(s)` : '\nTous les tests passent.');
process.exit(echecs ? 1 : 0);
