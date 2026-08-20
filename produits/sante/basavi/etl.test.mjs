// Tests de non-régression de l'agrégation ETL. Node pur, aucune dépendance.
//
// `etl.mjs` appelle `main()` au chargement : le test en importe une copie privée
// dont la dernière ligne (le point d'entrée) est retirée et `build` exporté. Le
// reste du fichier est celui qui part en production, à l'octet près.
//
// Ce qui se joue ici : `category`, `action` et `name` viennent tous les trois de
// l'endpoint de tracking Matomo, qui est PUBLIC. Ils servent de composants à une
// clé jointe par « | » que l'on refend ensuite : sans allowlist, un « | » dans
// l'action décale la refente et réinjecte du texte choisi dans une autre colonne.
//
// Lancer : task test  —  ou  node produits/sante/basavi/etl.test.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ici = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(ici, 'etl.mjs'), 'utf8');
const sansEntree = source.replace(/^main\(\)\.catch\(.*$/m, 'export { build };');
if (sansEntree === source) throw new Error("le point d'entrée main() n'a pas été trouvé dans etl.mjs");

const copie = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'etl-test-')), 'etl.mjs');
fs.writeFileSync(copie, sansEntree);
process.env.MATOMO_URL ||= 'https://matomo.invalid';
process.env.MATOMO_SITE_ID ||= '168';
process.env.MATOMO_TOKEN_AUTH ||= 'x';
process.env.GRIST_URL ||= 'https://grist.invalid';
process.env.GRIST_DOC_ID ||= 'x';
process.env.GRIST_API_KEY ||= 'x';
process.env.COLLECT_FROM ||= '2020-01-01';
const { build } = await import(pathToFileURL(copie).href);

let echecs = 0;
const verifier = (titre, condition) => {
  console.log(`${condition ? '  ok  ' : 'ÉCHEC '}${titre}`);
  if (!condition) echecs += 1;
};

const JOUR = '2026-08-19';
const visite = (evenements) => ({
  visitorId: 'aaaaaaaaaaaaaaaa', serverDate: JOUR, deviceType: 'smartphone',
  actionDetails: evenements.map(([eventCategory, eventAction, eventName]) =>
    ({ type: 'event', eventCategory, eventAction, eventName })),
});
const evenementsReels = (r) => r.events.filter((e) => e.device !== 'tous')
  .map((e) => ({ c: e.category, a: e.action, n: e.name, count: e.count }));

// --- Un « | » dans l'action ne doit pas réinjecter du texte dans la colonne `name`
{
  const r = build([visite([['recherche', 'filtrer|violences-conjugales', '<img src=x onerror=alert(1)>']])]);
  const [ligne] = evenementsReels(r);
  console.log(`      ${JSON.stringify(ligne)}`);
  verifier('pipe dans l’action : l’action est bornée', ligne.a === 'autre');
  verifier('pipe dans l’action : le nom ne porte pas la valeur forgée', ligne.n === 'autre');
  verifier('pipe dans l’action : une seule ligne Events produite', evenementsReels(r).length === 1);
}

// --- Category et action arbitraires tombent dans le seau `autre` -----------------
{
  const r = build([visite([
    ['<script>bad</script>', 'lancer', 'saisie'],
    ['recherche', '<script>bad</script>', 'saisie'],
  ])]);
  const lignes = evenementsReels(r);
  console.log(`      ${JSON.stringify(lignes)}`);
  verifier('catégorie hors liste : bornée à « autre »', lignes.every((l) => l.c === 'recherche' || l.c === 'autre'));
  verifier('action hors liste : bornée à « autre »', lignes.every((l) => l.a === 'lancer' || l.a === 'autre'));
  verifier('aucun composant ne contient de « | »',
    lignes.every((l) => ![l.c, l.a, l.n].some((x) => String(x).includes('|'))));
}

// --- La cardinalité est bornée, quel que soit le nombre de valeurs distinctes ----
// Sans allowlist, 300 requêtes de tracking créent 300 lignes Grist par jour et device.
{
  const evenements = Array.from({ length: 300 }, (_, i) => ['recherche', `act-${i}`, `nom-${i}`]);
  const r = build([visite(evenements)]);
  const lignes = evenementsReels(r);
  console.log(`      300 événements distincts -> ${lignes.length} ligne(s) Events`);
  verifier('300 valeurs forgées ne produisent qu’une ligne', lignes.length === 1);
}

// --- Les valeurs légitimes traversent intactes -----------------------------------
{
  const r = build([visite([
    ['recherche', 'lancer', 'saisie'],
    ['recherche', 'filtrer', 'violences-conjugales'],
    ['contact', 'clic_telephone', 'asso-4271'],
    ['erreur', '404', '/une/url/fautive'],
  ])]);
  const lignes = evenementsReels(r);
  console.log(`      ${JSON.stringify(lignes)}`);
  const trouve = (c, a, n) => lignes.some((l) => l.c === c && l.a === a && l.n === n);
  verifier('mode d’entrée conservé', trouve('recherche', 'lancer', 'saisie'));
  verifier('type de filtre conservé', trouve('recherche', 'filtrer', 'violences-conjugales'));
  // Nom volontairement droppé hors `recherche` : id d'asso et URL sont non bornés.
  verifier('nom droppé pour contact (id d’asso)', trouve('contact', 'clic_telephone', ''));
  verifier('nom droppé pour erreur (URL)', trouve('erreur', '404', ''));
  verifier('la visite est comptée comme un contact',
    r.sessions.find((s) => s.device === 'mobile').s_contact === 1);
  verifier('le funnel du mode « saisie » est alimenté',
    r.modes.some((m) => m.mode === 'saisie' && m.s_arrivee === 1));
}

// --- Un mode d'entrée forgé n'entre pas dans la répartition ----------------------
{
  const r = build([visite([['recherche', 'lancer', 'mode-invente']])]);
  verifier('mode d’entrée hors liste : aucun funnel de mode créé', r.modes.length === 0);
  verifier('la recherche reste comptée dans la session',
    r.sessions.find((s) => s.device === 'mobile').s_recherche === 1);
}

console.log(echecs ? `\n${echecs} échec(s)` : '\nTous les tests passent.');
process.exit(echecs ? 1 : 0);
