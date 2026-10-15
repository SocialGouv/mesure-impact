// Tests de non-régression de l'agrégation ETL HELIOS. Node pur, aucune dépendance.
//
// `etl.mjs` appelle `main()` au chargement : le test en importe une copie privée
// dont la dernière ligne (le point d'entrée) est retirée et `build` exporté. Le
// reste du fichier est celui qui part en production, à l'octet près.
//
// Ce qui se joue ici :
// - le RC1 : visiteurs distincts ayant ouvert une session ÷ base d'agents. Le
//   numérateur dépend de l'identifiant de visiteur, que l'API Live renvoie dans
//   `visitorId` (et pas `idVisitor`). Le lire mal ramène le RC1 à zéro sans erreur.
// - la donnée individuelle : aucun identifiant de visiteur ne doit sortir de build().
// - le tracker public : catégorie, action et nom sont bornés par le plan de tag.
//
// Lancer : task test  —  ou  node produits/sante/helios/etl.test.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ici = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(ici, 'etl.mjs'), 'utf8');
const sansEntree = source.replace(/^main\(\)\.catch\(.*$/m, 'export { build, inconnus, PLAN, ROLES, EVENTS_COLS, BASE_COLS, KPI_COLS, EXTRACTIONS_COLS };');
if (sansEntree === source) throw new Error("le point d'entrée main() n'a pas été trouvé dans etl.mjs");

const copie = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'etl-helios-test-')), 'etl.mjs');
fs.writeFileSync(copie, sansEntree);
process.env.MATOMO_URL ||= 'https://matomo.invalid';
process.env.MATOMO_SITE_ID ||= '162';
process.env.MATOMO_TOKEN_AUTH ||= 'x';
process.env.GRIST_URL ||= 'https://grist.invalid';
process.env.GRIST_DOC_ID ||= 'x';
process.env.GRIST_API_KEY ||= 'x';
const { build, inconnus, PLAN, EVENTS_COLS, BASE_COLS, KPI_COLS, EXTRACTIONS_COLS } = await import(pathToFileURL(copie).href);

let echecs = 0;
const verifier = (titre, condition) => {
  console.log(`${condition ? '  ok  ' : 'ÉCHEC '}${titre}`);
  if (!condition) echecs += 1;
};

const MOIS = '2026-10';
// Forme réelle d'une visite de l'API Live : `visitorId` rempli, `idVisitor` absent.
const visite = (visitorId, role, evenements) => ({
  visitorId, dimension1: role, serverDate: `${MOIS}-03`,
  actionDetails: evenements.map(([eventCategory, eventAction, eventName, eventValue, timestamp]) =>
    ({ type: 'event', eventCategory, eventAction, eventName, eventValue, timestamp })),
});
const connexion = ['session', 'connexion'];
const kpi = (r, scope, mois = MOIS) => r.kpi.find((k) => k.month === mois && k.scope === scope);
const lignes = (r) => r.events.map((e) => `${e.role}|${e.category}|${e.action}|${e.name}×${e.count}`);

// --- Le RC1 compte des visiteurs DISTINCTS, lus dans `visitorId` ------------------
// C'est le test qui échoue si l'ETL lit `idVisitor` (vide dans l'API Live) : le
// numérateur tomberait à 0, ou à 1 si toutes les visites s'aplatissaient sur ''.
{
  const r = build([{ month: MOIS, visits: [
    visite('aaaa000000000001', 'ars', [connexion]),
    visite('aaaa000000000001', 'ars', [connexion]),        // même agent, 2e visite
    visite('aaaa000000000002', 'ars', [connexion]),
    visite('aaaa000000000003', 'regional', [connexion]),
    visite('aaaa000000000004', null, [connexion]),         // rôle absent : compte en global seulement
    visite('aaaa000000000005', 'central', [['recherche', 'simple']]), // sans connexion : pas régulier
  ] }]);
  verifier(`visitorId lu : 4 réguliers distincts en global (obtenu ${kpi(r, 'global').utilisateurs_reguliers})`,
    kpi(r, 'global').utilisateurs_reguliers === 4);
  verifier(`visitorId lu : 2 réguliers ARS distincts (obtenu ${kpi(r, 'ars').utilisateurs_reguliers})`,
    kpi(r, 'ars').utilisateurs_reguliers === 2);
  verifier('visitorId lu : 1 référent régional, 0 central',
    kpi(r, 'regional').utilisateurs_reguliers === 1 && kpi(r, 'central').utilisateurs_reguliers === 0);
  verifier('connexions : les 5 events sont comptés, doublons compris',
    r.events.filter((e) => e.category === 'session').reduce((s, e) => s + e.count, 0) === 5);
  verifier('aucune connexion anonyme signalée', r.connexionsAnonymes === 0);
}
{
  // Le repli `idVisitor` reste lu (autres méthodes de l'API), sans prendre le pas.
  const r = build([{ month: MOIS, visits: [{ idVisitor: 'bbbb000000000001', dimension1: 'ars',
    actionDetails: [{ type: 'event', eventCategory: 'session', eventAction: 'connexion' }] }] }]);
  verifier('repli idVisitor : le visiteur est compté', kpi(r, 'ars').utilisateurs_reguliers === 1);
}
{
  // Sans identifiant lisible, build() le DIT : main() refuse alors de publier.
  const r = build([{ month: MOIS, visits: [{ dimension1: 'ars', visitorId: '',
    actionDetails: [{ type: 'event', eventCategory: 'session', eventAction: 'connexion' }] }] }]);
  verifier('identifiant illisible : la connexion anonyme est remontée', r.connexionsAnonymes === 1);
}

