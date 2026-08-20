// Tests de non-régression du tableau de bord. Node pur, aucune dépendance :
// le <script> de dashboard.html est extrait et exécuté dans un vm, avec un DOM
// bouchonné dont on relit le innerHTML produit.
//
// Ce que ces tests verrouillent, et pourquoi : les deux modes d'échec de cette page
// sont un CHIFFRE FAUX affiché comme vrai (le pire sur un tableau de bord de pilotage)
// et une DONNÉE HOSTILE qui atteint innerHTML (l'endpoint de tracking Matomo est public).
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
const PASSERELLE = `
;this.__t = {
  set SESS(v){SESS=v}, set EVT(v){EVT=v}, set MOD(v){MOD=v}, set INDIC(v){INDIC=v}, set META(v){META=v},
  set seg(v){seg=v}, set fromD(v){fromD=v}, set toD(v){toD=v},
  get RATES(){return RATES}, get FILTRES(){return FILTRES}, get CANAUX(){return CANAUX}, get ERR(){return ERR},
  buildFixed, buildPeriod, renderAll, chart, dualChart, serieRate, serieErr, barList, setSeg,
  casser(){ MODES = null; }
};`;

function executer(scenario) {
  const els = {};
  const noeud = (id) =>
    els[id] ||
    (els[id] = {
      id, _h: '', className: '', style: {}, value: '', hidden: false,
      set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; },
      set textContent(v) { this._t = v; }, get textContent() { return this._t; },
      addEventListener() {}, querySelectorAll: () => [],
    });
  // console.error est capturé plutôt que réémis : une erreur attendue par un test ne
  // doit pas ressembler à un échec dans la sortie, et on peut vérifier qu'elle a bien
  // été journalisée — le dépôt s'interdit les échecs silencieux.
  const journal = [];
  const ctx = {
    document: { getElementById: noeud, querySelectorAll: () => [], addEventListener() {} },
    window: {}, setTimeout, clearTimeout,
    console: { ...console, error: (...a2) => journal.push(a2.map(String).join(' ')) },
  };
  ctx.window.self = ctx.window;
  ctx.window.top = {}; // hors Grist : loadData n'est pas appelé, on injecte les tables à la main
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(source + PASSERELLE, ctx, { filename: 'dashboard.html' });
  scenario(ctx.__t, els);
  return { api: ctx.__t, els, journal };
}

let echecs = 0;
const verifier = (titre, condition) => {
  console.log(`${condition ? '  ok  ' : 'ÉCHEC '}${titre}`);
  if (!condition) echecs += 1;
};

const session = (day, device, visites, contacts) => ({
  sess_id: `${day}|${device}`, day, device, visites,
  s_recherche: visites, s_resultats: visites, s_contact: contacts,
  s_tel: contacts, s_copie: 0, part_alv_pct: 0,
});
const indicateur = (day, device, champs = {}) => ({
  ind_id: `${day}|${device}`, day, device, visites: 0,
  lancement_pct: null, clictel_pct: null, copieadr_pct: null,
  contact_pct: null, abandon_pct: null, partalv_pct: null,
  recherches: 0, err404: 0, err500: 0, ...champs,
});

