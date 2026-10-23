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
  // Compte de test passé de référent régional à ARS en cours de mois : la base du 1er
  // le compte en ARS seulement, le RC1 aussi. Visites servies les plus récentes en premier.
  const T_03 = Date.UTC(2026, 9, 3, 8) / 1000;
  const T_20 = Date.UTC(2026, 9, 20, 8) / 1000;
  const vid = 'dddd000000000001';
  const r = build([{ month: MOIS, visits: [
    visite(vid, 'ars', [[...connexion, '', null, T_20]]),
    visite(vid, null, [[...connexion, '', null, T_20 + 60]]),     // connexion sans rôle : ne change pas le rôle
    visite(vid, 'regional', [[...connexion, '', null, T_03]]),
  ] }]);
  verifier(`changement de rôle : 1 régulier ARS (obtenu ${kpi(r, 'ars').utilisateurs_reguliers})`, kpi(r, 'ars').utilisateurs_reguliers === 1);
  verifier(`changement de rôle : 0 référent régional (obtenu ${kpi(r, 'regional').utilisateurs_reguliers})`, kpi(r, 'regional').utilisateurs_reguliers === 0);
  verifier(`changement de rôle : 1 régulier en global (obtenu ${kpi(r, 'global').utilisateurs_reguliers})`, kpi(r, 'global').utilisateurs_reguliers === 1);
  // Ordre inverse de l'API : le résultat ne dépend que de l'horodatage.
  const inverse = build([{ month: MOIS, visits: [visite(vid, 'regional', [[...connexion, '', null, T_03]]), visite(vid, 'ars', [[...connexion, '', null, T_20]])] }]);
  verifier('changement de rôle : indépendant de l’ordre des visites',
    kpi(inverse, 'ars').utilisateurs_reguliers === 1 && kpi(inverse, 'regional').utilisateurs_reguliers === 0);
  // Chaque mois a sa propre dernière connexion.
  const deuxMois = build([{ month: MOIS, visits: [visite(vid, 'regional', [[...connexion, '', null, T_03]])] },
    { month: '2026-11', visits: [visite(vid, 'ars', [[...connexion, '', null, T_20 + 31 * 86400]])] }]);
  verifier('changement de rôle : le rôle d’un mois ne déborde pas sur le suivant',
    kpi(deuxMois, 'regional').utilisateurs_reguliers === 1 && kpi(deuxMois, 'ars', '2026-11').utilisateurs_reguliers === 1
    && kpi(deuxMois, 'ars').utilisateurs_reguliers === 0);
  // À horodatage égal, la première visite servie (la plus récente) gagne.
  const egal = build([{ month: MOIS, visits: [visite(vid, 'ars', [[...connexion, '', null, T_20]]), visite(vid, 'regional', [[...connexion, '', null, T_20]])] }]);
  verifier('changement de rôle : à égalité, la première visite servie gagne',
    kpi(egal, 'ars').utilisateurs_reguliers === 1 && kpi(egal, 'regional').utilisateurs_reguliers === 0);
  // Action sans horodatage : celui de la visite prend le relais.
  const recente = { ...visite(vid, 'ars', [connexion]), lastActionTimestamp: T_20 };
  const sansTs = build([{ month: MOIS, visits: [visite(vid, 'regional', [[...connexion, '', null, T_03]]), recente] }]);
  verifier('changement de rôle : sans horodatage d’action, celui de la visite est lu',
    kpi(sansTs, 'ars').utilisateurs_reguliers === 1 && kpi(sansTs, 'regional').utilisateurs_reguliers === 0);
  const sortie = JSON.stringify({ events: r.events, base: r.base, kpi: r.kpi });
  verifier('changement de rôle : aucun visitorId dans les lignes publiées', !sortie.includes(vid));
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