// --- Aucun identifiant de visiteur ne sort de build() ----------------------------
{
  const vid = 'cafe0000deadbeef';
  const r = build([{ month: MOIS, visits: [visite(vid, 'ars', [connexion, ['export', 'lancer', 'fiche_et']])] }]);
  const sortie = JSON.stringify({ events: r.events, base: r.base, kpi: r.kpi });
  verifier('donnée individuelle : aucun visitorId dans les lignes publiées', !sortie.includes(vid));
  verifier('donnée individuelle : aucune colonne visitor_id',
    ![...r.events, ...r.base, ...r.kpi].some((l) => 'visitor_id' in l));
  verifier('donnée individuelle : le source de main() ne pousse aucun visitorId',
    !/visitor_?id\s*:/i.test(source.slice(source.indexOf('async function main'))));
}

// --- Base d'agents : instantané le plus récent du mois, rôle dans `name` ----------
{
  const r = build([{ month: MOIS, visits: [
    visite('c1', null, [
      ['indicateur', 'utilisateurs_actifs', 'ars', 99, 100],     // ancien instantané
      ['indicateur', 'utilisateurs_actifs', 'ars', 5, 300],      // le plus récent
      ['indicateur', 'utilisateurs_inactifs', 'ars', 23, 300],
      ['indicateur', 'utilisateurs_actifs', 'central', 6, 300],
      ['indicateur', 'utilisateurs_inactifs', 'central', 6, 300],
      ['indicateur', 'utilisateurs_actifs', 'regional', 4, 300],
      ['indicateur', 'utilisateurs_inactifs', 'regional', 3, 300],
    ]),
    // L'API Live sert les visites les plus récentes en premier : l'ordre ne doit pas compter.
    visite('c0', null, [['indicateur', 'utilisateurs_actifs', 'ars', 77, 50]]),
  ] }]);
  const ars = r.base.find((b) => b.role === 'ars');
  verifier(`base : l'instantané le plus récent gagne (ars actifs ${ars.actifs})`, ars.actifs === 5 && ars.inactifs === 23);
  const total = r.base.reduce((s, b) => s + b.actifs + b.inactifs, 0);
  verifier(`base : 47 agents au total (obtenu ${total})`, total === 47);
  verifier('base : les events indicateur ne gonflent pas Events', !r.events.some((e) => e.category === 'indicateur'));
}
{
  const r = build([{ month: MOIS, visits: [visite('c1', null, [
    ['indicateur', 'utilisateurs_actifs', 'inconnu', 3, 1],
    ['indicateur', 'utilisateurs_actifs', 'ars', 'beaucoup', 1],
    ['HELIOS', 'utilisateurs', 'actifs', 29, 1],                  // ancien format de test, sans rôle
  ])] }]);
  verifier('base : rôle ou valeur illisible écarté', r.base.length === 0);
  verifier('base : l’écart est signalé dans le canari', inconnus().includes('base='));
  verifier('ancien format HELIOS : ignoré sans bruit', !inconnus().includes('helios') && r.events.length === 0);
}

{
  // Un instantané incomplet (actifs reçus, inactifs perdus) n'est pas publié à 0.
  const r = build([{ month: MOIS, visits: [visite('c1', null, [['indicateur', 'utilisateurs_actifs', 'ars', 40, 1]])] }]);
  verifier('base incomplète : non publiée', r.base.length === 0);
  verifier('base incomplète : signalée', inconnus().includes('base=incomplete/ars'));
}

