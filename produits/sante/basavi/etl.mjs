// Collecte BASAVI : Matomo → doc Grist « Preprod - BASAVI ».
// Extrait le RÉEL depuis Matomo et peuple Sessions / Events / Modes / Indicateurs / Extractions.
// - Schéma miroir EXACT du doc de démo (mêmes colonnes, lues par le widget DSFR).
// - Grain jour × device (mobile / desktop / tous). Device natif Matomo.
// - Reconstruit les compteurs de sessions (funnel) à partir des visites réelles.
// - Idempotent : PUT AddOrUpdate sur clé naturelle. `--reset` vide les 5 tables avant.
//
// Config : injectée par Kubernetes (envFrom du Secret déscellé) en prod, ou via un
// fichier `.env` local (gitignoré) en développement. Contrat de variables commun au
// socle (cf. chart/ et Taskfile.yml) :
//   MATOMO_URL, MATOMO_TOKEN_AUTH, MATOMO_SITE_ID, GRIST_URL, GRIST_API_KEY, GRIST_DOC_ID
// Optionnelles : COLLECT_FROM (date de début), GRIST_DOC_NAME (vérif de sécurité), RUN_ID.
//
// Usage local : node produits/sante/basavi/etl.mjs [--reset] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
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
const RUN_ID = cfg.RUN_ID || 'basavi';
const RESET = process.argv.includes('--reset');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const FROM = arg('--from', cfg.COLLECT_FROM || '2026-08-06');
const TO = arg('--to', new Date().toISOString().slice(0, 10));

const MISSING = ['MATOMO_URL', 'MATOMO_TOKEN_AUTH', 'MATOMO_SITE_ID', 'GRIST_URL', 'GRIST_API_KEY', 'GRIST_DOC_ID'].filter((k) => !cfg[k]);
if (MISSING.length) throw new Error('Variables d\'environnement manquantes : ' + MISSING.join(', '));

