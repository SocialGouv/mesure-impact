// Tests de non-régression du tableau de bord (V1.2). Node pur, aucune dépendance :
// le <script> de dashboard.html est extrait et exécuté dans un vm, avec un DOM
// bouchonné dont on relit le innerHTML produit.
//
// Ce que ces tests verrouillent, et pourquoi : les deux modes d'échec de cette page
// sont un CHIFFRE FAUX affiché comme vrai (le pire sur un tableau de bord de pilotage)
// et une DONNÉE HOSTILE qui atteint innerHTML (l'endpoint de tracking Matomo est public).
// La V1.2 en ajoute un troisième : un tag récent lu comme « 0 » avant d'exister.
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
const PASSERELLE = ';this.__t = { S, render, mesures, get D(){ return D; } };';

let echecs = 0;
const verifier = (titre, condition, detail) => {
  console.log(`${condition ? '  ok  ' : 'ÉCHEC '}${titre}`);
  if (!condition) { echecs += 1; if (detail) console.log(`        ${detail}`); }
};

// Charge la page sur un jeu de tables, attend le premier rendu, et rend chaque onglet.
async function ouvrir(data) {
  const els = {};
  const noeud = (id) => els[id] || (els[id] = {
    id, _h: '', value: '', min: '', max: '', clientWidth: 1200,
    set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; },
    addEventListener() {}, setAttribute() {},
  });
  const journal = [];
  const ctx = {
    document: { getElementById: noeud, querySelectorAll: () => [] },
    window: { addEventListener() {}, BASAVI_DATA: data },
    setTimeout, clearTimeout, Intl, Math, Date, Number, String, Object, Array, Set, JSON, isFinite,
    console: { ...console, error: (...a) => journal.push(a.map(String).join(' ')) },
  };
  ctx.window.self = ctx.window;
  ctx.window.top = ctx.window; // hors Grist : load() renvoie BASAVI_DATA
  vm.createContext(ctx);
  vm.runInContext(source + PASSERELLE, ctx, { filename: 'dashboard.html' });
  await new Promise((r) => setTimeout(r, 0));
  const t = ctx.__t;
  const onglet = (id) => { t.S.tab = id; t.render(); return els.main.innerHTML; };
  return { t, els, journal, onglet };
}

// --- Fixtures -----------------------------------------------------------------------
const COLS = ['visites', 's_recherche', 's_resultats', 's_contact', 's_tel', 's_copie', 's_rech_multi', 's_filtre', 's_rech_sans_filtre',
  's_email', 's_site', 's_erreur', 's_sortie_urgence', 's_sortie_alv',
  's_f_violences_conjugales', 's_f_violences_sexuelles', 's_f_mutilations_sexuelles', 's_f_prostitution', 's_f_mariages_forces', 's_f_harcelement_sexuel'];
const sess = (day, champs = {}) => ({ day, device: 'tous', ...Object.fromEntries(COLS.map((c) => [c, 0])), ...champs });
const evt = (day, category, action, name, count) => ({ day, device: 'tous', category, action, name, count });
const meta = { extracted_at: '2026-11-01T06:00:00Z', source: 'Matomo réel, site 170' };
const tables = (s, e = [], m = []) => ({ sess: s, evt: e, modes: m, meta });

// --- Données hostiles : tout libellé venu du tracker est échappé ----------------------
{
  const { onglet } = await ouvrir(tables(
    [sess('2026-10-02', { visites: 10, s_recherche: 5, s_filtre: 2 })],
    [evt('2026-10-02', 'aide', 'clic_telephone', '<img src=x onerror=alert(1)>', 1),
      evt('2026-10-02', 'recherche', 'filtrer', '<svg onload=alert(2)>', 1)],
  ));
  const tout = ['synthese', 'utilisable', 'utilise', 'utile', 'lire'].map(onglet).join('');
  verifier('libellé hostile : aucune balise injectée', !/<img src=x|<svg onload/.test(tout));
  verifier('libellé hostile : le nom est rendu échappé', tout.includes('&lt;img src=x'));
}
{
  const { els } = await ouvrir({ ...tables([sess('2026-10-02', { visites: 3 })]), meta: { ...meta, source: '<b onmouseover=x>' } });
  verifier('source hostile : la ligne de source est échappée', !els['f-src'].innerHTML.includes('<b onmouseover'));
}

// --- Fenêtre vide : jamais de chiffre inventé ----------------------------------------
{
  const { onglet } = await ouvrir(tables([sess('2026-10-02')]));
  const tout = ['synthese', 'utilisable', 'utilise', 'utile'].map(onglet).join('');
  verifier('fenêtre vide : aucun NaN ni Infinity', !/NaN|Infinity/.test(tout));
  verifier('fenêtre vide : aucun 100 % inventé', !tout.includes('100,0 %'));
}