// --- Une fenêtre sans donnée ne doit produire aucun chiffre ---------------------
// Le phare « Mise en relation » a déjà été dérivé de `100 - abandon`, avec un abandon
// à 0 en l'absence de visite : la page annonçait alors 100 % de mise en relation.
{
  const { els } = executer((t) => {
    t.SESS = []; t.EVT = []; t.MOD = []; t.INDIC = []; t.META = null;
    t.buildFixed(); t.renderAll();
  });
  const phares = [...els.p0.innerHTML.matchAll(/<div class="v[^"]*">([^<]*)</g)].map((m) => m[1].trim());
  verifier('fenêtre vide : aucun phare ne montre 100 %', !phares.includes('100 %'));
  verifier('fenêtre vide : le phare « Mise en relation » vaut —', phares[2] === '—');
  verifier('fenêtre vide : pas de phrase miroir', !els.p0.innerHTML.includes('Miroir de la valeur'));
  verifier('fenêtre vide : aucun NaN ni ±∞ dans les 5 panneaux',
    !['p0', 'p1', 'p2', 'p3', 'p4'].some((k) => /NaN|∞/.test(els[k].innerHTML)));
  // Un funnel bâti sur un dénominateur de secours affiche « Arrivée 100 % » puis
  // « −100 pts ⚠ principal décrochage » — un décrochage catastrophique inventé.
  verifier('fenêtre vide : aucun funnel dessiné en synthèse',
    !els.p0.innerHTML.includes('class="funnel"') && !els.p0.innerHTML.includes('principal décrochage'));
  verifier('fenêtre vide : aucun sous-funnel par mode dans l’onglet Utile',
    !els.p3.innerHTML.includes('principal décrochage'));
  // Les compteurs aussi : « 0 page d'erreur » sur une collecte muette se lit « produit sain ».
  verifier('fenêtre vide : le phare des erreurs vaut —', phares[0] === '—');
  verifier('fenêtre vide : les compteurs 404/500 valent —',
    (els.p1.innerHTML.match(/kpi-mid">—</g) || []).length === 2);
  verifier('fenêtre vide : le volume de recherches vaut —', els.p2.innerHTML.includes('kpi-mid">—<'));
  verifier('fenêtre vide : la part ALV vaut —', els.p2.innerHTML.includes('kpi-mid">—<'));
  verifier('fenêtre vide : les 3 modes d’entrée valent — et non 0 %',
    (els.p1.innerHTML.match(/class="bar" style="width:0%">—</g) || []).length === 3);
  verifier('fenêtre vide : la base du pilier vaut —', els.p1.innerHTML.includes('Base : — sessions'));
}

// --- Un jour creux est un trou dans la série, pas un zéro -----------------------
{
  const jours = ['2026-08-14', '2026-08-15', '2026-08-16', '2026-08-17'];
  executer((t) => {
    t.SESS = jours.map((j) => session(j, 'mobile', 100, 12));
    t.EVT = []; t.MOD = []; t.META = null;
    // Le 16 est dans la fenêtre (desktop a des visites) mais n'a aucune ligne mobile.
    t.INDIC = jours.filter((j) => j !== '2026-08-16')
      .map((j) => indicateur(j, 'mobile', { visites: 100, contact_pct: 12, abandon_pct: 88 }))
      .concat([indicateur('2026-08-16', 'desktop', { visites: 5, contact_pct: 40, abandon_pct: 60 })]);
    t.seg = 'mobile'; t.buildFixed(); t.buildPeriod();

    const serie = t.serieRate('contact');
    verifier('jour creux : la série porte null, pas 100', serie[2] === null);
    verifier('jour creux : les jours pleins gardent leur valeur',
      serie[0] === 12 && serie[1] === 12 && serie[3] === 12);
    const svg = t.chart(serie, 'line');
    const lignes = [...svg.matchAll(/<polyline points="([^"]*)"/g)].map((m) => m[1].trim().split(' '));
    verifier('jour creux : aucune ligne n’enjambe le trou', lignes.every((g) => g.length <= 2));
    verifier('jour creux : les 3 points réels restent tracés', (svg.match(/<circle/g) || []).length === 3);
  });
}

// --- Une ligne présente dont le champ vaut None reste une absence ---------------
// `Number(null)` vaut 0 : l'absence doit être testée AVANT la conversion.
{
  executer((t) => {
    t.SESS = [session('2026-08-19', 'tous', 10, 2)];
    t.EVT = []; t.MOD = []; t.META = null;
    t.INDIC = [indicateur('2026-08-19', 'tous', { visites: 0, contact_pct: null })];
    t.seg = 'tous'; t.buildFixed(); t.buildPeriod();
    const serie = t.serieRate('contact');
    verifier('champ None : la série porte null, pas 0', serie[0] === null);
    verifier('champ None : le graphe affiche un message, pas un point à 0',
      t.chart(serie, 'line').includes('Pas de donnée'));
  });
}

// --- Les libellés venus de Matomo n'atteignent jamais innerHTML tels quels ------
{
  const jour = '2026-08-19';
  const charge = '<img src=x onerror=alert(1)>';
  const { api, els } = executer((t) => {
    t.SESS = [session(jour, 'tous', 100, 12)];
    t.EVT = [
      { day: jour, device: 'tous', category: 'recherche', action: 'filtrer', name: charge, count: 5 },
      { day: jour, device: 'tous', category: 'recherche', action: 'filtrer', name: 'toString', count: 3 },
      { day: jour, device: 'tous', category: 'recherche', action: 'filtrer', name: 'violences-conjugales', count: 2 },
    ];
    t.MOD = [];
    t.INDIC = [indicateur(jour, 'tous', { visites: 100, contact_pct: 12, abandon_pct: 88 })];
    t.META = { source: charge, days: 'x', jours: 3, extracted_at: '2026-08-19' };
    t.buildFixed(); t.renderAll();
  });
  const filtres = els.p2.innerHTML;
  verifier('libellé hostile : échappé dans la liste des filtres',
    filtres.includes('&lt;img') && !filtres.includes(charge));
  verifier('libellé hostile : la bannière est échappée aussi', els.volbar.innerHTML.includes('&lt;img'));
  verifier('clé héritée d’Object.prototype (« toString ») : pas de NaN', !filtres.includes('NaN'));
  verifier('clé héritée : le compte reste un nombre',
    api.FILTRES.tous.every((f) => Number.isFinite(f.p)));
}

// --- Contact et abandon sont deux faces du même chiffre -------------------------
// Deux arrondis indépendants donnaient « 14,3 % » et « 86 % », soit 100,3.
{
  const jour = '2026-08-19';
  const { api, els } = executer((t) => {
    // 16 visites / 1 contact : 6,25 % — deux arrondis indépendants donneraient
    // 6,3 + 93,8 = 100,1. Une fixture à 7/1 ne déclencherait pas le demi-arrondi.
    t.SESS = [session(jour, 'tous', 16, 1), session(jour, 'mobile', 11, 1), session(jour, 'desktop', 5, 0)];
    t.EVT = ['tous', 'mobile', 'desktop'].map((d, i) =>
      ({ day: jour, device: d, category: 'erreur', action: '404', name: '', count: [24, 21, 2][i] }));
    t.MOD = [];
    t.INDIC = ['tous', 'mobile', 'desktop'].map((d) => indicateur(jour, d, { visites: 16 }));
    t.META = null; t.seg = 'desktop'; t.buildFixed(); t.renderAll();
  });
  const { v: contact } = api.RATES.contact.tous;
  const { v: abandon } = api.RATES.abandon.tous;
  verifier('contact + abandon = 100 exactement', contact + abandon === 100);
  const phares = [...els.p0.innerHTML.matchAll(/<div class="v[^"]*">([^<]*)</g)].map((m) => m[1].trim());
  verifier('synthèse : les 4 phares restent sur « tous devices »', phares[0] === '24');
  // Le miroir doit passer par le même formateur que le phare : l'ancienne assertion
  // acceptait « 93.8% » (point, pas d'espace) et figeait donc l'incohérence.
  const miroir = (els.p0.innerHTML.match(/Miroir de la valeur :<\/b> ([^<]*?) des sessions/) || [])[1];
  verifier(`synthèse : la phrase miroir est formatée comme le phare (${miroir})`,
    miroir === `${abandon.toLocaleString('fr-FR')} %`);
}

// --- Un libellé hérité d'Object.prototype ne doit pas devenir un libellé de filtre
{
  const jour = '2026-08-19';
  const { api } = executer((t) => {
    t.SESS = [session(jour, 'tous', 100, 12)];
    t.EVT = [{ day: jour, device: 'tous', category: 'recherche', action: 'filtrer', name: 'toString', count: 3 }];
    t.MOD = []; t.META = null;
    t.INDIC = [indicateur(jour, 'tous', { visites: 100, contact_pct: 12 })];
    t.buildFixed(); t.buildPeriod();
  });
  verifier('clé héritée : le libellé rendu reste la clé brute, pas la fonction native',
    api.FILTRES.tous[0].n === 'toString');
}

// --- Les autres indicateurs distinguent aussi l'absence du zéro ------------------
{
  const jour = '2026-08-19';
  const { api } = executer((t) => {
    t.SESS = [session(jour, 'mobile', 10, 2)];
    t.EVT = []; t.MOD = []; t.META = null;
    t.INDIC = [indicateur(jour, 'mobile', { visites: 10, contact_pct: 20 })];
    t.seg = 'desktop'; t.buildFixed(); t.buildPeriod();
  });
  // desktop n'a aucune ligne : tout doit être absent, pas nul.
  verifier('device sans donnée : part ALV absente', api.RATES.partAlv.desktop.v === null);
  verifier('device sans donnée : taux de contact absent', api.RATES.contact.desktop.v === null);
  verifier('device sans donnée : abandon absent', api.RATES.abandon.desktop.v === null);
}

// --- Pas de delta fabriqué face à une période précédente sans visite -------------
{
  const { api } = executer((t) => {
    // 14/08 : aucune visite mobile (seul desktop est présent). 15/08 : 30 % de contact.
    t.SESS = [session('2026-08-14', 'desktop', 5, 1), session('2026-08-15', 'mobile', 10, 3)];
    t.EVT = []; t.MOD = []; t.META = null;
    t.INDIC = [indicateur('2026-08-14', 'desktop', { visites: 5 }), indicateur('2026-08-15', 'mobile', { visites: 10 })];
    t.seg = 'mobile'; t.fromD = '2026-08-15'; t.toD = '2026-08-15';
    t.buildFixed();
  });
  verifier('période précédente vide : aucun delta inventé', api.RATES.contact.mobile.d === null);
}

// --- Les effectifs affichés sont les vrais, pas des pourcentages remultipliés ----
{
  const jour = '2026-08-19';
  const { els } = executer((t) => {
    // 1234 visites, 1000 résultats, 177 contacts : 177/1234 = 14,34 % -> « 14 % » arrondi.
    t.SESS = [{ sess_id: `${jour}|tous`, day: jour, device: 'tous', visites: 1234,
      s_recherche: 1100, s_resultats: 1000, s_contact: 177, s_tel: 100, s_copie: 20, part_alv_pct: 0 }];
    t.EVT = []; t.MOD = []; t.META = null;
    t.INDIC = [indicateur(jour, 'tous', { visites: 1234, contact_pct: 14.3 })];
    t.seg = 'tous'; t.buildFixed(); t.renderAll();
  });
  const funnel = els.p0.innerHTML;
  verifier('funnel : l’effectif de contact est le compte réel (177), pas 14 % de la base',
    funnel.includes('177') && !funnel.includes('· 173'));
  const largeurs = [...funnel.matchAll(/width:(-?\d+)%/g)].map((m) => Number(m[1]));
  // Entrée dégénérée : plus de contacts que de visites. La barre doit rester bornée.
  const dege = executer((t) => {
    t.SESS = [{ sess_id: `${jour}|tous`, day: jour, device: 'tous', visites: 10,
      s_recherche: 10, s_resultats: 25, s_contact: 25, s_tel: 0, s_copie: 0, part_alv_pct: 0 }];
    t.EVT = []; t.MOD = []; t.META = null;
    t.INDIC = [indicateur(jour, 'tous', { visites: 10, contact_pct: 100 })];
    t.seg = 'tous'; t.buildFixed(); t.renderAll();
  }).els.p0.innerHTML;
  const degeL = [...dege.matchAll(/width:(-?\d+)%/g)].map((m) => Number(m[1]));
  verifier(`funnel dégénéré : barres bornées à 100 % (${degeL.join(',')})`,
    degeL.length > 0 && degeL.every((w) => w >= 0 && w <= 100));
  verifier(`funnel : aucune barre hors de [0,100] (${largeurs.join(',')})`,
    largeurs.length > 0 && largeurs.every((w) => w >= 0 && w <= 100));
}

// --- Changer la plage de dates doit recalculer les phares, pas les laisser périmés
// `renderAll` appelle `buildFixed()` : sans lui, la page affiche les chiffres de la
// plage précédente en ayant l'air d'avoir répondu.
{
  const { api, els } = executer((t) => {
    // 01/08 : 10 visites / 1 contact (10 %). 02/08 : 10 visites / 9 contacts (90 %).
    t.SESS = [session('2026-08-01', 'tous', 10, 1), session('2026-08-02', 'tous', 10, 9)];
    t.EVT = []; t.MOD = []; t.META = null;
    t.INDIC = [indicateur('2026-08-01', 'tous', { visites: 10, contact_pct: 10 }),
      indicateur('2026-08-02', 'tous', { visites: 10, contact_pct: 90 })];
    t.seg = 'tous'; t.buildFixed(); t.renderAll();
  });
  const phare = () => [...els.p0.innerHTML.matchAll(/<div class="v[^"]*">([^<]*)</g)].map((m) => m[1].trim())[2];
  verifier(`plage complète : le phare vaut 50 % (${phare()})`, phare() === '50 %');
  api.fromD = '2026-08-02';
  api.renderAll();
  verifier(`plage restreinte au 02/08 : le phare passe à 90 % (${phare()})`, phare() === '90 %');
}

// --- Le delta d'erreurs compare le même périmètre des deux côtés ------------------
{
  const jours = ['2026-08-01', '2026-08-02'];
  const { api } = executer((t) => {
    t.SESS = jours.map((j) => session(j, 'tous', 10, 2));
    // Périodes strictement identiques : 10 erreurs 404 et 5 hors 404/500 de chaque côté.
    t.EVT = jours.flatMap((j) => [
      { day: j, device: 'tous', category: 'erreur', action: '404', name: '', count: 10 },
      { day: j, device: 'tous', category: 'erreur', action: 'autre', name: '', count: 5 },
    ]);
    t.MOD = []; t.META = null;
    t.INDIC = jours.map((j) => indicateur(j, 'tous', { visites: 10 }));
    t.seg = 'tous'; t.fromD = '2026-08-02'; t.toD = '2026-08-02'; t.buildFixed();
  });
  verifier('deux périodes d’erreurs identiques : delta nul', api.ERR.tous.d === 0);
}

// --- Un graphe de comptage part de zéro -------------------------------------------
{
  executer((t) => {
    const svg = t.chart([2, 4], 'bars');
    const bas = [...svg.matchAll(/<text[^>]*>(-?[\d\s,]+)<\/text>/g)].map((m) => m[1].trim());
    verifier(`barres : aucune graduation négative (${bas.join(' / ')})`,
      !bas.some((v) => v.startsWith('-')));
    verifier('barres : tout à zéro affiche un message, pas des barres',
      t.chart([0, 0, 0], 'bars').includes('Aucune occurrence'));
  });
}

// --- La répartition des canaux totalise 100 % -------------------------------------
{
  const jour = '2026-08-19';
  const { api } = executer((t) => {
    t.SESS = [session(jour, 'tous', 100, 40)];
    t.EVT = [
      { day: jour, device: 'tous', category: 'contact', action: 'clic_telephone', name: '', count: 30 },
      { day: jour, device: 'tous', category: 'contact', action: 'autre', name: '', count: 70 },
    ];
    t.MOD = []; t.META = null;
    t.INDIC = [indicateur(jour, 'tous', { visites: 100, contact_pct: 40 })];
    t.seg = 'tous'; t.buildFixed(); t.buildPeriod();
  });
  const somme = api.CANAUX.tous.reduce((a, c) => a + c.p, 0);
  verifier(`canaux : la répartition totalise 100 % (${JSON.stringify(api.CANAUX.tous)})`, somme === 100);
  verifier('canaux : le reliquat est nommé', api.CANAUX.tous.some((c) => c.n === 'Autre canal'));
}

// --- Séries dégénérées : premier jour de collecte, ou rien du tout --------------
{
  executer((t) => {
    verifier('un seul point : dualChart sans NaN', !/NaN/.test(t.dualChart([12], [3])));
    verifier('un seul point : chart sans NaN', !/NaN/.test(t.chart([12], 'line')));
    verifier('série vide : message explicite', t.chart([], 'line').includes('Pas de donnée'));
    verifier('série tout-null : message explicite', t.chart([null, null], 'line').includes('Pas de donnée'));
    verifier('liste vide : message explicite', t.barList([]).includes('Aucune donnée'));
  });
}

// --- Une liste de libellés non bornée ne doit ni déborder la pile ni tout afficher
// Le nombre de libellés distincts vient du tracker public : il n'a pas de plafond.
{
  const jour = '2026-08-19';
  const { els } = executer((t) => {
    t.SESS = [session(jour, 'tous', 100, 12)];
    t.EVT = Array.from({ length: 200000 }, (_, i) =>
      ({ day: jour, device: 'tous', category: 'recherche', action: 'filtrer', name: `f-${i}`, count: 1 }));
    t.MOD = [];
    t.INDIC = [indicateur(jour, 'tous', { visites: 100, contact_pct: 12 })];
    t.META = null; t.buildFixed(); t.renderAll();
  });
  const lignes = (els.p2.innerHTML.match(/class="bl-row"/g) || []).length;
  verifier(`200 000 libellés : la page est rendue sans exception (${lignes} lignes)`,
    !els.p2.innerHTML.includes('border-left-color:var(--ko)'));
  verifier('200 000 libellés : la liste est plafonnée', lignes > 0 && lignes <= 30);
  verifier('200 000 libellés : le reste tronqué est annoncé',
    els.p2.innerHTML.includes('autres libell'));
}

// --- La série d'erreurs distingue elle aussi le trou du zéro ---------------------
{
  const jours = ['2026-08-14', '2026-08-15'];
  executer((t) => {
    t.SESS = jours.map((j) => session(j, 'mobile', 10, 2));
    t.EVT = []; t.MOD = []; t.META = null;
    t.INDIC = [indicateur('2026-08-14', 'mobile', { visites: 10, err404: 3 }),
      indicateur('2026-08-15', 'desktop', { visites: 4 })];
    t.seg = 'mobile'; t.buildFixed(); t.buildPeriod();
    const serie = t.serieErr();
    verifier(`série d'erreurs : jour mesuré = 3 (${JSON.stringify(serie)})`, serie[0] === 3);
    verifier('série d’erreurs : jour sans ligne = null, pas 0', serie[1] === null);
  });
}

// --- Une exception de rendu s'affiche, elle ne laisse pas des panneaux périmés ---
{
  const jour = '2026-08-19';
  const { els, api, journal } = executer((t) => {
    t.SESS = [session(jour, 'tous', 10, 2), session(jour, 'mobile', 6, 2)];
    t.EVT = []; t.MOD = []; t.META = null;
    t.INDIC = ['tous', 'mobile'].map((d) => indicateur(jour, d, { visites: 10, contact_pct: 20 }));
    t.seg = 'tous'; t.buildFixed(); t.renderAll();
  });
  verifier('rendu nominal : le panneau est écrit',
    els.p2.innerHTML.length > 0 && !els.p2.innerHTML.includes('border-left-color:var(--ko)'));
  // MODES à null fait lever renderUtilisable, comme le ferait une donnée inattendue.
  api.casser();
  let propagee = null;
  try { api.setSeg('mobile'); } catch (e) { propagee = e; }
  verifier('exception au changement de segment : rien ne remonte à l’appelant', propagee === null);
  verifier('exception au changement de segment : l’échec est affiché',
    els.p1.innerHTML.includes('border-left-color:var(--ko)'));
  verifier('exception au changement de segment : aucun panneau ne garde de chiffres périmés',
    ['p1', 'p2', 'p3'].every((k) => els[k].innerHTML.includes('border-left-color:var(--ko)')));
  verifier('exception au changement de segment : elle est aussi journalisée',
    journal.some((l) => l.includes('TypeError')));
}

console.log(echecs ? `\n${echecs} échec(s)` : '\nTous les tests passent.');
process.exit(echecs ? 1 : 0);