// --- REST Grist ---
async function greq(method, path, body) {
  const r = await fetch(`${GBASE}/api/docs/${GDOC}${path}`, {
    method, headers: { Authorization: `Bearer ${GKEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text(); let j; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} → HTTP ${r.status} : ${typeof j === 'string' ? j : JSON.stringify(j)}`);
  return j;
}
const getTables = () => greq('GET', '/tables').then((d) => d.tables.map((t) => t.id));
const getColumns = (t) => greq('GET', `/tables/${t}/columns`).then((d) => d.columns.map((c) => c.id));
const getRecords = (t) => greq('GET', `/tables/${t}/records`).then((d) => d.records);
const colDef = (c) => ({ id: c.id, fields: c.formula
  ? { label: c.id, type: c.type || 'Any', isFormula: true, formula: c.formula }
  : { label: c.id, type: c.type || 'Text' } });
async function ensureTable(id, cols) {
  const tables = await getTables();
  if (!tables.includes(id)) { await greq('POST', '/tables', { tables: [{ id, columns: cols.map(colDef) }] }); console.log(`  ✓ ${id} créée (${cols.length} col.)`); return; }
  const existing = new Set(await getColumns(id));
  const missing = cols.filter((c) => !existing.has(c.id));
  if (missing.length) await greq('POST', `/tables/${id}/columns`, { columns: missing.map(colDef) });
  for (const c of cols.filter((x) => x.formula)) await greq('PATCH', `/tables/${id}/columns`, { columns: [{ id: c.id, fields: { isFormula: true, formula: c.formula, type: c.type } }] });
  console.log(`  ✓ ${id} alignée${missing.length ? ` (+${missing.map((c) => c.id).join(', ')})` : ''}`);
}
async function upsert(table, rows, keyFields) {
  if (!rows.length) return 0;
  const records = rows.map((r) => { const require = {}; for (const k of keyFields) require[k] = r[k]; return { require, fields: r }; });
  for (let i = 0; i < records.length; i += 400) await greq('PUT', `/tables/${table}/records`, { records: records.slice(i, i + 400) });
  return records.length;
}
async function clearTable(table) {
  const ids = (await getRecords(table)).map((r) => r.id); if (!ids.length) return 0;
  for (let i = 0; i < ids.length; i += 400) await greq('POST', `/tables/${table}/data/delete`, ids.slice(i, i + 400));
  return ids.length;
}

// --- API Matomo ---
async function mapi(method, extra = {}) {
  const body = new URLSearchParams({ module: 'API', method, idSite: String(SITE), format: 'json', token_auth: MTOKEN, ...extra });
  const r = await fetch(`${MURL}/index.php`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json();
  if (j && j.result === 'error') throw new Error(method + ': ' + j.message);
  return j;
}

// --- Schéma (miroir EXACT du doc de démo) ---
const SESSIONS_COLS = [
  { id: 'sess_id', type: 'Text' }, { id: 'day', type: 'Text' }, { id: 'date', type: 'Date' }, { id: 'device', type: 'Text' },
  { id: 'visites', type: 'Int' }, { id: 's_recherche', type: 'Int' }, { id: 's_resultats', type: 'Int' },
  { id: 's_contact', type: 'Int' }, { id: 's_tel', type: 'Int' }, { id: 's_copie', type: 'Int' }, { id: 'part_alv_pct', type: 'Numeric' },
];
const EVENTS_COLS = [
  { id: 'event_id', type: 'Text' }, { id: 'day', type: 'Text' }, { id: 'date', type: 'Date' }, { id: 'device', type: 'Text' },
  { id: 'category', type: 'Text' }, { id: 'action', type: 'Text' }, { id: 'name', type: 'Text' }, { id: 'count', type: 'Int' },
];
const MODES_COLS = [
  { id: 'mode_id', type: 'Text' }, { id: 'day', type: 'Text' }, { id: 'date', type: 'Date' }, { id: 'device', type: 'Text' }, { id: 'mode', type: 'Text' },
  { id: 's_arrivee', type: 'Int' }, { id: 's_recherche', type: 'Int' }, { id: 's_resultats', type: 'Int' }, { id: 's_contact', type: 'Int' },
];
const S = "Sessions.lookupOne(sess_id=$ind_id)";
const INDIC_COLS = [
  { id: 'ind_id', type: 'Text' }, { id: 'day', type: 'Text' }, { id: 'date', type: 'Date' }, { id: 'device', type: 'Text' },
  { id: 'visites', type: 'Int', formula: `${S}.visites or 0` },
  { id: 'lancement_pct', type: 'Numeric', formula: `round(100*(${S}.s_recherche or 0)/$visites,1) if $visites else 0` },
  { id: 'clictel_pct', type: 'Numeric', formula: `round(100*(${S}.s_tel or 0)/$visites,1) if $visites else 0` },
  { id: 'copieadr_pct', type: 'Numeric', formula: `round(100*(${S}.s_copie or 0)/$visites,1) if $visites else 0` },
  { id: 'abandon_pct', type: 'Numeric', formula: `round(100*(1-(${S}.s_contact or 0)/$visites),1) if $visites else 0` },
  { id: 'partalv_pct', type: 'Numeric', formula: `${S}.part_alv_pct or 0` },
  { id: 'recherches', type: 'Int', formula: `sum(e.count for e in Events.lookupRecords(day=$day, device=$device, category='recherche', action='lancer'))` },
  { id: 'err404', type: 'Int', formula: `sum(e.count for e in Events.lookupRecords(day=$day, device=$device, category='erreur', action='404'))` },
  { id: 'err500', type: 'Int', formula: `sum(e.count for e in Events.lookupRecords(day=$day, device=$device, category='erreur', action='500'))` },
];
const EXTRACT_COLS = [
  { id: 'run_id', type: 'Text' }, { id: 'extracted_at', type: 'Text' }, { id: 'source', type: 'Text' },
  { id: 'days', type: 'Text' }, { id: 'jours', type: 'Int' }, { id: 'devices', type: 'Text' }, { id: 'note', type: 'Text' },
];

// --- Helpers extraction ---
const DEVICE = (t) => /bureau|desktop|ordinateur/i.test(t || '') ? 'desktop' : 'mobile'; // smartphone/phablette/tablette → mobile
const dayTs = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 1000;
const isALV = (v) => /arretonslesviolences/i.test((v.referrerUrl || '') + (v.referrerName || ''));

function build(visits) {
  // agrégateurs par clé jour|device
  const sess = new Map();   // day|dev -> compteurs + {alv, tot}
  const evAgg = new Map();  // day|dev|cat|action|name -> count
  const modeAgg = new Map();// day|dev|mode -> funnel

  const getSess = (day, dev) => { const k = `${day}|${dev}`; if (!sess.has(k)) sess.set(k, { day, dev, visites: 0, s_recherche: 0, s_resultats: 0, s_contact: 0, s_tel: 0, s_copie: 0, alv: 0 }); return sess.get(k); };
  const getMode = (day, dev, mode) => { const k = `${day}|${dev}|${mode}`; if (!modeAgg.has(k)) modeAgg.set(k, { day, dev, mode, s_arrivee: 0, s_recherche: 0, s_resultats: 0, s_contact: 0 }); return modeAgg.get(k); };

  // Exclusion des visites de simulation injectées le 06/08 via l'API de tracking (visitorId `ba5a51*`).
  // Le plugin RGPD DataSubjects n'est pas installé sur l'instance → on écarte ces visites ici pour
  // ne garder que de vraies navigations. À retirer quand les visites seront purgées côté Matomo.
  const SIM_VID = 'ba5a51';
  for (const v of visits) {
    if (((v.visitorId || v.idVisitor || '') + '').toLowerCase().includes(SIM_VID)) continue;
    const day = v.serverDate; if (!day || day < FROM || day > TO) continue;
    const dev = DEVICE(v.deviceType);
    const acts = v.actionDetails || [];
    // signaux de visite
    let searched = false, contacted = false, tel = false, copie = false, reached = false, entryMode = null;
    for (const a of acts) {
      if (a.type === 'action' && /\/search/.test(a.url || '')) reached = true;
      if (a.type !== 'event') continue;
      const cat = a.eventCategory || '', act = a.eventAction || '', name = a.eventName || '';
      // agrégat Events (day|dev|cat|action|name). On ne garde le `nom` que là où il est BORNÉ :
      // recherche/lancer (3 modes) et recherche/filtrer (6 types). Pour contact (nom = id asso) et
      // erreur (nom = URL), on droppe le nom → cardinalité maîtrisée (cf. cadrage scaling Grist).
      const evName = cat === 'recherche' ? name : '';
      const ek = `${day}|${dev}|${cat}|${act}|${evName}`; evAgg.set(ek, (evAgg.get(ek) || 0) + 1);
      if (cat === 'recherche' && act === 'lancer') { searched = true; if (!entryMode && name) entryMode = name; reached = true; }
      if (cat === 'recherche' && act === 'filtrer') reached = true;
      if (cat === 'contact') { contacted = true; if (act === 'clic_telephone') tel = true; if (act === 'copie_adresse') copie = true; }
    }
    const s = getSess(day, dev);
    s.visites += 1;
    if (searched) s.s_recherche += 1;
    if (reached) s.s_resultats += 1;
    if (contacted) s.s_contact += 1;
    if (tel) s.s_tel += 1;
    if (copie) s.s_copie += 1;
    if (isALV(v)) s.alv += 1;
    // funnel par mode d'entrée (une visite = son 1er mode de lancement)
    if (entryMode) { const m = getMode(day, dev, entryMode); m.s_arrivee += 1; m.s_recherche += 1; if (reached) m.s_resultats += 1; if (contacted) m.s_contact += 1; }
  }

  // --- lignes device réel (mobile/desktop) ---
  const sessions = [], events = [], modes = [], indic = [];
  const days = new Set();
  for (const s of sess.values()) {
    days.add(s.day);
    const part_alv = s.visites ? Math.round((100 * s.alv) / s.visites * 10) / 10 : 0;
    sessions.push({ sess_id: `${s.day}|${s.dev}`, day: s.day, date: dayTs(s.day), device: s.dev, visites: s.visites, s_recherche: s.s_recherche, s_resultats: s.s_resultats, s_contact: s.s_contact, s_tel: s.s_tel, s_copie: s.s_copie, part_alv_pct: part_alv });
    indic.push({ ind_id: `${s.day}|${s.dev}`, day: s.day, date: dayTs(s.day), device: s.dev });
  }
  for (const [k, count] of evAgg) { const [day, dev, category, action, name] = k.split('|'); events.push({ event_id: k, day, date: dayTs(day), device: dev, category, action, name, count }); }
  for (const m of modeAgg.values()) modes.push({ mode_id: `${m.day}|${m.dev}|${m.mode}`, day: m.day, date: dayTs(m.day), device: m.dev, mode: m.mode, s_arrivee: m.s_arrivee, s_recherche: m.s_recherche, s_resultats: m.s_resultats, s_contact: m.s_contact });

  // --- device 'tous' = somme mobile+desktop par jour ---
  for (const day of days) {
    const rows = sessions.filter((x) => x.day === day && x.device !== 'tous');
    const vt = rows.reduce((a, r) => a + r.visites, 0);
    const sum = (f) => rows.reduce((a, r) => a + r[f], 0);
    const alvw = rows.reduce((a, r) => a + r.part_alv_pct * r.visites, 0);
    sessions.push({ sess_id: `${day}|tous`, day, date: dayTs(day), device: 'tous', visites: vt, s_recherche: sum('s_recherche'), s_resultats: sum('s_resultats'), s_contact: sum('s_contact'), s_tel: sum('s_tel'), s_copie: sum('s_copie'), part_alv_pct: vt ? Math.round(alvw / vt * 10) / 10 : 0 });
    indic.push({ ind_id: `${day}|tous`, day, date: dayTs(day), device: 'tous' });
    // Events 'tous' = somme par (cat,action,name)
    const agg = {};
    for (const e of events.filter((x) => x.day === day && x.device !== 'tous')) { const kk = `${e.category}|${e.action}|${e.name}`; agg[kk] = (agg[kk] || 0) + e.count; }
    for (const [kk, c] of Object.entries(agg)) { const [category, action, name] = kk.split('|'); events.push({ event_id: `${day}|tous|${category}|${action}|${name}`, day, date: dayTs(day), device: 'tous', category, action, name, count: c }); }
    // Modes 'tous' = somme par mode
    const mAgg = {};
    for (const m of modes.filter((x) => x.day === day && x.device !== 'tous')) { const mk = m.mode; const cur = mAgg[mk] || { s_arrivee: 0, s_recherche: 0, s_resultats: 0, s_contact: 0 }; cur.s_arrivee += m.s_arrivee; cur.s_recherche += m.s_recherche; cur.s_resultats += m.s_resultats; cur.s_contact += m.s_contact; mAgg[mk] = cur; }
    for (const [mode, cur] of Object.entries(mAgg)) modes.push({ mode_id: `${day}|tous|${mode}`, day, date: dayTs(day), device: 'tous', mode, ...cur });
  }
  return { sessions, events, modes, indic, days: [...days].sort() };
}

async function main() {
  const doc = await greq('GET', '');
  console.log(`▶ Doc cible : « ${doc.name} » (${GDOC})`);
  if (EXPECT_DOC_NAME && doc.name !== EXPECT_DOC_NAME) throw new Error(`Doc inattendu (${doc.name} ≠ ${EXPECT_DOC_NAME}), abandon par sécurité.`);

  console.log('\n1) Schéma');
  await ensureTable('Sessions', SESSIONS_COLS);
  await ensureTable('Events', EVENTS_COLS);
  await ensureTable('Modes', MODES_COLS);
  await ensureTable('Indicateurs', INDIC_COLS);
  await ensureTable('Extractions', EXTRACT_COLS);

  if (RESET) { console.log('\n2) Reset'); for (const t of ['Sessions', 'Events', 'Modes', 'Indicateurs', 'Extractions']) console.log(`  ✗ ${t} : ${await clearTable(t)} lignes`); }

  console.log(`\n3) Extraction Matomo (site ${SITE}, ${FROM} → ${TO}) + push`);
  const visits = await mapi('Live.getLastVisitsDetails', { period: 'range', date: `${FROM},${TO}`, filter_limit: '-1' });
  const arr = Array.isArray(visits) ? visits : [];
  const { sessions, events, modes, indic, days } = build(arr);

  const nS = await upsert('Sessions', sessions, ['sess_id']);
  const nE = await upsert('Events', events, ['event_id']);
  const nM = await upsert('Modes', modes, ['mode_id']);
  const nI = await upsert('Indicateurs', indic, ['ind_id']);
  const stamp = new Date().toISOString();
  await upsert('Extractions', [{
    run_id: RUN_ID, extracted_at: stamp, source: `Matomo réel, site ${SITE}`,
    days: days.length ? `${days[0]} → ${days[days.length - 1]}` : '(aucun)', jours: days.length,
    devices: 'tous, mobile, desktop',
    note: `${arr.length} visites brutes. Grain jour × device.`,
  }], ['run_id']);

  console.log(`\n✓ Push : Sessions=${nS}, Events=${nE}, Modes=${nM}, Indicateurs=${nI}, Extractions=1`);
  console.log(`  ${arr.length} visites brutes · ${days.length} jours${days.length ? ` (${days[0]} → ${days[days.length - 1]})` : ''}`);
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