// --- Base d'agents : cron du 1er, rangé sur le mois qu'il mesure -----------------
// Horodatages réels (secondes) : 01/10 9h et 9h05, 19/10 16h35, 01/11 9h (heure de Paris).
const T_01OCT = Date.UTC(2026, 9, 1, 7, 0) / 1000;
const T_01OCT_BIS = Date.UTC(2026, 9, 1, 7, 5) / 1000;
const T_19OCT = Date.UTC(2026, 9, 19, 14, 35) / 1000;
const T_01NOV = Date.UTC(2026, 10, 1, 8, 0) / 1000;
const cron = (ts, [ca, ia], [cr, ir], [aa, ai]) => [
  ['indicateur', 'utilisateurs_actifs', 'central', ca, ts], ['indicateur', 'utilisateurs_inactifs', 'central', ia, ts],
  ['indicateur', 'utilisateurs_actifs', 'regional', cr, ts], ['indicateur', 'utilisateurs_inactifs', 'regional', ir, ts],
  ['indicateur', 'utilisateurs_actifs', 'ars', aa, ts], ['indicateur', 'utilisateurs_inactifs', 'ars', ai, ts],
];
{
  const r = build([{ month: MOIS, visits: [
    // L'API Live sert les visites les plus récentes en premier : l'ordre ne doit pas compter.
    visite('test', null, cron(T_19OCT, [3, 9], [4, 2], [7, 23])),            // test de Sana en cours de mois
    visite('cron2', null, [['indicateur', 'utilisateurs_actifs', 'ars', 5, T_01OCT_BIS]]),
    visite('cron1', null, cron(T_01OCT, [6, 6], [4, 3], [99, 23])),           // relance du même matin
  ] }]);
  const ars = r.base.find((b) => b.role === 'ars');
  verifier(`base : le cron du 01/10 est rangé en septembre (mois ${r.base.map((b) => b.month).join(',')})`,
    r.base.length === 3 && r.base.every((b) => b.month === '2026-09'));
  verifier(`base : le passage le plus récent du 1er gagne (ars actifs ${ars?.actifs})`, ars?.actifs === 5 && ars?.inactifs === 23);
  const total = r.base.reduce((s, b) => s + b.actifs + b.inactifs, 0);
  verifier(`base : 47 agents au total, le test du 19/10 est écarté (obtenu ${total})`, total === 47);
  verifier('base : le test hors 1er est signalé dans le canari', inconnus().includes('base=hors_1er'));
  verifier('base : aucune ligne rangée en octobre', !r.base.some((b) => b.month === MOIS));
  verifier('base : les events indicateur ne gonflent pas Events', !r.events.some((e) => e.category === 'indicateur'));
}
{
  // 30/09 à 23h30 UTC = 01/10 à 1h30 à Paris : c'est bien le cron du 1er.
  const r = build([{ month: '2026-09', visits: [visite('nuit', null, cron(Date.UTC(2026, 8, 30, 23, 30) / 1000, [1, 1], [1, 1], [1, 1]))] }]);
  verifier(`base : le jour est lu à l'heure de Paris (mois ${r.base[0]?.month})`, r.base.length === 3 && r.base[0].month === '2026-09');
}
{
  // Un run qui relit octobre et novembre ne purge que la base d'octobre : celle de
  // septembre a pu arriver dans les visites de septembre (cron du 01/10 à 00h30 à
  // Paris, site en UTC), qui ne sont pas relues.
  const r = build([{ month: MOIS, visits: [visite('x', 'ars', [connexion])] }, { month: '2026-11', visits: [visite('y', 'ars', [connexion])] }]);
  verifier(`base : seul le mois dont M et M+1 sont relus est purgé (${[...r.moisBaseRelus].sort().join(',')})`,
    [...r.moisBaseRelus].sort().join(',') === '2026-10');
  const seul = build([{ month: '2026-11', visits: [visite('y', 'ars', [connexion])] }]);
  verifier(`base : un seul mois relu ne purge aucune base (${[...seul.moisBaseRelus].join(',')})`, seul.moisBaseRelus.size === 0);
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
  const r = build([{ month: MOIS, visits: [visite('c1', null, [['indicateur', 'utilisateurs_actifs', 'ars', 40, T_01OCT]])] }]);
  verifier('base incomplète : non publiée', r.base.length === 0);
  verifier('base incomplète : signalée', inconnus().includes('base=incomplete/ars'));
}

// --- RC1 de bout en bout : 5 réguliers d'octobre / 47 agents mesurés par le cron du 01/11 ----
{
  const usages = [
    ...['a1', 'a2', 'a3', 'a4'].map((v) => visite(v, 'ars', [connexion])),
    visite('a1', 'ars', [connexion]),
    visite('r1', 'regional', [connexion]),
  ];
  const r = build([{ month: MOIS, visits: usages }, { month: '2026-11', visits: [visite('base', null, cron(T_01NOV, [6, 6], [4, 3], [5, 23]))] }]);
  const base = r.base.filter((b) => b.month === MOIS).reduce((s, b) => s + b.actifs + b.inactifs, 0);
  const reg = kpi(r, 'global').utilisateurs_reguliers;
  verifier(`RC1 octobre : ${reg} / ${base} = ${(100 * reg / base).toFixed(1)} % (numérateur et base sur le même mois)`, reg === 5 && base === 47);
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

// --- Aucune formule ne porte la signature que le WAF de Grist rejette -----------
// Constaté le 15/10/2026 : `… and … < …` sur une même ligne → HTTP 403 Incapsula,
// et le Job échoue chaque nuit. Le contrôle porte sur toutes les formules du schéma.
{
  const formules = [...EVENTS_COLS, ...BASE_COLS, ...KPI_COLS, ...EXTRACTIONS_COLS].filter((c) => c.formula);
  // Le WAF lit le corps JSON d'un bloc, sauts de ligne échappés : le motif est cherché
  // sur la formule telle qu'elle part, pas ligne par ligne.
  const fautives = formules.filter((c) => /\band\b.*[<>]/.test(JSON.stringify(c.formula))).map((c) => c.id);
  verifier(`WAF Grist : aucune formule « and … < » (${formules.length} formules lues${fautives.length ? `, fautives : ${fautives}` : ''})`,
    formules.length === 8 && fautives.length === 0);
}

// --- Le canari est branché sur Extractions.note et sur les logs du Job ------------
verifier('canari : inconnus() est injecté dans Extractions.note', /note:\s*`[^`]*\$\{inconnus\(\)\}/.test(source));
verifier('canari : inconnus() est aussi journalisé par le Job', /console\.warn\([^)]*inconnus\(\)/.test(source));

console.log(echecs ? `\n${echecs} échec(s)` : '\nTous les tests passent.');
process.exit(echecs ? 1 : 0);