// --- Tag récent : « pas encore mesuré », jamais 0 ------------------------------------
{
  const s = [sess('2026-10-02', { visites: 100, s_contact: 20 })];
  const { onglet } = await ouvrir(tables(s, [evt('2026-10-02', 'recherche', 'lancer', 'geoloc', 5)]));
  const utile = onglet('utile');
  verifier('sorties sans tag : message d’attente affiché', utile.includes('La mesure démarre à la mise en production du tag'));
  verifier('sorties sans tag : pas de « Sans sortie identifiée » chiffré', !utile.includes('Sans sortie identifiée'));
  const utilisable = onglet('utilisable');
  verifier('géoloc sans tag : message d’attente, pas 0 %', utilisable.includes('Échecs de la géolocalisation : aucun event'));
}
{
  // Tag arrivé le 03/10 : la fenêtre 01/10 → 04/10 n'est lue qu'à partir du 03/10.
  const s = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map((d, i) => sess(d, { visites: 100, s_contact: i < 2 ? 50 : 10, s_sortie_urgence: i < 2 ? 0 : 5, s_sortie_alv: i < 2 ? 0 : 5 }));
  const e = [evt('2026-10-03', 'aide', 'clic_telephone', '3919', 5), evt('2026-10-04', 'navigation', 'retour_alv', '', 5)];
  const { onglet } = await ouvrir(tables(s, e));
  const utile = onglet('utile');
  verifier('sorties partielles : « mesuré depuis le 03/10 » annoncé', utile.includes('mesuré depuis le 03/10'));
  // Sur 03-04/10 : 200 sessions, 20 contacts, 10 urgence, 10 ALV, 160 sans sortie = 80 %.
  verifier('sorties partielles : la base est celle des jours mesurés (80 % sans sortie)', /Sans sortie identifiée[\s\S]*?80,0 %/.test(utile));
}

// --- Les sorties se partagent les sessions ---------------------------------------------
{
  const s = [sess('2026-10-05', { visites: 50, s_contact: 10, s_sortie_urgence: 5, s_sortie_alv: 5 })];
  const { onglet } = await ouvrir(tables(s, [evt('2026-10-05', 'aide', 'clic_sms', '114', 6)]));
  const utile = onglet('utile');
  const parts = [...utile.matchAll(/Portes de sortie[\s\S]*?<\/div><\/div><div class="box"/g)][0]?.[0] || '';
  const valeurs = [...parts.matchAll(/(\d+,\d) %<span class="nb">/g)].map((m) => Number(m[1].replace(',', '.')));
  verifier(`sorties : la somme vaut 100 % (${valeurs.join(' + ')})`, Math.abs(valeurs.reduce((a, b) => a + b, 0) - 100) < 0.2);
  verifier('sorties : le 114 est libellé SMS', utile.includes('114 (SMS)'));
}

// --- Filtres et parcours : les parts se recoupent --------------------------------------
{
  const s = [sess('2026-10-06', { visites: 100, s_recherche: 60, s_resultats: 70, s_rech_multi: 20, s_filtre: 5, s_rech_sans_filtre: 57, s_f_prostitution: 3, s_f_violences_conjugales: 4 })];
  const { onglet } = await ouvrir(tables(s));
  const utilise = onglet('utilise');
  verifier('filtres : ne cherchent pas = 100 − 5 − 57 = 38', utilise.includes('Ne cherchent pas 38,0 %'));
  verifier('filtres : recherches sans filtre = 57 sur 60 = 95 %', utilise.includes('95,0 %<span class="nb">57 sur 60'));
  verifier('filtres : détail en part des sessions qui filtrent (4 sur 5 = 80 %)', utilise.includes('80,0 %<span class="nb">4'));
  const synth = onglet('synthese');
  verifier('parcours : après 1 recherche = 60 − 20 = 40', /après 1 recherche[\s\S]*?40,0 %<span class="nb">40/.test(synth));
  verifier('parcours : après plusieurs = 20', /après plusieurs[\s\S]*?20,0 %<span class="nb">20/.test(synth));
}

// --- Contact par canal en sessions -----------------------------------------------------
{
  const s = [sess('2026-10-07', { visites: 200, s_contact: 30, s_site: 25, s_email: 6, s_tel: 2, s_copie: 3 })];
  const { onglet } = await ouvrir(tables(s));
  const utile = onglet('utile');
  verifier('canaux : le site vaut 25 sessions sur 200 = 12,5 %', utile.includes('12,5 %<span class="nb">25'));
  verifier('canaux : les 4 canaux sont rendus', ['Site de l’association', 'E-mail', 'Copie d’adresse', 'Téléphone'].every((c) => utile.includes(c)));
}

// --- Erreurs en sessions ---------------------------------------------------------------
{
  const s = [sess('2026-10-08', { visites: 1000, s_erreur: 7 })];
  const { onglet } = await ouvrir(tables(s, [evt('2026-10-08', 'erreur', '404', '', 10), evt('2026-10-08', 'erreur', '500', '', 4)]));
  const synth = onglet('synthese');
  verifier('erreurs : la part des sessions touchées est affichée (0,7 %)', synth.includes('0,7 %<span class="nb">7'));
  verifier('erreurs : le nombre d’erreurs reste lisible (14)', synth.includes('14 erreurs'));
}

console.log(echecs ? `\n${echecs} échec(s)` : '\nTous les tests passent.');
process.exit(echecs ? 1 : 0);