// --- RC1 de bout en bout sur la forme d'octobre 2026 : 5 réguliers / 47 agents ----
{
  const visites = [
    visite('base', null, [
      ['indicateur', 'utilisateurs_actifs', 'central', 6, 1], ['indicateur', 'utilisateurs_actifs', 'regional', 4, 1],
      ['indicateur', 'utilisateurs_actifs', 'ars', 5, 1], ['indicateur', 'utilisateurs_inactifs', 'central', 6, 1],
      ['indicateur', 'utilisateurs_inactifs', 'regional', 3, 1], ['indicateur', 'utilisateurs_inactifs', 'ars', 23, 1],
    ]),
    ...['a1', 'a2', 'a3', 'a4'].map((v) => visite(v, 'ars', [connexion])),
    visite('a1', 'ars', [connexion]),
    visite('r1', 'regional', [connexion]),
  ];
  const r = build([{ month: MOIS, visits: visites }]);
  const base = r.base.reduce((s, b) => s + b.actifs + b.inactifs, 0);
  const reg = kpi(r, 'global').utilisateurs_reguliers;
  verifier(`RC1 octobre : ${reg} / ${base} = ${(100 * reg / base).toFixed(1)} %`, reg === 5 && base === 47);
}

// --- Un mois revenu vide n'écrase pas ses réguliers déjà publiés ------------------
{
  const r = build([{ month: '2026-09', visits: [] }, { month: MOIS, visits: [visite('x', 'ars', [connexion])] }]);
  verifier('mois vide : ligne KPI présente mais sans nombre de réguliers',
    kpi(r, 'global', '2026-09') && !('utilisateurs_reguliers' in kpi(r, 'global', '2026-09')));
  verifier('mois vide : non compté parmi les mois relus', !r.moisRelus.has('2026-09') && r.moisRelus.has(MOIS));
  verifier('mois lu : 4 lignes KPI (global + 3 rôles)', r.kpi.filter((k) => k.month === MOIS).length === 4);
}

// --- Le plan de tag borne le tracker public ---------------------------------------
{
  const r = build([{ month: MOIS, visits: [visite('v', 'ars', [
    ['comparaison', 'lancer|x', '<img src=x onerror=alert(1)>'],
    ['<script>', 'lancer', 'liste'],
    ['filtre', 'appliquer', '<b>zone</b>'],
  ])] }]);
  const l = lignes(r);
  console.log(`      ${JSON.stringify(l)}`);
  verifier('action forgée : bornée à « autre », nom écarté', l.includes('ars|comparaison|autre|×1'));
  verifier('catégorie forgée : bornée à « autre »', l.includes('ars|autre|autre|×1'));
  verifier('nom hors liste : borné à « autre »', l.includes('ars|filtre|appliquer|autre×1'));
  verifier('aucun composant ne contient de « | » ni de « < »',
    r.events.every((e) => ![e.role, e.category, e.action, e.name].some((x) => /[|<]/.test(String(x)))));
  verifier(`canari : les trois emplacements sont nommés (${inconnus().trim()})`,
    ['action=comparaison/?', 'categorie=?', 'nom=filtre/appliquer/?'].every((k) => inconnus().includes(k)));
}
{
  // Le canari part dans Grist (Extractions.note) et dans les logs : une valeur hors
  // liste peut être une saisie de l'agent. Aucune valeur reçue ne doit y figurer.
  build([{ month: MOIS, visits: [visite('v', 'ars', [
    ['export', 'lancer', 'jean dupont ars idf'],
    ['recherche', 'clinique saint jean'],
    ['marie.martin@ars.sante.fr', 'x'],
    ['indicateur', 'utilisateurs_actifs', 'paul.durand', 3, 1],
  ])] }]);
  const note = inconnus();
  verifier(`canari : aucune valeur reçue n'y figure (${note.trim()})`,
    note && !/jean|dupont|clinique|marie|martin|paul|durand|@/.test(note));
}
{
  // Variantes historiques (espaces, libellé long) ramenées au plan de tag.
  const r = build([{ month: MOIS, visits: [visite('v', 'regional', [
    ['filtre', 'appliquer', 'zone geo'], ['comparaison', 'lancer', 'fiche etablissement'],
    ['navigation', 'console admin'], ['recherche', 'simple', 'terme saisi par l’agent'],
  ])] }]);
  const l = lignes(r);
  verifier('normalisation : « zone geo » → zone_geo', l.includes('regional|filtre|appliquer|zone_geo×1'));
  verifier('alias : « fiche etablissement » → fiche_et', l.includes('regional|comparaison|lancer|fiche_et×1'));
  verifier('normalisation : « console admin » → console_admin', l.includes('regional|navigation|console_admin|×1'));
  verifier('saisie éventuelle dans le nom d’une recherche : écartée, pas publiée', l.includes('regional|recherche|simple|×1'));
  verifier('aucune valeur hors liste', inconnus() === '');
}
{
  const evenements = Array.from({ length: 300 }, (_, i) => ['export', 'lancer', `src-${i}`]);
  const r = build([{ month: MOIS, visits: [visite('v', 'ars', evenements)] }]);
  verifier(`cardinalité : 300 noms forgés → ${r.events.length} ligne`, r.events.length === 1);
  verifier(`canari borné (${inconnus().length} caractères)`, inconnus().length < 1500);
  build([{ month: MOIS, visits: [visite('v', 'ars', [['x\n\r\u001b[2K✓ Push : ok', 'a'], ['contact', '\u0001'.repeat(4000)]])] }]);
  verifier('canari : ni saut de ligne ni séquence ANSI', !/[\r\n\u001b]/.test(inconnus()));
}
{
  // Le rôle de visite est lui aussi borné : il entre dans la clé et dans le filtre du widget.
  const r = build([{ month: MOIS, visits: [visite('v', 'admin|<x>', [connexion])] }]);
  verifier('rôle hors liste : vide, compté en global seulement',
    r.events[0].role === '' && kpi(r, 'global').utilisateurs_reguliers === 1);
}

