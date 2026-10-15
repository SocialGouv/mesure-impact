// Collecte HELIOS : Matomo → doc Grist « Préprod - Hélios ».
// Extrait le RÉEL depuis Matomo et peuple Events / Base / KPI / Extractions.
// - Grain mois × rôle (ars / regional / central), scope `global` en plus dans KPI.
// - AGRÉGÉ : aucun identifiant de visiteur ne quitte ce script. Les visiteurs
//   distincts (numérateur du RC1) sont comptés ici, en mémoire, et seul leur NOMBRE
//   part dans Grist (KPI.utilisateurs_reguliers).
// - Les mois de la fenêtre sont recalculés en entier à chaque run : un visiteur
//   distinct ne se somme pas d'un jour sur l'autre, seul le mois complet fait foi.
//   Par défaut la fenêtre est le mois précédent + le mois en cours : un mois clos
//   n'est plus réécrit chaque nuit (une purge des logs bruts Matomo le ferait baisser
//   en silence). L'historique se reconstruit par un `--from` explicite.
// - Idempotent : PUT AddOrUpdate sur clé naturelle, puis retrait des lignes des mois
//   recalculés que ce run n'a pas produites. `--reset` vide les 4 tables avant.
//
// Config : injectée par Kubernetes (envFrom du Secret déscellé) en prod, ou via un
// fichier `.env` local (gitignoré) en développement. Contrat de variables commun au
// socle (cf. chart/ et Taskfile.yml) :
//   MATOMO_URL, MATOMO_TOKEN_AUTH, MATOMO_SITE_ID, GRIST_URL, GRIST_API_KEY, GRIST_DOC_ID
// Optionnelles : ALLOW_EMPTY_COLLECT (liste de slugs, séparés par des virgules, dont
//   une collecte vide est tolérée alors qu'ils n'ont encore jamais rien collecté),
//   COLLECT_FROM (mois de début), GRIST_DOC_NAME (vérif de sécurité), RUN_ID.
//
// Usage local : node produits/sante/helios/etl.mjs [--reset] [--from YYYY-MM] [--to YYYY-MM]
//   `--reset` vide les tables entières : il n'est accepté que si la fenêtre relit
//   tous les mois déjà présents dans le doc (typiquement `--reset --from 2026-05`).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// --- Résolution de la config : process.env d'abord, .env local en secours (dev) ---
const HERE = dirname(fileURLToPath(import.meta.url));
const cfg = { ...process.env };
const envFile = join(HERE, '.env');
if (existsSync(envFile)) {
  for (const l of readFileSync(envFile, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && cfg[m[1]] === undefined) cfg[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const MURL = cfg.MATOMO_URL;
const SITE = cfg.MATOMO_SITE_ID;
const MTOKEN = cfg.MATOMO_TOKEN_AUTH;
const GBASE = cfg.GRIST_URL;
const GKEY = cfg.GRIST_API_KEY;
const GDOC = cfg.GRIST_DOC_ID;
const EXPECT_DOC_NAME = cfg.GRIST_DOC_NAME || '';   // vérif de sécurité optionnelle
const RUN_ID = cfg.RUN_ID || 'helios';
const RESET = process.argv.includes('--reset');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
// Le grain est le mois : une date complète est tronquée, la fenêtre couvre toujours
// des mois entiers (un mois partiel donnerait un faux nombre de visiteurs distincts).
const MOIS_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const versMois = (v, quoi) => {
  const m = String(v || '').slice(0, 7);
  if (!MOIS_RE.test(m)) throw new Error(`${quoi} invalide : « ${v} » (attendu YYYY-MM)`);
  return m;
};
const TO = versMois(arg('--to', new Date().toISOString()), 'mois de fin');
const moisPrecedent = (m) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
// COLLECT_FROM est un plancher (date ou mois), jamais un point de départ nocturne.
const PLANCHER = versMois(cfg.COLLECT_FROM || '2026-05', 'COLLECT_FROM');
const FROM_EXPLICITE = process.argv.includes('--from') ? versMois(arg('--from'), 'mois de début') : null;
if (FROM_EXPLICITE && FROM_EXPLICITE > TO) throw new Error(`Fenêtre vide : ${FROM_EXPLICITE} est après ${TO}.`);
const plusTard = (...m) => m.filter(Boolean).sort().at(-1);
const plusTot = (...m) => m.filter(Boolean).sort()[0];
const moisEntre = (de, a) => {
  const out = [];
  for (let d = new Date(`${de}-01T00:00:00Z`); d.toISOString().slice(0, 7) <= a; d.setUTCMonth(d.getUTCMonth() + 1)) out.push(d.toISOString().slice(0, 7));
  return out;
};

// Aucun des deux tokens ne doit atterrir dans un log : les messages d'erreur
// recopient des réponses amont (WAF, proxy, rate-limiter) dont on ne maîtrise pas
// le contenu, et qui réverbèrent parfois la requête ou ses en-têtes.
const redact = (v) => [MTOKEN, GKEY].filter(Boolean)
  .reduce((acc, t) => acc.split(t).join('***'), String(v));

const MISSING = ['MATOMO_URL', 'MATOMO_TOKEN_AUTH', 'MATOMO_SITE_ID', 'GRIST_URL', 'GRIST_API_KEY', 'GRIST_DOC_ID'].filter((k) => !cfg[k]);
if (MISSING.length) throw new Error('Variables d\'environnement manquantes : ' + MISSING.join(', '));

// --- REST Grist ---
async function greq(method, path, body) {
  const r = await fetch(`${GBASE}/api/docs/${GDOC}${path}`, {
    method, headers: { Authorization: `Bearer ${GKEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text(); let j; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  if (!r.ok) throw new Error(redact(`${method} ${path} → HTTP ${r.status} : ${typeof j === 'string' ? j : JSON.stringify(j)}`));
  return j;
}
const getTables = () => greq('GET', '/tables').then((d) => d.tables.map((t) => t.id));
const getColumns = (t) => greq('GET', `/tables/${t}/columns`).then((d) => d.columns);
const getRecords = (t) => greq('GET', `/tables/${t}/records`).then((d) => d.records);
const colDef = (c) => ({ id: c.id, fields: c.formula
  ? { label: c.id, type: c.type || 'Any', isFormula: true, formula: c.formula }
  : { label: c.id, type: c.type || 'Text' } });
async function ensureTable(id, cols, retirees = []) {
  const tables = await getTables();
  if (!tables.includes(id)) { await greq('POST', '/tables', { tables: [{ id, columns: cols.map(colDef) }] }); console.log(`  ✓ ${id} créée (${cols.length} col.)`); return; }
  const existantes = await getColumns(id);
  const parId = new Map(existantes.map((c) => [c.id, c]));
  const missing = cols.filter((c) => !parId.has(c.id));
  if (missing.length) await greq('POST', `/tables/${id}/columns`, { columns: missing.map(colDef) });
  for (const c of cols.filter((x) => x.formula)) await greq('PATCH', `/tables/${id}/columns`, { columns: [{ id: c.id, fields: { isFormula: true, formula: c.formula, type: c.type } }] });
  // Une colonne de DONNÉES restée formule (schéma hérité) refuserait l'écriture :
  // c'est le cas de KPI.utilisateurs_reguliers, calculé autrefois dans Grist à partir
  // des identifiants de visiteurs, et désormais compté par l'ETL.
  const aConvertir = cols.filter((c) => !c.formula && parId.get(c.id)?.fields?.isFormula);
  for (const c of aConvertir) await greq('PATCH', `/tables/${id}/columns`, { columns: [{ id: c.id, fields: { isFormula: false, formula: '', type: c.type } }] });
  // Colonnes héritées du grain brut : retirées, pas seulement vidées. Une colonne
  // `visitor_id` laissée vide resterait une invitation à la reremplir.
  const aRetirer = retirees.filter((c) => parId.has(c));
  for (const c of aRetirer) await greq('DELETE', `/tables/${id}/columns/${encodeURIComponent(c)}`);
  const notes = [
    missing.length && `+${missing.map((c) => c.id).join(', ')}`,
    aConvertir.length && `formule→donnée ${aConvertir.map((c) => c.id).join(', ')}`,
    aRetirer.length && `−${aRetirer.join(', ')}`,
  ].filter(Boolean);
  console.log(`  ✓ ${id} alignée${notes.length ? ` (${notes.join(' ; ')})` : ''}`);
}
async function upsert(table, rows, keyFields) {
  if (!rows.length) return 0;
  const records = rows.map((r) => { const require = {}; for (const k of keyFields) require[k] = r[k]; return { require, fields: r }; });
  for (let i = 0; i < records.length; i += 400) await greq('PUT', `/tables/${table}/records`, { records: records.slice(i, i + 400) });
  return records.length;
}
async function supprimer(table, ids) {
  for (let i = 0; i < ids.length; i += 400) await greq('POST', `/tables/${table}/data/delete`, ids.slice(i, i + 400));
  return ids.length;
}
async function clearTable(table) {
  return supprimer(table, (await getRecords(table)).map((r) => r.id));
}
// Les lignes d'un mois recalculé que ce run n'a pas produites sont périmées (une
// combinaison qui a disparu). Les lignes de l'ANCIEN grain brut sont retirées quel
// que soit leur mois : leur clé `<visitorId>_<ts>_<idx>` porte un identifiant de
// visiteur, et un mois hors fenêtre ne doit pas le conserver. Toute clé produite
// par cet ETL commence par `YYYY-MM|` ; tout le reste est hérité.
const CLE_AGREGEE = /^\d{4}-(0[1-9]|1[0-2])\|/;
async function retirerPerimees(table, cle, gardees, moisRelus) {
  const perimees = (await getRecords(table))
    .filter((r) => !CLE_AGREGEE.test(String(r.fields[cle] ?? ''))
      || (moisRelus.has(r.fields.month) && !gardees.has(r.fields[cle])))
    .map((r) => r.id);
  return supprimer(table, perimees);
}

// --- API Matomo ---
async function mapi(method, extra = {}) {
  const body = new URLSearchParams({ module: 'API', method, idSite: String(SITE), format: 'json', token_auth: MTOKEN, ...extra });
  const r = await fetch(`${MURL}/index.php`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  // Un amont en erreur peut renvoyer un corps JSON parfaitement valide — souvent
  // un tableau vide. Sans ce contrôle, une panne se lit comme « zéro visite ».
  // Aucun extrait de corps dans les messages : une réponse de visites tronquée ou
  // renvoyée avec une erreur porte IP, identifiants et titres de page.
  if (!r.ok) throw new Error(redact(`${method} → HTTP ${r.status} : corps de longueur ${(await r.text()).length}`));
  // Lire en texte puis parser : une page de proxy ou de maintenance est du HTML servi
  // en 200, et `r.json()` lèverait une SyntaxError qui ne dit pas d'où vient le corps.
  const brut = await r.text();
  let j;
  try { j = JSON.parse(brut); }
  catch { throw new Error(redact(`${method} : réponse non-JSON (content-type ${r.headers.get('content-type')}) : corps de longueur ${brut.length}`)); }
  if (j && j.result === 'error') throw new Error(redact(method + ': ' + j.message));
  return j;
}

// --- Schéma ---
// Les noms de colonnes sont ceux que lit le widget (dashboard.html). Seuls changent :
// Events passe au grain agrégé (+count, −visitor_id/date/value) et
// KPI.utilisateurs_reguliers devient une colonne de données.
const ROLES = ['ars', 'regional', 'central'];
const SCOPES = ['global', ...ROLES];
const EVENTS_COLS = [
  { id: 'event_id', type: 'Text' }, { id: 'month', type: 'Text' }, { id: 'role', type: 'Text' },
  { id: 'category', type: 'Text' }, { id: 'action', type: 'Text' }, { id: 'name', type: 'Text' }, { id: 'count', type: 'Int' },
];
const EVENTS_RETIREES = ['visitor_id', 'date', 'value'];
const BASE_COLS = [
  { id: 'base_id', type: 'Text' }, { id: 'month', type: 'Text' }, { id: 'role', type: 'Text' },
  { id: 'actifs', type: 'Int' }, { id: 'inactifs', type: 'Int' },
];
const SCOPE = "($scope == 'global' or e.role == $scope)";
const somme = (filtre) => `sum(e.count or 0 for e in Events.lookupRecords(month=$month, ${filtre}) if ${SCOPE})`;
const KPI_COLS = [
  { id: 'kpi_id', type: 'Text' }, { id: 'month', type: 'Text' }, { id: 'scope', type: 'Text' },
  // Visiteurs distincts ayant ouvert une session dans le mois : compté par l'ETL.
  { id: 'utilisateurs_reguliers', type: 'Int' },
  // La base globale exige les trois rôles : un rôle sans instantané ce mois-là ferait
  // baisser le dénominateur global et gonfler le RC1. Le mois est alors non calculable.
  // Formules en `if` imbriqués : le WAF devant grist.numerique.gouv.fr rejette (403,
  // signature d'injection SQL) une formule où `and` précède une comparaison `<`.
  { id: 'base_agents', type: 'Int', formula: [
    "rows = [b for b in Base.lookupRecords(month=$month) if ($scope == 'global' or b.role == $scope)]",
    "if $scope == 'global':",
    "  if len(set(b.role for b in rows)) < 3:",
    "    return None",
    "return sum((b.actifs or 0) + (b.inactifs or 0) for b in rows)",
  ].join('\n') },
  // Sans base, le taux vaut None et non 0 : un 0 se lit comme une mesure.
  // Plus de réguliers que d'agents en base ne se mesure pas : base incohérente (ou
  // forgée via le tracker public). Le taux est alors None plutôt qu'un 200 %.
  { id: 'taux_reguliers_pct', type: 'Numeric', formula: [
    'if not $base_agents:',
    '  return None',
    'if $utilisateurs_reguliers is None:',
    '  return None',
    'if $utilisateurs_reguliers > $base_agents:',
    '  return None',
    'return round($utilisateurs_reguliers / $base_agents * 100, 1)',
  ].join('\n') },
  { id: 'comparaisons', type: 'Int', formula: somme("category='comparaison', action='lancer'") },
  { id: 'exports', type: 'Int', formula: somme("category='export', action='lancer'") },
  { id: 'listes', type: 'Int', formula: somme("category='liste', action='creer'") },
  { id: 'connexions', type: 'Int', formula: somme("category='session', action='connexion'") },
  { id: 'recherches', type: 'Int', formula: somme("category='recherche'") },
  { id: 'segment', type: 'Text', formula: `{'global':'Tous les agents','ars':'Agent ARS','regional':'Référent régional','central':'Administration centrale'}.get($scope, $scope)` },
];
const EXTRACTIONS_COLS = [
  { id: 'run_id', type: 'Text' }, { id: 'extracted_at', type: 'Text' }, { id: 'months', type: 'Text' },
  { id: 'site', type: 'Int' }, { id: 'visits', type: 'Int' }, { id: 'events', type: 'Int' },
  { id: 'base_rows', type: 'Int' }, { id: 'role_fill_pct', type: 'Numeric' }, { id: 'note', type: 'Text' },
];

// --- Plan de tag ---
// Le tracker Matomo est public : catégorie, action et nom sont trois entrées
// arbitraires. Les trois sont bornées — sinon la cardinalité des lignes Events reste
// illimitée, un `|` décale la clé d'agrégat, et un nom choisi atteint le widget.
// `null` : l'action ne porte pas de nom attendu, un nom éventuel est écarté sans
// être signalé (il pourrait porter une saisie de l'agent).
const PLAN = {
  recherche: { simple: null, avancee: null, reinitialiser: null },
  filtre: {
    appliquer: ['zone_geo', 'categorie_finess', 'type_structure', 'activites', 'capacites'],
    valeur_type_structure: ['sanitaire', 'ej', 'medico_social'],
    valeur_statut_juridique: ['public', 'prive_lucratif', 'prive_non_lucratif'],
  },
  session: { connexion: null },
  navigation: { console_admin: null, historique: null, cartographie: null, aide: null },
  comparaison: { lancer: ['recherche_avancee', 'liste', 'fiche_et'] },
  export: { lancer: ['gestion_listes', 'fiche_et', 'comparaison', 'recherche_avancee', 'liste'] },
  liste: { creer: null },
};
// Variantes historiques du plan de tag (espaces au lieu de soulignés, libellé long).
const ALIAS = { fiche_etablissement: 'fiche_et' };
const normaliser = (v) => {
  const s = String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ALIAS[s] || s;
};
// La base d'agents arrive par des events dédiés, rôle dans `name`, effectif dans `value`.
const BASE_CAT = 'indicateur';
const BASE_ACTIONS = { utilisateurs_actifs: 'actifs', utilisateurs_inactifs: 'inactifs' };
// Ancien format de test (juin-juillet 2026), sans rôle : ni event d'usage ni base exploitable.
const CATEGORIES_IGNOREES = new Set(['helios']);
const roleDe = (v) => { const s = normaliser(v); return ROLES.includes(s) ? s : ''; };

// Ce qui tombe hors liste est agrégé en `autre`, et l'EMPLACEMENT est compté à part :
// sinon une dérive du plan de tag devient indiscernable du bruit. La valeur reçue,
// elle, n'est jamais retenue : une valeur hors liste peut être une saisie de l'agent
// (nom, établissement, adresse), et le canari part dans Grist et dans les logs. Seuls
// des fragments du PLAN (ou `?`) composent une clé du canari ; la valeur se retrouve
// dans Matomo, qui la détient déjà.
const horsListe = new Map();
const signaler = (...emplacement) => {
  const cle = emplacement.join('/');
  horsListe.set(cle, (horsListe.get(cle) || 0) + 1);
};
function borner(category, action, name) {
  const cat = normaliser(category);
  if (!Object.hasOwn(PLAN, cat)) { if (cat) signaler('categorie=?'); return ['autre', 'autre', '']; }
  const act = normaliser(action);
  if (!Object.hasOwn(PLAN[cat], act)) { if (act) signaler(`action=${cat}`, '?'); return [cat, 'autre', '']; }
  const noms = PLAN[cat][act];
  if (!noms) return [cat, act, ''];
  const nom = normaliser(name);
  if (!nom) return [cat, act, ''];
  if (noms.includes(nom)) return [cat, act, nom];
  signaler(`nom=${cat}`, act, '?');
  return [cat, act, 'autre'];
}
// Identifiant de visiteur Matomo. L'API Live le renvoie dans `visitorId` ; `idVisitor`
// y est vide. Lire le mauvais champ ramène le RC1 à zéro sans erreur : d'où le garde
// de main() et le test qui l'exerce.
const visiteurDe = (v) => String(v.visitorId || v.idVisitor || '').trim().toLowerCase();
const entier = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0 ? n : null; };

// parMois : [{ month, visits: [...] }] — une réponse Matomo par mois de la fenêtre.
function build(parMois) {
  horsListe.clear();
  const evAgg = new Map();       // month|role|cat|action|name -> count
  const base = new Map();        // month|role -> { actifs, inactifs, ts }
  const reguliers = new Map();   // month|scope -> Set(visiteurs)
  let visites = 0, roleRemplis = 0, connexions = 0, connexionsAnonymes = 0;
  const moisRelus = new Set();

  for (const { month, visits } of parMois) {
    if (visits.length) moisRelus.add(month);
    for (const v of visits) {
      visites += 1;
      const role = roleDe(v.dimension1);
      if (role) roleRemplis += 1;
      const vid = visiteurDe(v);
      for (const a of v.actionDetails || []) {
        if (a.type !== 'event') continue;
        const catBrute = normaliser(a.eventCategory);
        if (CATEGORIES_IGNOREES.has(catBrute)) continue;
        // Base d'agents : instantané, on garde le plus récent du mois par rôle.
        if (catBrute === BASE_CAT) {
          const champ = BASE_ACTIONS[normaliser(a.eventAction)];
          const brole = roleDe(a.eventName);
          const valeur = entier(a.eventValue);
          if (!champ || !brole || valeur === null) { signaler(champ ? `base=${champ}` : 'base=?', brole || '?'); continue; }
          const ts = Number(a.timestamp) || 0;
          const k = `${month}|${brole}`;
          const cur = base.get(k) || { actifs: null, inactifs: null, tsActifs: -1, tsInactifs: -1 };
          const tsChamp = champ === 'actifs' ? 'tsActifs' : 'tsInactifs';
          if (ts >= cur[tsChamp]) { cur[champ] = valeur; cur[tsChamp] = ts; }
          base.set(k, cur);
          continue;
        }
        const [cat, act, nom] = borner(a.eventCategory, a.eventAction, a.eventName);
        const ek = `${month}|${role}|${cat}|${act}|${nom}`;
        evAgg.set(ek, (evAgg.get(ek) || 0) + 1);
        if (cat === 'session' && act === 'connexion') {
          connexions += 1;
          if (!vid) { connexionsAnonymes += 1; continue; }
          for (const scope of role ? ['global', role] : ['global']) {
            const rk = `${month}|${scope}`;
            if (!reguliers.has(rk)) reguliers.set(rk, new Set());
            reguliers.get(rk).add(vid);
          }
        }
      }
    }
  }

  const events = [...evAgg].map(([event_id, count]) => {
    const [month, role, category, action, name] = event_id.split('|');
    return { event_id, month, role, category, action, name, count };
  });
  // Un instantané incomplet (actifs sans inactifs, ou l'inverse) n'est pas publié :
  // compter l'absent pour 0 sous-estimerait la base et gonflerait le RC1.
  const baseRows = [];
  for (const [base_id, b] of base) {
    const [month, role] = base_id.split('|');
    if (b.actifs === null || b.inactifs === null) { signaler('base=incomplete', role); continue; }
    baseRows.push({ base_id, month, role, actifs: b.actifs, inactifs: b.inactifs });
  }
  // Une ligne KPI par mois × scope de la fenêtre. Le nombre de réguliers n'est écrit
  // que pour un mois effectivement relu : un mois revenu vide de Matomo ne doit pas
  // écraser à 0 une valeur déjà publiée.
  const kpi = [];
  for (const { month } of parMois) {
    for (const scope of SCOPES) {
      const row = { kpi_id: `${month}|${scope}`, month, scope };
      if (moisRelus.has(month)) row.utilisateurs_reguliers = reguliers.get(`${month}|${scope}`)?.size || 0;
      kpi.push(row);
    }
  }
  return { events, base: baseRows, kpi, moisRelus, visites, roleRemplis, connexions, connexionsAnonymes };
}

// Résumé des valeurs hors allowlist, remonté dans Extractions.note ET dans les logs
// du Job : c'est le seul endroit où une dérive du plan de tag reste visible.
function inconnus() {
  if (!horsListe.size) return '';
  const top = [...horsListe.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  // JSON.stringify borne et échappe : ces valeurs viennent du tracker public, et un
  // saut de ligne y forgerait une fausse ligne de succès dans les logs du Job.
  return ` ⚠ hors allowlist : ${top.map(([k, n]) => `${JSON.stringify(k.slice(0, 80))}×${n}`).join(', ')}`;
}

async function main() {
  const doc = await greq('GET', '');
  console.log(`▶ Doc cible : « ${doc.name} » (${GDOC})`);
  if (EXPECT_DOC_NAME && doc.name !== EXPECT_DOC_NAME) throw new Error(`Doc inattendu (${doc.name} ≠ ${EXPECT_DOC_NAME}), abandon par sécurité.`);

  // Fenêtre nocturne : mois précédent + mois en cours. Après une panne plus longue,
  // elle repart du mois du dernier succès : ce mois-là n'a été écrit que partiellement,
  // et sans ce rattrapage il resterait tronqué pour de bon, affiché comme un mois clos.
  // Un run MANUEL (--from ou --to) ne publie pas sous RUN_ID : sinon il ferait avancer
  // le « dernier succès » et le rattrapage nocturne sauterait les mois qu'il n'a pas relus.
  const MANUEL = Boolean(FROM_EXPLICITE) || process.argv.includes('--to');
  const RUN = MANUEL ? `${RUN_ID}-manuel` : RUN_ID;
  let FROM = FROM_EXPLICITE;
  if (!FROM) {
    const tables = await getTables();
    let dernierSucces = null;
    if (tables.includes('Extractions')) {
      const ligne = (await getRecords('Extractions')).find((l) => l.fields.run_id === RUN_ID);
      const m = String(ligne?.fields.extracted_at || '').slice(0, 7);
      if (MOIS_RE.test(m)) dernierSucces = m;
    }
    FROM = plusTard(plusTot(moisPrecedent(TO), dernierSucces), PLANCHER);
  }
  // Migration depuis l'ancien grain : ses lignes sont retirées quel que soit leur mois,
  // donc les mois qu'elles couvraient doivent être relus dans le MÊME run. Sinon ces
  // mois garderaient leurs réguliers et leur base, avec des usages tombés à zéro.
  // Nocturne : la fenêtre s'étend (jamais sous le plancher : plus bas, l'ancien grain
  // est hors périmètre et simplement retiré). Manuel : la fenêtre demandée fait foi, un
  // mois hérité qu'elle ne couvre pas fait refuser le run.
  let herites = [];
  if ((await getTables()).includes('Events')) {
    herites = [...new Set((await getRecords('Events'))
      .filter((l) => !CLE_AGREGEE.test(String(l.fields.event_id ?? '')))
      .map((l) => String(l.fields.month ?? '')).filter((m) => MOIS_RE.test(m) && m >= PLANCHER))].sort();
    if (MANUEL) {
      const hors = herites.filter((m) => m < FROM || m > TO);
      if (hors.length) throw new Error(`Ancien grain présent hors de la fenêtre ${FROM} → ${TO} (mois ${hors.join(', ')}) : il serait retiré sans être relu. Relancer avec --from ${plusTot(FROM, ...hors)} --to ${plusTard(TO, ...hors)}.`);
    } else {
      FROM = plusTard(plusTot(FROM, ...herites), PLANCHER);
    }
  }
  // Fenêtre vide (COLLECT_FROM dans le futur, --to avant le plancher) : aucun appel
  // Matomo ne partirait et le Job resterait vert chaque nuit sans rien collecter.
  if (FROM > TO) throw new Error(`Fenêtre vide : ${FROM} est après ${TO}.`);
  const MOIS = moisEntre(FROM, TO);
  console.log(`\n1) Extraction Matomo (site ${SITE}, ${FROM} → ${TO})`);
  const parMois = [];
  for (const month of MOIS) {
    const visits = await mapi('Live.getLastVisitsDetails', { period: 'month', date: `${month}-01`, filter_limit: '-1' });
    // Une réponse qui n'est pas un tableau est une PANNE (erreur Matomo, page de
    // proxy, réponse tronquée). La traiter comme « zéro visite » laisserait le
    // tableau de bord vert au-dessus de données périmées.
    if (!Array.isArray(visits)) {
      // La forme seule est journalisée : un contenu de visite (titre de page, identifiant)
      // peut porter une donnée individuelle.
      const forme = visits && typeof visits === 'object' ? `${Object.keys(visits).length} clé(s)` : `longueur ${String(visits).length}`;
      throw new Error(redact(`Réponse Matomo inattendue pour ${month} (${typeof visits}) : ${forme}`));
    }
    parMois.push({ month, visits });
    console.log(`  · ${month} : ${visits.length} visites`);
  }
  const r = build(parMois);

  // Un mois hérité revenu VIDE de Matomo ne peut pas être reconstruit : retirer son
  // ancien grain détruirait la seule copie de ses usages. Le run s'arrête avant écriture.
  const nonRelus = herites.filter((m) => m >= FROM && m <= TO && !r.moisRelus.has(m));
  if (nonRelus.length) {
    throw new Error(`Ancien grain : mois ${nonRelus.join(', ')} revenu(s) vide(s) de Matomo, retrait refusé (ses usages seraient perdus sans être reconstruits).`);
  }

  // Des connexions sans identifiant de visiteur lisible ne peuvent venir que d'un
  // schéma Matomo qui a changé (champ renommé). Publier quand même ferait chuter le
  // RC1 à zéro en silence : c'est l'indicateur central du tableau de bord.
  if (r.connexionsAnonymes) {
    throw new Error(
      `Anomalie : ${r.connexionsAnonymes} connexion(s) sur ${r.connexions} sans identifiant de visiteur — ` +
      `le schéma Matomo a probablement changé (champ visitorId absent ?). RC1 non publié.`
    );
  }

  if (RESET && !r.visites) throw new Error('--reset refusé : aucune ligne construite, les tables seraient vidées sans rien pour les repeupler.');
  if (!r.visites) {
    // Une fenêtre sans trafic n'est pas une panne quand le produit a DÉJÀ collecté.
    // N'avoir JAMAIS rien collecté, si : `site_id` faux ou tag absent. Échappatoire
    // nominative par ALLOW_EMPTY_COLLECT (cf. BASAVI pour le raisonnement complet).
    const toleres = (cfg.ALLOW_EMPTY_COLLECT || '').split(',').map((x) => x.trim()).filter(Boolean);
    const tolereVide = Boolean(cfg.PRODUIT) && toleres.includes(cfg.PRODUIT);
    const dejaCollecte = tolereVide || ((await getTables()).includes('Events') && (await getRecords('Events')).length > 0);
    if (!dejaCollecte) {
      throw new Error(
        `Aucune visite sur ${FROM} → ${TO} et la table Events est vide : ce produit n'a jamais ` +
        `rien collecté. Vérifier MATOMO_SITE_ID (${SITE}) et la présence du tag sur le site. Si ` +
        `l'absence de trafic est attendue, ajouter « ${cfg.PRODUIT} » à ALLOW_EMPTY_COLLECT dans cron.env de l'env.`
      );
    }
    // L'horodatage d'extraction n'est pas rafraîchi : le bandeau du tableau de bord
    // vieillit visiblement, ce qui est le signal attendu pour un creux.
    console.warn(`⚠ Aucune visite sur ${FROM} → ${TO} — rien à publier. L'horodatage d'extraction reste inchangé.`);
    return;
  }

  // Le reset ne vide qu'APRÈS une extraction qui a produit de quoi repeupler, et
  // seulement si la fenêtre relit TOUS les mois déjà présents : clearTable vide la
  // table entière, un mois absent de la fenêtre (ou revenu vide de Matomo) serait
  // effacé sans rien pour le reconstruire. Le contrôle porte sur le contenu du doc,
  // pas sur la ligne de commande : COLLECT_FROM borne aussi la fenêtre.
  if (RESET) {
    if (!r.events.length && !r.base.length) throw new Error('--reset refusé : aucune ligne construite, les tables seraient vidées sans rien pour les repeupler.');
    // Une ligne KPI sans réguliers n'est pas de l'historique : le seul chiffre qu'elle
    // porte en propre est ce nombre, tout le reste est formule. L'ancien script créait
    // de telles lignes pour des mois vides, que Matomo ne rendra jamais.
    const tables = await getTables();
    const horsFenetre = new Set();
    for (const t of ['Events', 'Base', 'KPI'].filter((x) => tables.includes(x))) {
      for (const l of await getRecords(t)) {
        if (t === 'KPI' && !l.fields.utilisateurs_reguliers) continue;
        // Une ligne au mois illisible (saisie manuelle) peut porter de l'historique : le
        // reset refuse, et le message dit de la corriger dans Grist.
        const m = String(l.fields.month ?? '');
        if (!MOIS_RE.test(m)) { horsFenetre.add(`${t} n°${l.id} au mois illisible, à corriger dans Grist`); continue; }
        if (!r.moisRelus.has(m)) horsFenetre.add(m);
      }
    }
    if (horsFenetre.size) {
      throw new Error(`--reset refusé : il effacerait tout l'historique hors de la fenêtre relue (mois ${[...horsFenetre].sort().join(', ')}). Relancer avec un --from qui couvre ces mois.`);
    }
  }

  // Le schéma n'est touché qu'APRÈS les gardes : une panne amont laisse le doc intact.
  // KPI est converti avant le retrait des colonnes d'Events, sa formule héritée lisant
  // `visitor_id` jusqu'à sa conversion.
  console.log('\n2) Schéma');
  await ensureTable('Events', EVENTS_COLS);
  await ensureTable('Base', BASE_COLS);
  await ensureTable('KPI', KPI_COLS);
  await ensureTable('Extractions', EXTRACTIONS_COLS);
  await ensureTable('Events', EVENTS_COLS, EVENTS_RETIREES);

  if (RESET) {
    console.log('\n2b) Reset');
    for (const t of ['Events', 'Base', 'KPI', 'Extractions']) console.log(`  ✗ ${t} : ${await clearTable(t)} lignes`);
  }

  console.log('\n3) Push');
  const nE = await upsert('Events', r.events, ['event_id']);
  const nB = await upsert('Base', r.base, ['base_id']);
  const nK = await upsert('KPI', r.kpi, ['kpi_id']);
  const rE = await retirerPerimees('Events', 'event_id', new Set(r.events.map((e) => e.event_id)), r.moisRelus);
  const rB = await retirerPerimees('Base', 'base_id', new Set(r.base.map((b) => b.base_id)), r.moisRelus);

  const fillPct = Math.round((100 * r.roleRemplis) / r.visites);
  const relus = [...r.moisRelus].sort();
  await upsert('Extractions', [{
    run_id: RUN, extracted_at: new Date().toISOString(), months: relus.join(', '), site: Number(SITE),
    visits: r.visites, events: r.events.reduce((s, e) => s + e.count, 0), base_rows: nB, role_fill_pct: fillPct,
    note: `Matomo réel, site ${SITE}. Grain mois × rôle, visiteurs distincts comptés par l'ETL.${inconnus()}`,
  }], ['run_id']);

  if (horsListe.size) console.warn(`⚠ valeurs hors allowlist rencontrées :${inconnus()}`);
  console.log(`\n✓ Push : Events=${nE}, Base=${nB}, KPI=${nK}, Extractions=1 (périmées retirées : Events=${rE}, Base=${rB})`);
  console.log(`  ${r.visites} visites · rôle peuplé ${fillPct} % · mois relus ${relus.join(', ')}`);
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
