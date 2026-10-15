// Tests de non-régression du tableau de bord HELIOS. Node pur, aucune dépendance :
// le <script> de dashboard.html est extrait et exécuté dans un vm, avec un DOM
// bouchonné dont on relit le innerHTML produit.
//
// Ce que ces tests verrouillent : depuis le passage au grain agrégé, une ligne Events
// porte son effectif dans `count`. Un widget qui compterait encore les LIGNES
// afficherait des volumes faux sans rien casser. Et les libellés viennent du tracker
// public : ils ne doivent pas atteindre innerHTML sans échappement.
//
// Lancer : task test  —  ou  node produits/sante/helios/dashboard.test.mjs

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(ici, 'dashboard.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (!scripts.length) throw new Error('aucun <script> inline trouvé dans dashboard.html');
const source = scripts.reduce((a, b) => (a.length > b.length ? a : b));
const PASSERELLE = `;this.__t = { set DATA(v){DATA=v}, get state(){return state}, aggEvents, renderAll };`;

function executer() {
  const els = {};
  const noeud = (id) => els[id] || (els[id] = {
    id, _h: '', className: '', style: {}, value: '', hidden: false, dataset: {},
    set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; },
    addEventListener() {}, classList: { add() {}, remove() {} },
  });
  const ctx = {
    document: { getElementById: noeud, querySelectorAll: () => [], addEventListener() {} },
    window: {}, setTimeout, clearTimeout, console,
  };
  ctx.window.self = ctx.window; ctx.window.top = {};
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(source + PASSERELLE, ctx, { filename: 'dashboard.html' });
  return { api: ctx.__t, els };
}

let echecs = 0;
const verifier = (titre, condition, detail) => {
  console.log(`${condition ? '  ok  ' : 'ÉCHEC '}${titre}`);
  if (!condition) { echecs += 1; if (detail) console.log(`        ${detail}`); }
};

const M = '2026-10';
const EVENTS = [
  { month: M, role: 'ars', category: 'export', action: 'lancer', name: 'fiche_et', count: 7 },
  { month: M, role: 'regional', category: 'export', action: 'lancer', name: 'fiche_et', count: 2 },
  { month: M, role: 'ars', category: 'recherche', action: 'simple', name: '', count: 12 },
  { month: M, role: 'ars', category: 'filtre', action: 'appliquer', name: '<img src=x onerror=alert(1)>', count: 1 },
];

const { api, els } = executer();
{
  const agg = api.aggEvents(EVENTS);
  const exp = agg.filter((e) => e.category === 'export').reduce((s, e) => s + e.n, 0);
  verifier(`aggEvents : somme les effectifs, ne compte pas les lignes (${exp})`, exp === 9);
  verifier('aggEvents : un count absent ou négatif ne compte pas pour 1',
    api.aggEvents([{ month: M, role: 'ars', category: 'liste', action: 'creer' }, { month: M, role: 'ars', category: 'liste', action: 'creer', count: -4 }])[0].n === 0);
}
{
  api.DATA = {
    kpi: [{ month: M, scope: 'global', utilisateurs_reguliers: 5, base_agents: 47, taux_reguliers_pct: 10.6, connexions: 6, exports: 9, comparaisons: 0, listes: 0 }],
    base: [{ month: M, role: 'ars', actifs: 5, inactifs: 23 }],
    events_agg: api.aggEvents(EVENTS),
    meta: { visits: 20, months: '2026-10', role_fill_pct: 25, extracted_at: '2026-10-15T06:00:00Z' },
  };
  api.renderAll();
  const adoption = els['p-adoption'].innerHTML;
  verifier('adoption : le RC1 est affiché', adoption.includes('10.6 %') && /5 réguliers \/ base 47/.test(adoption));
  const recherche = els['p-recherche'].innerHTML;
  verifier('recherche : 12 recherches simples, lues dans count', /<div class="big">12<\/div>/.test(recherche), recherche.slice(0, 300));
  verifier('libellé hostile : échappé avant innerHTML', !recherche.includes('<img') && recherche.includes('&lt;img'));
  const fonctio = els['p-fonctionnalites'].innerHTML;
  verifier('fonctionnalités : exports ventilés par source avec effectifs', /Fiche établissement<\/td><td class="num">9</.test(fonctio));
}

console.log(echecs ? `\n${echecs} échec(s)` : '\nTous les tests passent.');
process.exit(echecs ? 1 : 0);