// --- Le plan de tag de l'ETL couvre ce que lit le widget --------------------------
{
  const front = fs.readFileSync(path.join(ici, 'dashboard.html'), 'utf8');
  const lus = [...front.matchAll(/e\.category === '([a-z_]+)' && e\.action === '([a-z_]+)'/g)].map((m) => `${m[1]}/${m[2]}`);
  const absents = lus.filter((k) => { const [c, a] = k.split('/'); return !(PLAN[c] && a in PLAN[c]); });
  verifier(`widget : chaque couple catégorie/action lu existe dans le plan (${lus.length} lus${absents.length ? `, absents : ${absents}` : ''})`,
    lus.length > 0 && absents.length === 0);
  const libelles = new Set([...front.matchAll(/(\w+): '[^']*'/g)].map((m) => m[1]));
  const noms = [...new Set(Object.values(PLAN).flatMap((a) => Object.values(a).flat()).filter(Boolean))];
  const sansLibelle = noms.filter((n) => ['comparaison', 'export'].some((c) => PLAN[c].lancer.includes(n)) || PLAN.filtre.appliquer.includes(n))
    .filter((n) => !libelles.has(n));
  verifier(`widget : chaque source et critère du plan a un libellé${sansLibelle.length ? ` (manque : ${sansLibelle})` : ''}`, sansLibelle.length === 0);
}

// --- Aucune formule ne porte la signature que le WAF de Grist rejette -----------
// Constaté le 15/10/2026 : `… and … < …` sur une même ligne → HTTP 403 Incapsula,
// et le Job échoue chaque nuit. Le contrôle porte sur toutes les formules du schéma.
{
  const formules = [...EVENTS_COLS, ...BASE_COLS, ...KPI_COLS, ...EXTRACTIONS_COLS].filter((c) => c.formula);
  const fautives = formules.filter((c) => c.formula.split('\n').some((l) => /\band\b.*[<>]/.test(l))).map((c) => c.id);
  verifier(`WAF Grist : aucune formule « and … < » (${formules.length} formules lues${fautives.length ? `, fautives : ${fautives}` : ''})`,
    formules.length === 8 && fautives.length === 0);
}

// --- Le canari est branché sur Extractions.note et sur les logs du Job ------------
verifier('canari : inconnus() est injecté dans Extractions.note', /note:\s*`[^`]*\$\{inconnus\(\)\}/.test(source));
verifier('canari : inconnus() est aussi journalisé par le Job', /console\.warn\([^)]*inconnus\(\)/.test(source));

console.log(echecs ? `\n${echecs} échec(s)` : '\nTous les tests passent.');
process.exit(echecs ? 1 : 0);
