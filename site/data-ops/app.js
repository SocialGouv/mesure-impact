/* Data Ops · logique du widget (maquette V5).
   Dans Grist, les tableaux PRODUITS, RETOURS, CARTES, RESSOURCES et INSTANTANES deviennent des tables natives. */
(function () {
"use strict";
var $ = function (id) { return document.getElementById(id); };
var esc = function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };
var each = function (sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); };
var AUJOURDHUI = new Date(); AUJOURDHUI.setHours(0, 0, 0, 0);

/* ---------- Référentiel : une échelle de 7 étapes, chacune close par un livrable, chacune sa couleur ---------- */
var ETAPES = [
  ["Découverte", "Dossier produit", "purple-glycine"], ["Atelier", "Restitution d'atelier", "pink-macaron"], ["V1", "Présentation V1", "orange-terre-battue"],
  ["Tagging", "Plan validé", "yellow-tournesol"], ["Recette", "Recette du tagging", "green-tilleul-verveine"], ["MEP", "Tableau de bord en prod", "green-menthe"]
];
var DEPTS = { "GPS": "blue-ecume", "Santé": "green-emeraude", "IDN": "brown-caramel" };
var STATUTS = { actif: ["fr-badge--info", "Actif"], pause: ["fr-badge--warning", "En pause"], autonome: ["fr-badge--success", "Autonome"] };
var PIL = ["Utilisable", "Utilisé", "Utile", "Impactant"];
var AUTRES_PRODUITS = 36;
var couloir = function (step) { return step >= 5 ? "autonomie" : step >= 1 ? "accompagnement" : "cadrage"; };
var COULOIRS = ["prochainement", "cadrage", "accompagnement", "autonomie"];
var vars = function (c) { return "--grp-bg:var(--background-contrast-" + c + ");--grp-fg:var(--text-label-" + c + ");--grp-bar:var(--background-action-high-" + c + ")"; };
var G = function (id) { return "https://grist.numerique.gouv.fr/o/studio/" + id; };
var FORM = "https://grist.numerique.gouv.fr/o/studio/forms/retours";

/* step = dernière étape franchie (-1 si aucune) ; l'étape en cours est step + 1 */
var PRODUITS = [];
var RETOURS = [];
RETOURS.forEach(function (r, i) { r.key = "m" + i; });
/* Statuts du circuit des retours : l'ordre est celui des colonnes du kanban */
var RST = { nouveau: ["fr-badge--new", "Nouveau"], propose: ["fr-badge--purple-glycine", "Réponse proposée"], valide: ["fr-badge--info", "Validé par le produit"], encours: ["fr-badge--warning", "En cours"], livre: ["fr-badge--success", "Livré"], ecarte: ["", "Écarté"] };
var ouvert = function (r) { return r.st !== "livre" && r.st !== "ecarte"; };
/* Natures : les quatre du formulaire, et les anciennes valeurs de la table ramenées à elles */
var NAT = { data: ["Donnée fausse ou manquante", "fr-badge--orange-terre-battue"], aff: ["Affichage", "fr-badge--blue-cumulus"], ind: ["Nouvel indicateur", "fr-badge--green-menthe"], q: ["Question", "fr-badge--purple-glycine"] };
var NATV = { "Donnée fausse ou manquante": "data", "Bug": "data", "Affichage": "aff", "Optimisation": "aff", "Lecture difficile": "aff", "Bug d'affichage": "aff", "Nouvel indicateur": "ind", "Idée d'indicateur": "ind", "Question": "q", "Demande ad hoc": "q" };
var TEMPS = [["Cadrage", ["Cadrage produit", "Indicateurs et spec"]], ["Conception", ["Présentation", "Plan de tagging", "Proto de tableau de bord"]], ["Production", ["Tableau de bord en ligne", "Recette et audit", "Code et déploiement", "Note technique"]], ["Suivi", ["Pilotage et restitution"]]];

/* ---------- Cartes du mois : elles composent la mise à jour du mois, chiffres et course sont calculés ---------- */
var MOIS = { "2026-09": ["Septembre 2026", "2026-09-30", "de la prod réelle au relais anti-bloqueur"], "2026-10": ["Octobre 2026", "2026-10-31", "la mesure d'impact sort de Notion"] };
var COLS_NEXT = ["Gouvernance SI · les priorités", "Prochains tableaux de bord en production", "Prochains produits à accompagner"];
/* Trajectoire : le mois de la revue est marqué « nous sommes ici » */
var TRAJECTOIRE = [["Avril", "Démarche lancée, aucun produit mesuré."], ["Juin", "Premiers ateliers indicateurs et prototypes de tableaux de bord."], ["Juillet", "Couche de restitution retenue, chaîne prouvée en préprod."],
  ["Août", "Collecte hébergée sur la fabrique, premier tableau de bord validé par une équipe produit."], ["Septembre", "BASAVI en prod réelle, relais retenu contre le bloqueur, Médlé et VAO entrent."],
  ["Octobre", "Doc Data Ops dans Grist, prod HELIOS, atelier Médlé."], ["Novembre", "Analyse de la recherche utilisateur BASAVI, deuxième tableau de bord en prod."]];
var COURBES_AOUT = { equipes: [["Avr", 3], ["Mai", 4], ["Juin", 6], ["Juil", 7], ["Août", 9]], tdb: [["Avr", 0], ["Mai", 0], ["Juin", 0], ["Juil", 1], ["Août", 2]] };
var CARTES = [];
var KINDS = { ctx: "Contexte", acc: "Accomplissements", frein: "Freins et réponses", next: "Prochaines étapes", ech: "Échéances" };
/* Instantanés : l'étape de chaque produit figée à la publication d'une revue (ici, celle de juillet-août) */
var H = window.MESURE_IMPACT;
var INSTANTANE_AOUT = H.produits.slice();

var GH = "https://github.com/SocialGouv/mesure-impact";
var RESSOURCES = [];

/* ---------- Composants ---------- */
var badge = function (cls, txt) { return '<p class="fr-badge fr-badge--sm fr-badge--no-icon ' + cls + '">' + esc(txt) + '</p>'; };
var cur = function (s) { return Math.min(s + 1, 5); };
var etapeBadge = function (s) { var e = ETAPES[cur(s)]; return badge("fr-badge--" + e[2], e[0]); };
var deptBadge = function (d) { return badge("fr-badge--" + DEPTS[d], d); };
var prodBy = function (id) { return PRODUITS.filter(function (p) { return p.id === id; })[0]; };
var echue = function (e) { var m = /^(\d{2})\/(\d{2})$/.exec(e || ""); return !!m && new Date(2026, +m[2] - 1, +m[1]) < AUJOURDHUI; };
var ouverteA = function (j) { return j[1] === "Action" && !j[5]; };
var prochaineAction = function (p) { var a = p.journal.filter(ouverteA); a.sort(function (x, y) { return echue(y[4]) - echue(x[4]); }); return a[0]; };
var actionHtml = function (a) { return a ? '<span class="dop-action"><span>' + esc(a[2]) + '</span><span class="fr-text--xs fr-mb-0 ' + (echue(a[4]) ? "dop-late" : "dop-sub") + '">' + esc(a[3]) + (a[4] ? " · " + (echue(a[4]) ? "en retard, " : "") + esc(a[4]) : "") + '</span></span>' : '<span class="dop-sub">Aucune action</span>'; };
var retoursOuverts = function (id) { return RETOURS.filter(function (r) { return r.p === id && ouvert(r); }).length; };
var state = { group: "dept", mode: "liste", sec: "ind", hubMode: "maj", tdbPre: "", mois: "2026-10", prod: "", ret: null, rnew: false, rnat: "tous", renv: "tous", rarch: false };

/* ---------- Menu, fil d'Ariane, retour ---------- */
var MENU = [["portefeuille", "Portefeuille"], ["stats", "Statistiques"], ["revue", "Revue mensuelle"], ["ressources", "Ressources"]];
function renderMenu(route) {
  var top = route.split("-")[0];
  var ini = function (l) { var m = l.replace(/[^A-Za-zÀ-ÿ ]/g, "").split(" ").filter(Boolean); return (m.length > 1 ? m[0][0] + m[1][0] : l.replace(/[^A-Za-zÀ-ÿ]/g, "").slice(0, 2)).toUpperCase(); };
  var li = function (h, l, on) { return '<li class="fr-sidemenu__item' + (on ? " fr-sidemenu__item--active" : "") + '"><a class="fr-sidemenu__link" href="#' + h + '" data-ini="' + esc(ini(l)) + '" title="' + esc(l) + '"' + (on ? ' aria-current="page"' : "") + '><span class="dop-lbl">' + esc(l) + '</span></a></li>'; };
  $("menu").innerHTML = MENU.map(function (m) { return li(m[0], m[1], top === m[0]); }).join("") +
    Object.keys(DEPTS).map(function (d) {
      return '<li class="fr-sidemenu__item"><p class="fr-sidemenu__title fr-mt-2w fr-mb-1w dop-menu-dept" style="--grp-bar:var(--background-action-high-' + DEPTS[d] + ')"><span class="dop-lbl">' + d + '</span></p><ul class="fr-sidemenu__list">' +
        PRODUITS.filter(function (p) { return p.dept === d; }).map(function (p) { return li("produit-" + p.id, p.nom, route === "produit-" + p.id); }).join("") + '</ul></li>';
    }).join("");
}
function renderFil(items) {
  $("fil").innerHTML = '<li><a class="fr-breadcrumb__link" href="#portefeuille">Data Ops</a></li>' + items.map(function (it, i) {
    var last = i === items.length - 1;
    return '<li><a class="fr-breadcrumb__link"' + (last ? ' aria-current="page"' : ' href="#' + it[1] + '"') + '>' + esc(it[0]) + '</a></li>';
  }).join("");
  state.parent = items.length > 1 ? items[items.length - 2][1] : "";
  $("back").hidden = !state.parent;
  document.title = (items.length ? items[items.length - 1][0] + " · " : "") + "Data Ops";
}
var seg = function (name, val, opts) { return '<fieldset class="fr-segmented fr-segmented--sm"><legend class="fr-segmented__legend fr-sr-only">' + name + '</legend><div class="fr-segmented__elements">' + opts.map(function (o) { return '<div class="fr-segmented__element"><input value="' + o[0] + '" type="radio" id="' + name + '-' + o[0] + '" name="' + name + '" ' + (val === o[0] ? "checked" : "") + '><label class="fr-label" for="' + name + '-' + o[0] + '">' + o[1] + '</label></div>'; }).join("") + '</div></fieldset>'; };

/* ---------- Portefeuille ---------- */
function vPortefeuille() {
  var nb = function (k) { return PRODUITS.filter(function (p) { return p.statut === k; }).length; };
  var head = '<div class="fr-grid-row fr-grid-row--middle" style="justify-content:space-between;gap:1rem"><div><h1 class="fr-h2 fr-mb-1v">Portefeuille</h1><p class="dop-sub fr-mb-0 dop-num">' + PRODUITS.length + ' produits suivis · ' + nb("actif") + ' actifs · ' + nb("pause") + ' en pause</p></div>' +
    '<div class="fr-grid-row" style="gap:.75rem">' + seg("mode", state.mode, [["liste", "Liste"], ["kanban", "Kanban"]]) + '<span class="' + (state.mode === "liste" ? "" : "dop-invisible") + '" aria-hidden="' + (state.mode !== "liste") + '">' + seg("grp", state.group, [["dept", "Département"], ["etape", "Étape"]]) + '</span>' + '</div></div>' +
    '<p class="fr-sr-only" id="pf-live" aria-live="polite"></p>';
  var pause = function (p) { return p.statut !== "actif" ? ' <span class="fr-text--xs dop-sub">' + STATUTS[p.statut][1].toLowerCase() + '</span>' : ""; };
  if (state.mode === "kanban") {
    return head + '<p class="fr-text--sm dop-sub fr-mb-0">Glissez une carte vers une autre colonne, ou utilisez ses flèches, pour changer l\'étape. Chaque changement est daté dans le journal du produit. Réservé aux éditeurs du doc.</p><div class="dop-kanban">' + ETAPES.map(function (e, i) {
      var ps = PRODUITS.filter(function (p) { return cur(p.step) === i; });
      return '<div class="dop-col" data-drop="' + i + '" style="' + vars(e[2]) + '"><h2>' + e[0] + '<span class="dop-num">' + ps.length + '</span></h2>' + ps.map(function (p) {
        var a = prochaineAction(p);
        return '<div class="dop-kcard" draggable="true" data-drag="' + p.id + '"><a href="#produit-' + p.id + '">' + esc(p.nom) + '</a><span class="fr-text--xs fr-mb-0 dop-sub">' + p.dept + pause(p) + '</span>' +
          (a && echue(a[4]) ? '<span class="fr-text--xs fr-mb-0 dop-late">Action en retard</span>' : "") +
          '<span class="dop-move">' + (i > 0 ? '<button type="button" class="fr-btn fr-btn--tertiary-no-outline fr-btn--sm" data-move="' + p.id + '" data-to="' + (i - 1) + '" aria-label="Reculer ' + esc(p.nom) + ' à l\'étape ' + ETAPES[i - 1][0] + '">←</button>' : "<span></span>") +
          (i < 5 ? '<button type="button" class="fr-btn fr-btn--tertiary-no-outline fr-btn--sm" data-move="' + p.id + '" data-to="' + (i + 1) + '" aria-label="Avancer ' + esc(p.nom) + ' à l\'étape ' + ETAPES[i + 1][0] + '">→</button>' : "") + '</span></div>';
      }).join("") + '</div>';
    }).join("") + '</div>';
  }
  var byDept = state.group === "dept";
  var groups = byDept ? Object.keys(DEPTS) : [5, 4, 3, 2, 1, 0];
  var key = function (p) { return byDept ? p.dept : cur(p.step); };
  var etapeSelect = function (p) {
    var c = cur(p.step);
    return '<select class="fr-select dop-etape" id="etape-' + p.id + '" data-etape="' + p.id + '" aria-label="Étape de ' + esc(p.nom) + '" style="box-shadow:inset 4px 0 0 var(--background-action-high-' + ETAPES[c][2] + ')">' + ETAPES.map(function (e, i) { return '<option value="' + i + '"' + (i === c ? " selected" : "") + '>' + e[0] + '</option>'; }).join("") + '</select>';
  };
  var rows = groups.filter(function (g) { return PRODUITS.some(function (p) { return key(p) === g; }); }).map(function (g) {
    var ps = PRODUITS.filter(function (p) { return key(p) === g; }).sort(function (a, b) { return b.step - a.step; });
    return '<tr class="dop-grp" style="' + vars(byDept ? DEPTS[g] : ETAPES[g][2]) + '"><td colspan="4">' + (byDept ? "Département " + g : ETAPES[g][0]) + ' · ' + ps.length + '</td></tr>' + ps.map(function (p) {
      var tdb = p.envs.filter(function (e) { return e[2]; })[0];
      return '<tr><td><a class="fr-link" href="#produit-' + p.id + '"><b>' + esc(p.nom) + '</b></a>' + pause(p) + (byDept ? "" : '<br><span class="fr-text--xs dop-sub">' + p.dept + '</span>') + '</td><td>' + etapeSelect(p) + '</td><td>' + actionHtml(prochaineAction(p)) + '</td><td>' + (tdb ? '<a class="fr-link fr-link--sm" href="' + tdb[2] + '" target="_blank" rel="noopener">' + esc(tdb[1]) + '</a>' : '<span class="dop-sub">·</span>') + '</td></tr>';
    }).join("");
  }).join("");
  return head + '<div class="fr-table fr-table--no-caption dop-table-wrap"><table><caption>Portefeuille</caption><thead><tr><th scope="col">Produit</th><th scope="col">Étape</th><th scope="col">Prochaine action</th><th scope="col">Tableau de bord</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}
/* Changer l'étape d'un produit : dans Grist, une mise à jour de la colonne Étape de la table Produits, datée */
function changerEtape(id, etapeEnCours) {
  var p = prodBy(id); if (!p) return;
  if (cur(p.step) === etapeEnCours && !(etapeEnCours === 5 && p.step < 5)) return;
  var msg = function () { var live = $("pf-live"); if (live) live.textContent = p.nom + " passe à l'étape " + ETAPES[etapeEnCours][0] + "."; };
  if (GRIST) return ecrire([["UpdateRecord", "Produits", p.rid, { Etape: ETAPES[etapeEnCours][0], MEP_faite: etapeEnCours === 5, Etape_depuis: maintenant() }],
    ["AddRecord", "Journal", null, { Produit: p.rid, Date: maintenant(), Type: "Étape", Contenu: "Passage à l'étape " + ETAPES[etapeEnCours][0] }]], msg);
  p.step = etapeEnCours === 5 ? 5 : etapeEnCours - 1; p.depuis = jour();
  p.journal.unshift([jour(), "Étape", "Passage à l'étape " + ETAPES[etapeEnCours][0], "", ""]);
  route(true); msg();
}

/* ---------- Statistiques ---------- */
function vStats() {
  var bars = function (items, max) { return '<div class="dop-bars">' + items.map(function (it) { return '<div class="dop-bar" style="' + (it[2] ? vars(it[2]) : "") + '"><span>' + esc(it[0]) + '</span><span class="t"><b style="width:' + (max ? Math.round(it[1] / max * 100) : 0) + '%"></b></span><span class="n">' + it[1] + '</span></div>'; }).join("") + '</div>'; };
  var parEtape = ETAPES.map(function (e, i) { return [e[0], PRODUITS.filter(function (p) { return cur(p.step) === i; }).length, e[2]]; });
  var enProd = PRODUITS.filter(function (p) { return p.step >= 5; }).length;
  var enProdAout = INSTANTANE_AOUT.filter(function (x) { return x.etape === "autonomie" && !x.recap; }).length;
  var actionsRetard = PRODUITS.reduce(function (a, p) { return a + p.journal.filter(function (j) { return ouverteA(j) && echue(j[4]); }).length; }, 0);
  var liv = (window.LIVRABLES || []).filter(function (l) { return !l.old; });
  var tile = function (v, l, d, c) { return '<div class="dop-tile" style="' + vars(c) + '"><div class="v">' + v + '</div><div class="l">' + l + '</div>' + (d ? '<div class="d">' + d + '</div>' : "") + '</div>'; };
  var delta = enProd - enProdAout;
  return '<div><h1 class="fr-h2 fr-mb-1v">Statistiques</h1><p class="dop-sub fr-mb-0">Calculées depuis les tables du doc. Écarts mesurés depuis la revue de juillet-août.</p></div>' +
    '<div class="dop-tiles">' + tile(PRODUITS.length, "produits suivis", "sur " + (PRODUITS.length + AUTRES_PRODUITS) + " au studio", "blue-cumulus") +
    tile(enProd, "tableau de bord en prod", delta === 0 ? "stable depuis août" : (delta > 0 ? "+" : "") + delta + " depuis août", "green-menthe") +
    tile(RETOURS.filter(ouvert).length, "retours ouverts", RETOURS.length + " reçus au total", "pink-macaron") +
    tile(actionsRetard, "actions en retard", "échéance dépassée au 02/10", "orange-terre-battue") + '</div>' +
    '<div><h2 class="fr-h5">Où en sont les produits</h2><div class="dop-stack">' + parEtape.filter(function (x) { return x[1]; }).map(function (x) { return '<span style="flex:' + x[1] + ';background:var(--background-action-high-' + x[2] + ')" title="' + x[0] + ' : ' + x[1] + '">' + x[1] + '</span>'; }).join("") + '</div>' +
    '<div class="dop-stack-leg">' + parEtape.map(function (x) { return '<span><i style="background:var(--background-action-high-' + x[2] + ')"></i>' + x[0] + ' ' + x[1] + '</span>'; }).join("") + '</div></div>' +
    '<div class="fr-grid-row fr-grid-row--gutters"><div class="fr-col-12 fr-col-lg-6"><h2 class="fr-h5">Par département</h2>' + bars(Object.keys(DEPTS).map(function (d) { return [d, PRODUITS.filter(function (p) { return p.dept === d; }).length, DEPTS[d]]; }), PRODUITS.length) +
    '<h2 class="fr-h5 fr-mt-3w">Produits qui mesurent chaque pilier</h2>' + bars(PIL.map(function (n, i) { return [n, PRODUITS.filter(function (p) { return p.m[i] === "ok"; }).length, "green-menthe"]; }), PRODUITS.length) + '</div>' +
    '<div class="fr-col-12 fr-col-lg-6"><h2 class="fr-h5">Livrables par temps de l\'accompagnement</h2>' + bars(TEMPS.map(function (t, i) { return [t[0], liv.filter(function (l) { return t[1].indexOf(l.type) >= 0; }).length, ["purple-glycine", "orange-terre-battue", "green-menthe", "blue-cumulus"][i]]; }), liv.length) +
    '<h2 class="fr-h5 fr-mt-3w">Retours par statut</h2>' + bars(Object.keys(RST).map(function (k, i) { return [RST[k][1], RETOURS.filter(function (r) { return r.st === k; }).length, ["pink-macaron", "purple-glycine", "blue-cumulus", "yellow-tournesol", "green-menthe", "beige-gris-galet"][i]]; }), RETOURS.length || 1) + '</div></div>';
}

/* ---------- Fiche produit ---------- */
var SECS = [["ind", "Indicateurs"], ["liv", "Livrables"], ["retours", "Retours"], ["journal", "Décisions et actions"]];
var aMigrer = function (l) { return !l.ap && (l.lieu === "Artifact" || l.lieu === "Local" || (!l.lien && l.lieu !== "Data Ops")); };
function livTitre(l) {
  var t = esc(l.titre);
  if (l.fichier) return '<a class="fr-link fr-link--sm" href="' + urlPieceJointe(l.fichier) + '" data-att="' + l.fichier + '" target="_blank" rel="noopener">' + t + '</a> ' + badge("fr-badge--green-menthe", "Fichier");
  if (l.ap) return '<button class="dop-link-btn" type="button" data-ap="' + l.ap + '">' + t + '</button> ' + badge("fr-badge--blue-ecume", "Aperçu");
  if (aMigrer(l)) return t + " " + badge("fr-badge--warning", "À migrer");
  if (/^#/.test(l.lien)) return '<a class="fr-link fr-link--sm" href="' + l.lien + '">' + t + '</a>';
  return '<a class="fr-link fr-link--sm" href="' + l.lien + '" target="_blank" rel="noopener">' + t + '</a>';
}
function vProduit(id) {
  var p = prodBy(id); if (!p) return "<p>Produit introuvable.</p>";
  var rets = RETOURS.filter(function (r) { return r.p === id; });
  var tousLivs = (window.LIVRABLES || []).filter(function (l) { return l.p === id; });
  var nbAnciens = tousLivs.filter(function (l) { return l.old; }).length;
  var livs = tousLivs.filter(function (l) { return state.histo || !l.old; });
  var count = { ind: p.ind.length, liv: livs.length, retours: rets.filter(ouvert).length, journal: p.journal.length };
  var sec = state.sec, body = "";
  var empty = function (t) { return '<p class="dop-sub">' + t + '</p>'; };
  var table = function (cap, heads, rows) { return '<div class="fr-table fr-table--no-caption dop-table-wrap"><table><caption>' + cap + '</caption><thead><tr>' + heads.map(function (h) { return '<th scope="col">' + h + '</th>'; }).join("") + '</tr></thead><tbody>' + rows + '</tbody></table></div>'; };
  if (sec === "ind") {
    var v1 = p.ind.filter(function (r) { return r[3]; }).length, at = p.ind.filter(function (r) { return r[2]; }).length;
    body = p.ind.length ? '<div class="fr-grid-row fr-grid-row--middle" style="justify-content:space-between;gap:1rem"><p class="fr-mb-0 dop-num">' + at + ' retenus en atelier · ' + v1 + ' dans la V1 du tableau de bord</p>' +
      (p.figma ? '<a class="fr-btn fr-btn--tertiary fr-btn--sm" href="' + p.figma + '" target="_blank" rel="noopener">Board de l\'atelier</a>' : '<span class="fr-text--sm fr-mb-0 dop-sub">Lien du board d\'atelier à renseigner</span>') + '</div>' +
      table("Indicateurs", ["Indicateur", "Pilier", "Atelier", "V1", "Statut"], p.ind.map(function (r) {
        var ecart = r[2] !== r[3];
        return '<tr><td>' + esc(r[0]) + (ecart ? '<br><span class="fr-text--xs dop-sub">' + (r[2] ? "Retenu en atelier, absent de la V1" : "Ajouté après l'atelier") + '</span>' : "") + '</td><td>' + PIL[r[1]] + '</td><td>' + (r[2] ? "Oui" : "·") + '</td><td>' + (r[3] ? "Oui" : "·") + '</td><td>' + (r[4] === "ok" ? badge("fr-badge--success", "Mesuré") : r[4] === "wip" ? badge("fr-badge--warning", "En cours") : badge("", "À construire")) + '</td></tr>';
      }).join("")) : empty("Aucun indicateur retenu pour l'instant : ils arrivent avec l'atelier.");
  }
  if (sec === "liv") body = (nbAnciens ? '<div class="fr-toggle fr-toggle--label-left fr-mb-1w"><input type="checkbox" class="fr-toggle__input" id="histo"' + (state.histo ? " checked" : "") + '><label class="fr-toggle__label" for="histo">Afficher les ' + nbAnciens + ' versions précédentes</label></div>' : "") + (livs.length ? TEMPS.map(function (t) {
    var ls = livs.filter(function (l) { return t[1].indexOf(l.type) >= 0; });
    return ls.length ? '<h2 class="fr-h5 fr-mb-1w fr-mt-3w">' + t[0] + '</h2>' + table(t[0], ["Livrable", "Type", "Lieu", "Date"], ls.map(function (l) { return '<tr><td>' + livTitre(l) + (l.ex ? " " + badge("fr-badge--purple-glycine", "Exemple") : "") + (l.old ? " " + badge("", "Version précédente") : "") + '</td><td>' + esc(l.type) + '</td><td>' + esc(l.lieu) + '</td><td class="dop-num">' + esc(l.date) + '</td></tr>'; }).join("")) : "";
  }).join("") : empty("Aucun livrable rattaché."));
  if (sec === "retours") body = vRetours(p, rets);
  if (sec === "journal") {
    var lignes = p.journal.map(function (j, i) { return [j, i]; }).sort(function (x, y) { return (x[0][5] ? 1 : 0) - (y[0][5] ? 1 : 0); });
    body = table("Décisions et actions", ["Fait", "Date", "Type", "Contenu", "Qui", "Échéance"], lignes.map(function (l) {
      var j = l[0], i = l[1], act = j[1] === "Action";
      var box = act ? '<div class="fr-checkbox-group fr-checkbox-group--sm"><input type="checkbox" id="fait-' + i + '" data-fait="' + i + '"' + (j[5] ? " checked" : "") + '><label class="fr-label" for="fait-' + i + '"><span class="fr-sr-only">Action faite : ' + esc(j[2]) + '</span></label></div>' : "";
      return '<tr class="' + (j[5] ? "dop-done" : "") + '"><td>' + box + '</td><td class="dop-num">' + j[0] + '</td><td>' + (j[1] === "Décision" ? badge("fr-badge--blue-ecume", "Décision") : j[1] === "Étape" ? badge("", "Étape") : badge("fr-badge--purple-glycine", "Action")) + '</td><td>' + esc(j[2]) + (j[5] ? '<br><span class="fr-text--xs dop-sub">Fait le ' + j[5] + '</span>' : "") + '</td><td>' + esc(j[3]) + '</td><td class="' + (ouverteA(j) && echue(j[4]) ? "dop-late" : "") + '">' + esc(j[4]) + '</td></tr>';
    }).join("") || '<tr><td colspan="6">Rien pour l\'instant.</td></tr>') +
    '<form id="f-journal" class="fr-mt-3w" novalidate><h2 class="fr-h6">Ajouter une ligne</h2><div class="fr-grid-row fr-grid-row--gutters">' +
    '<div class="fr-col-12 fr-col-md-3"><div class="fr-select-group"><label class="fr-label" for="j-type">Type</label><select class="fr-select" id="j-type"><option>Action</option><option>Décision</option></select></div></div>' +
    '<div class="fr-col-12 fr-col-md-9"><div class="fr-input-group" id="g-j"><label class="fr-label" for="j-txt">Contenu</label><input class="fr-input" id="j-txt" type="text"><p class="fr-error-text" id="j-err" hidden>Écrivez le contenu de la ligne.</p></div></div>' +
    '<div class="fr-col-6 fr-col-md-3"><div class="fr-input-group"><label class="fr-label" for="j-qui">Qui</label><input class="fr-input" id="j-qui" type="text"></div></div>' +
    '<div class="fr-col-6 fr-col-md-3"><div class="fr-input-group"><label class="fr-label" for="j-ech">Échéance<span class="fr-hint-text">jj/mm</span></label><input class="fr-input" id="j-ech" type="text"></div></div>' +
    '<div class="fr-col-12 fr-col-md-6" style="display:flex;align-items:flex-end"><button class="fr-btn fr-btn--secondary" type="submit">Ajouter</button></div></div>' +
    '<p class="fr-text--sm dop-sub fr-mt-1w fr-mb-0">Dans Grist, c\'est une ligne de la table Journal, affichée sous ce widget et filtrée sur le produit.</p></form>';
  }

  var a = prochaineAction(p), d = p.journal.filter(function (j) { return j[1] === "Décision"; })[0];
  var c = cur(p.step), envs = p.envs.filter(function (e) { return e[2]; });
  var btns = envs.map(function (e, i) { return '<li><a class="fr-btn fr-btn--sm' + (i ? " fr-btn--secondary" : "") + '" href="' + e[2] + '" target="_blank" rel="noopener" title="' + esc(e[3]) + '">' + esc(e[1]) + '</a></li>'; }).join("") +
    (envs.length ? '<li><button class="fr-btn fr-btn--sm fr-btn--tertiary" type="button" data-retour="' + esc(envs[0][0]) + '">Faire un retour</button></li>' : "");
  return '<div class="dop-head"><div class="fr-grid-row fr-grid-row--middle" style="gap:.75rem;justify-content:space-between"><div class="fr-grid-row fr-grid-row--middle" style="gap:.75rem"><h1 class="fr-h2 fr-mb-0">' + esc(p.nom) + '</h1>' + deptBadge(p.dept) + '<select class="fr-select dop-statut" data-statut="' + p.id + '" aria-label="Statut de ' + esc(p.nom) + '">' + Object.keys(STATUTS).map(function (k) { return '<option value="' + k + '"' + (k === p.statut ? " selected" : "") + '>' + STATUTS[k][1] + '</option>'; }).join("") + '</select></div>' +
    (btns ? '<ul class="fr-btns-group fr-btns-group--inline-sm fr-btns-group--sm">' + btns + '</ul>' : '<span class="fr-text--sm fr-mb-0 dop-sub">Pas encore de tableau de bord</span>') + '</div>' +
    '<p class="dop-meta fr-mb-0"><span>' + esc(p.pm) + (p.coach ? " · coach " + esc(p.coach) : "") + '</span>' + (envs.length ? '<span>' + esc(envs[0][3]) + '</span>' : "") + '<a class="fr-link fr-link--sm" href="https://grist.numerique.gouv.fr/o/studio/nei9DeARs5Eo/Pilotage-studio-V2" target="_blank" rel="noopener">Fiche Pilotage studio</a></p>' +
    '<div class="fr-stepper"><h2 class="fr-stepper__title">' + ETAPES[c][0] + '<span class="fr-stepper__state">Étape ' + (c + 1) + ' sur 6 · ' + (p.step >= 5 ? "franchie" : "livrable attendu : " + ETAPES[c][1]) + (p.depuis ? " · depuis le " + p.depuis : "") + '</span></h2><div class="fr-stepper__steps" data-fr-current-step="' + (c + 1) + '" data-fr-steps="6"></div>' + (c < 5 ? '<p class="fr-stepper__details"><span class="fr-text--bold">Étape suivante :</span> ' + ETAPES[c + 1][0] + '</p>' : "") + '</div></div>' +
    '<div class="dop-follow"><div><span class="dop-k">Prochaine action</span>' + (a ? '<b>' + esc(a[2]) + '</b><span class="fr-text--sm fr-mb-0 ' + (echue(a[4]) ? "dop-late" : "dop-sub") + '">' + esc(a[3]) + (a[4] ? " · " + (echue(a[4]) ? "en retard, " : "") + esc(a[4]) : "") + '</span>' : '<span class="dop-sub">Aucune action en attente</span>') + '</div>' +
    '<div><span class="dop-k">Dernière décision</span>' + (d ? '<b>' + esc(d[2]) + '</b><span class="fr-text--sm fr-mb-0 dop-sub">' + esc(d[3]) + " · " + d[0] + '</span>' : '<span class="dop-sub">Aucune pour l\'instant</span>') + '</div></div>' +
    '<div class="dop-wrap-seg">' + seg("sec", sec, SECS.map(function (s) { return [s[0], s[1] + " (" + count[s[0]] + ")"]; })) + '</div>' + body;
}

/* ---------- Retours : kanban par statut, détail pleine page, formulaire ---------- */
var natBadge = function (r) { var n = NAT[r.nat] || NAT.aff; return badge(n[1], n[0]); };
var ENVS_COURTS = { "Production": "Prod", "Préproduction": "Préprod", "Démo": "Démo" };
function vRetours(p, rets) {
  if (state.rnew) return vRetourForm(p);
  var r0 = state.ret != null && rets.filter(function (r) { return r.key === state.ret; })[0];
  if (r0) return vRetourDetail(p, r0);
  var nArch = rets.filter(function (r) { return r.arch; }).length;
  var vis = rets.filter(function (r) { return (state.rnat === "tous" || r.nat === state.rnat) && (state.renv === "tous" || r.tdb === state.renv) && (state.rarch || !r.arch); });
  var chip = function (k, l) { return '<button type="button" class="dop-chip" data-rnat="' + k + '" aria-pressed="' + (state.rnat === k) + '">' + esc(l) + '</button>'; };
  var envOpts = ["tous"].concat(Object.keys(ENVS_COURTS)).map(function (e) { return '<option value="' + e + '"' + (state.renv === e ? " selected" : "") + '>' + (e === "tous" ? "Tous" : esc(e)) + '</option>'; }).join("");
  var carte = function (r) {
    return '<button type="button" class="dop-card' + (r.arch ? " dop-card--arch" : "") + '" data-ret="' + r.key + '"><span class="dop-card-top">' + natBadge(r) + (r.pri ? badge("fr-badge--warning", "Priorité haute") : "") + (r.ver ? badge("fr-badge--success", r.ver) : "") + (r.no ? '<span class="dop-card-no">n° ' + r.no + '</span>' : "") + '</span>' +
      '<span class="dop-card-tx">' + esc(r.txt) + '</span>' +
      '<span class="dop-card-ft"><b>' + esc(ENVS_COURTS[r.tdb] || r.tdb || "·") + '</b>' + (r.ong ? '<span>' + esc(r.ong) + '</span>' : "") + '<span>' + esc(r.qui.split(" (")[0]) + ' · ' + r.quand + '</span>' + (r.imgs ? '<span>📎 ' + r.imgs + '</span>' : "") + (r.arch ? '<span>Archivé le ' + r.arch + '</span>' : "") + '</span></button>';
  };
  var cols = Object.keys(RST).map(function (k) {
    var cs = vis.filter(function (r) { return r.st === k; });
    return '<div class="dop-col"><h3 class="dop-col-h"><span>' + RST[k][1] + '</span><span class="dop-col-n">' + cs.length + '</span></h3>' + (cs.length ? cs.map(carte).join("") : '<p class="dop-sub fr-text--xs fr-mb-0">Aucun retour</p>') + '</div>';
  }).join("");
  return '<div class="dop-kt"><div class="dop-chips" role="group" aria-label="Nature">' + chip("tous", "Toutes natures") + Object.keys(NAT).map(function (k) { return chip(k, NAT[k][0]); }).join("") + '</div>' +
    '<label class="dop-kt-l" for="r-env">Tableau <select class="fr-select dop-kt-sel" id="r-env">' + envOpts + '</select></label>' +
    '<div class="fr-toggle fr-toggle--label-left dop-kt-tog"><input type="checkbox" class="fr-toggle__input" id="r-arch"' + (state.rarch ? " checked" : "") + '><label class="fr-toggle__label" for="r-arch">Afficher les archivés (' + nArch + ')</label></div>' +
    '<button type="button" class="fr-btn fr-btn--sm dop-kt-new" id="r-new">+ Nouveau retour</button></div>' +
    '<div class="dop-kscroll"><div class="dop-kb">' + cols + '</div></div>';
}
function vRetourDetail(p, r) {
  var ctx = [["Produit", p.nom], ["Tableau", r.tdb || "·"], ["Onglet", r.ong || "·"], ["Période", r.per || "·"], ["Segment", r.seg || "·"], ["Version du tableau", r.vtdb || "·"]];
  var caps = (r.caps || []).map(function (id, i) { return '<a class="dop-shot" data-att="' + id + '" href="#" target="_blank" rel="noopener">Capture ' + (i + 1) + '</a>'; }).join("") ||
    (r.imgs ? new Array(r.imgs + 1).join('<span class="dop-shot">capture</span>') : "");
  var hist = (r.hist || []).map(function (h) { return '<li>' + esc(h[0]) + '<span class="dop-sub fr-text--xs">' + esc(h[1]) + '</span></li>'; }).join("") + (r.arch ? '<li>Archivé<span class="dop-sub fr-text--xs">' + r.arch + '</span></li>' : "");
  var opts = Object.keys(RST).map(function (k) { return '<option value="' + k + '"' + (r.st === k ? " selected" : "") + '>' + RST[k][1] + '</option>'; }).join("");
  return '<button type="button" class="dop-back-k" id="r-back">← Retour au kanban</button>' +
    '<div class="dop-dt"><div class="dop-dt-main"><div class="dop-card-top">' + natBadge(r) + (r.pri ? badge("fr-badge--warning", "Priorité haute") : "") + badge(RST[r.st][0], RST[r.st][1] + (r.ver ? " · " + r.ver : "")) + (r.arch ? badge("", "Archivé le " + r.arch) : "") + (r.no ? '<span class="dop-card-no">n° ' + r.no + '</span>' : "") + '</div>' +
    '<h2 class="fr-h4 fr-mt-1w">' + esc(r.txt) + '</h2>' +
    '<div class="dop-box"><p class="dop-k">Contexte</p><div class="dop-ctx">' + ctx.map(function (c) { return '<div><span class="dop-sub fr-text--xs">' + c[0] + '</span><b>' + esc(c[1]) + '</b></div>'; }).join("") + '</div></div>' +
    '<div class="dop-box"><p class="dop-k">Constat</p><p class="fr-mb-0">' + esc(r.txt) + '</p><p class="fr-text--xs dop-sub fr-mb-0 fr-mt-1w">' + esc(r.qui) + ' · ' + r.quand + '</p></div>' +
    (caps ? '<div class="dop-box"><p class="dop-k">Captures</p><div class="dop-thumbs">' + caps + '</div></div>' : "") +
    '<div class="dop-box"><p class="dop-k">Analyse Data Ops</p><p class="fr-mb-0">' + esc(r.an || "Pas encore analysé.") + '</p></div>' +
    '<div class="dop-box"><p class="dop-k">Réponse proposée</p><p class="fr-mb-1w">' + esc(r.rep || "À rédiger.") + '</p><p class="fr-text--sm fr-mb-0"><span class="dop-sub">Qui :</span> ' + esc(r.resp || "·") + ' · <span class="dop-sub">Effort :</span> ' + esc(r.eff || "·") + '</p></div></div>' +
    '<div class="dop-dt-side"><div class="dop-box"><p class="dop-k">Actions</p>' +
    '<div class="fr-select-group"><label class="fr-label" for="r-st">Statut</label><select class="fr-select" id="r-st">' + opts + '</select></div>' +
    '<div class="fr-input-group" id="g-ver"' + (r.st === "livre" ? "" : " hidden") + '><label class="fr-label" for="r-ver">Livré dans<span class="fr-hint-text">Version du tableau, ex. v1.3</span></label><input class="fr-input" id="r-ver" type="text" value="' + esc(r.ver || "") + '"></div>' +
    '<ul class="fr-btns-group fr-btns-group--sm"><li><button type="button" class="fr-btn fr-btn--sm" id="r-save">Enregistrer le statut</button></li><li><button type="button" class="fr-btn fr-btn--sm fr-btn--secondary" id="r-archiver">' + (r.arch ? "Désarchiver" : "Archiver") + '</button></li></ul>' +
    '<p class="fr-text--xs dop-sub fr-mb-0" id="r-msg" role="status"></p></div>' +
    '<div class="dop-box"><p class="dop-k">Historique</p><ul class="dop-tl">' + (hist || '<li>Nouveau<span class="dop-sub fr-text--xs">' + r.quand + '</span></li>') + '</ul></div></div></div>';
}
function vRetourForm(p) {
  var tdbs = p.envs.filter(function (e) { return e[2]; }).map(function (e) { return '<option' + (e[0] === state.tdbPre ? " selected" : "") + '>' + esc(e[0]) + '</option>'; }).join("") || '<option>Tableau de bord à venir</option>';
  return '<button type="button" class="dop-back-k" id="r-back">← Retour au kanban</button>' +
    '<form id="f-retour" class="fr-p-3w fr-mt-1w dop-form" style="border:1px solid var(--border-default-grey)" novalidate><p class="dop-k fr-mb-1v">Nouveau retour · ' + esc(p.nom) + '</p><h2 class="fr-h5">Faire un retour sur le tableau de bord</h2>' +
    '<div class="fr-select-group"><label class="fr-label" for="r-tdb">Tableau de bord concerné</label><select class="fr-select" id="r-tdb">' + tdbs + '</select></div>' +
    '<div class="fr-select-group"><label class="fr-label" for="r-type">Nature du retour</label><select class="fr-select" id="r-type">' + Object.keys(NAT).map(function (k) { return '<option>' + NAT[k][0] + '</option>'; }).join("") + '</select></div>' +
    '<div class="fr-input-group" id="g-txt"><label class="fr-label" for="r-txt">Constat<span class="fr-hint-text">Quel chiffre, à quel endroit, et la valeur attendue</span></label><textarea class="fr-input" id="r-txt" rows="4"></textarea><p class="fr-error-text" id="r-err" hidden>Décrivez le retour en une phrase au moins.</p></div>' +
    '<div class="fr-upload-group fr-mb-1w"><label class="fr-label" for="r-img">Captures d\'écran<span class="fr-hint-text">Formats png ou jpg, plusieurs fichiers possibles</span></label><input class="fr-upload" type="file" id="r-img" accept="image/*" multiple></div>' +
    '<p class="fr-text--xs fr-mb-3w dop-warn">Masquez toute donnée personnelle (adresse, nom) sur les captures avant d\'envoyer.</p>' +
    '<div class="fr-input-group"><label class="fr-label" for="r-qui">Votre nom ou e-mail<span class="fr-hint-text">Facultatif, pour qu\'on puisse vous recontacter</span></label><input class="fr-input" id="r-qui" type="text"></div>' +
    '<button class="fr-btn" type="submit">Envoyer le retour</button><p class="fr-text--sm fr-mt-2w fr-mb-0" id="r-ok" role="status"></p></form>';
}
/* Écrit un changement de statut ou d'archivage et l'ajoute à l'historique du retour */
function majRetour(r, champs, ligneHisto) {
  var hist = (r.hist || []).concat(ligneHisto ? [ligneHisto] : []);
  if (GRIST) { champs.Historique = hist.map(function (h) { return h[0] + "|" + h[1]; }).join("\n"); return ecrire([["UpdateRecord", "Retours", r.rid, champs]]); }
  r.hist = hist; if ("Statut" in champs) r.st = RSTK[champs.Statut]; if ("Livre_dans" in champs) r.ver = champs.Livre_dans; if ("Archive_le" in champs) r.arch = champs.Archive_le ? jour() : null;
  route(true);
}

/* ---------- Revue mensuelle : une mise à jour par mois de cartes, l'historique publié reste figé ---------- */
function construireMaj(mois) {
  var on = function (k) { return CARTES.filter(function (c) { return c.mois === mois && c.k === k && c.on; }); };
  var norm = function (s) { return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase(); };
  var avant = {}; INSTANTANE_AOUT.forEach(function (x) { avant[norm(x.nom)] = x.etape; });
  var enProd = PRODUITS.filter(function (p) { return p.step >= 5; });
  var v1 = PRODUITS.filter(function (p) { return p.step >= 2; });
  var reels = PRODUITS.filter(function (p) { return p.envs.some(function (e) { return (e[0] === "Production" || e[0] === "Préproduction") && e[2]; }); });
  return {
    id: mois, titre: MOIS[mois][0], date: MOIS[mois][1], brouillon: true, mois: mois,
    slides: [
      { type: "intro", titre: "Contexte du mois", sousTitre: MOIS[mois][0] + " : " + MOIS[mois][2], sections: on("ctx").map(function (c) { return { titre: c.t, texte: c.d }; }),
        chiffres: [{ valeur: String(enProd.length), label: "tableau de bord en prod", detail: enProd.map(function (p) { return p.nom; }).join(", ") },
          { valeur: String(reels.length), label: "tableaux de bord sur données réelles", detail: reels.map(function (p) { return p.nom; }).join(" et ") },
          { valeur: String(v1.length), label: "produits avec une V1", detail: v1.map(function (p) { return p.nom; }).join(", ") },
          { valeur: PRODUITS.length + " / " + (PRODUITS.length + AUTRES_PRODUITS), label: "produits suivis", detail: AUTRES_PRODUITS + " sans étape data" }] },
      { type: "accomplissements", titre: "Accomplissements du mois", sousTitre: "Les jalons de la démarche", items: on("acc").map(function (c) { return { cat: c.cat, titre: c.t, texte: c.d }; }) },
      { type: "recap", titre: "Avancées produits", sousTitre: "Ce qui a bougé, produit par produit", items: PRODUITS.filter(function (p) { return p.statut !== "pause"; }).map(function (p) {
        var c = couloir(p.step), a = avant[norm(p.nom)];
        return { produit: p.nom, etape: c, avancee: p.avancee, avance: !!a && COULOIRS.indexOf(c) > COULOIRS.indexOf(a) };
      }) },
      { type: "problems", titre: "Problématiques rencontrées", sousTitre: "Les points durs de la période, numérotés", items: on("frein").map(function (c) { return { cat: c.cat, titre: c.t, probleme: c.d, solution: c.r }; }) },
      { type: "solutions", titre: "Ce qu'on fait de ces points durs", sousTitre: "Une réponse par point dur, même numéro" },
      { type: "trajectoire", titre: "La trajectoire", sousTitre: "D'où l'on vient, où l'on est, ce qui vient ensuite",
        jalons: TRAJECTOIRE.map(function (j) { return { periode: j[0], texte: j[1], ici: j[0] === MOIS[mois][0].split(" ")[0] }; }),
        courbes: [{ titre: "Produits suivis", note: "périmètre recentré en septembre sur les produits accompagnés", points: COURBES_AOUT.equipes.map(function (x) { return { mois: x[0], valeur: x[1] }; }).concat([{ mois: MOIS[mois][0].slice(0, 4), valeur: PRODUITS.length, ici: true }]) },
          { titre: "Tableaux de bord sur données réelles", note: "préprod ou production, hors prototypes", points: COURBES_AOUT.tdb.map(function (x) { return { mois: x[0], valeur: x[1] }; }).concat([{ mois: MOIS[mois][0].slice(0, 4), valeur: reels.length, ici: true }]) }] },
      { type: "next", titre: "Prochaines étapes et prochains produits", sousTitre: "Ce qui vient le mois prochain", colonnes: COLS_NEXT.map(function (t, i) { return { titre: t, items: on("next").filter(function (c) { return c.col === i; }).map(function (c) { return c.t; }) }; }),
        echeances: on("ech").map(function (c) { return { date: c.d, quoi: c.t }; }) },
      { type: "roadmap", titre: "La course des produits", sousTitre: "Chaque produit sur son étape data" }
    ]
  };
}
/* Validée = figée : on photographie les slides et la course, les cartes et le portefeuille ne la modifient plus */
var FIGEES = {};
var copie = function (o) { return JSON.parse(JSON.stringify(o)); };
function majs() {
  H.updates = H.updates.filter(function (u) { return !u.mois && u.id !== "2026-09" && !FIGEES[u.id]; });
  Object.keys(MOIS).forEach(function (m) {
    if (FIGEES[m]) H.updates.push(FIGEES[m].maj);
    else if (CARTES.some(function (c) { return c.mois === m && c.on; })) H.updates.push(construireMaj(m));
  });
}
function changerStatutMaj(id, valide) {
  var u = H.updates.filter(function (x) { return x.id === id; })[0]; if (!u) return;
  if (GRIST) {
    var r = REVUES[id], prods = produitsCourse(u), revoir = function () { H.produits = produitsCourse(H.updates.filter(function (x) { return x.id === id; })[0]); window.HUB_GARDER = true; window.HUB.deck(); window.HUB_GARDER = false; $("statut-maj").value = valide ? "valide" : "brouillon"; };
    if (!r) return;
    if (valide) { var f = copie(u); f.brouillon = false;
      return ecrire([["UpdateRecord", "Revues", r.id, { Statut: "Validé", Valide_le: maintenant(), Contenu: JSON.stringify(f) }],
        ["BulkAddRecord", "Instantanes", prods.map(function () { return null; }), { Revue: prods.map(function () { return r.id; }), Produit: prods.map(function (x) { return x.nom; }), Departement: prods.map(function (x) { return x.dept || ""; }), Couloir: prods.map(function (x) { return x.etape; }), A_change: prods.map(function (x) { return !!x.avance; }), Recap: prods.map(function (x) { return !!x.recap; }) }]], revoir); }
    var anciens = (INSTANTANES[id] || []).map(function (x) { return x.rid; });
    return ecrire([["UpdateRecord", "Revues", r.id, { Statut: "Brouillon", Valide_le: null, Contenu: "" }]].concat(anciens.length ? [["BulkRemoveRecord", "Instantanes", anciens]] : []), revoir);
  }
  if (u.mois) {
    if (valide) { var f = copie(u); f.brouillon = false; FIGEES[id] = { maj: f, produits: produitsCourse(u) }; }
    else delete FIGEES[id];
  } else u.brouillon = !valide;
  majs(); window.HUB.accueil();
  H.produits = produitsCourse(H.updates.filter(function (x) { return x.id === id; })[0]);
  window.HUB_GARDER = true; window.HUB.deck(); window.HUB_GARDER = false;
  $("statut-maj").value = valide ? "valide" : "brouillon";
  document.title = u.titre + " · Data Ops";
}
/* La course lit l'instantané de la revue : figé pour une revue publiée, le portefeuille du jour pour un brouillon */
function produitsCourse(u) {
  if (u && FIGEES[u.id]) return FIGEES[u.id].produits;
  if (!u || !u.mois) return INSTANTANE_AOUT;
  var recap = u.slides.filter(function (s) { return s.type === "recap"; })[0].items;
  return PRODUITS.map(function (p) { var r = recap.filter(function (x) { return x.produit === p.nom; })[0]; return { nom: p.nom, etape: couloir(p.step), dept: p.dept, avance: !!(r && r.avance) }; })
    .concat([{ nom: AUTRES_PRODUITS + " autres produits sans étape data", etape: "prochainement", recap: true }]);
}
function renderCartes() {
  var cs = CARTES.filter(function (c) { return c.mois === state.mois; });
  var fige = !!FIGEES[state.mois];
  $("cartes").innerHTML = '<div class="fr-grid-row fr-grid-row--middle" style="justify-content:space-between;gap:1rem">' +
    '<div class="fr-select-group fr-mb-0"><label class="fr-label" for="c-mois">Mois</label><select class="fr-select" id="c-mois">' + Object.keys(MOIS).map(function (m) { return '<option value="' + m + '"' + (m === state.mois ? " selected" : "") + '>' + MOIS[m][0] + '</option>'; }).join("") + '</select></div>' +
    '<p class="fr-mb-0 dop-sub dop-num">' + cs.filter(function (c) { return c.on; }).length + ' cartes retenues sur ' + cs.length + ' · <a href="#revue-' + state.mois + '">Voir la mise à jour</a></p></div>' +
    (fige ? '<div class="fr-alert fr-alert--info fr-alert--sm fr-mt-2w"><p>Mise à jour validée : elle est figée, les cartes ne la modifient plus. Repassez-la en brouillon pour la retoucher.</p></div>' : "") + '<p class="fr-text--sm dop-sub fr-mt-2w">Chacun dépose ses cartes dans la table Cartes, avec le mois. Les chiffres et la course se calculent depuis le portefeuille.</p>' +
    '<div class="dop-bank dop-bank-5">' + Object.keys(KINDS).map(function (k) {
      return '<div class="dop-bank-col"><h2 class="fr-h6 fr-mb-1w">' + KINDS[k] + '</h2>' + CARTES.map(function (c, i) {
        if (c.k !== k || c.mois !== state.mois) return "";
        return '<div class="dop-card-pick' + (c.on ? " on" : "") + '">' + (c.cat ? '<p class="fr-text--xs fr-mb-0 dop-sub">' + c.cat + ' · ' + esc(c.prod) + '</p>' : "") + '<b>' + esc(c.t) + '</b>' + (c.d ? '<span class="fr-text--sm fr-mb-0">' + esc(c.d) + '</span>' : "") + (c.r ? '<span class="fr-text--sm fr-mb-0">Réponse : ' + esc(c.r) + '</span>' : "") +
          '<div class="fr-checkbox-group fr-checkbox-group--sm"><input type="checkbox" id="c-' + i + '" data-c="' + i + '" ' + (c.on ? "checked" : "") + (fige ? " disabled" : "") + '><label class="fr-label" for="c-' + i + '">Dans la revue</label></div></div>';
      }).join("") + '</div>';
    }).join("") + '</div>';
  each("[data-c]", function (i) { i.onchange = function () { var c = CARTES[+i.dataset.c]; if (GRIST) return ecrire([["UpdateRecord", "Cartes", c.rid, { Retenue: i.checked }]], renderCartes); c.on = i.checked; majs(); window.HUB.accueil(); renderCartes(); }; });
  $("c-mois").onchange = function () { state.mois = $("c-mois").value; renderCartes(); };
}
function showHub(mode) {
  state.hubMode = mode;
  $("hub-accueil").hidden = mode !== "maj"; $("deck").hidden = mode !== "deck"; $("cartes").hidden = mode !== "cartes";
  $("seg-revue-box").hidden = mode === "deck";
  if (mode === "cartes") renderCartes();
}

/* ---------- Ressources ---------- */
function vRessources() {
  var card = function (r) {
    var link = r[4] ? '<a href="' + r[4] + '" target="_blank" rel="noopener">' + esc(r[1]) + '</a>' : r[5] ? '<button class="dop-link-btn" type="button" data-ap="' + r[5] + '">' + esc(r[1]) + '</button>' : esc(r[1]);
    return '<div class="fr-col-12 fr-col-md-6 fr-col-lg-4"><div class="fr-card fr-card--sm' + (r[4] ? " fr-enlarge-link" : "") + '"><div class="fr-card__body"><div class="fr-card__content"><h3 class="fr-card__title">' + link + '</h3><p class="fr-card__desc">' + esc(r[2]) + '</p>' +
      '<div class="fr-card__start"><ul class="fr-badges-group"><li>' + badge("", r[3]) + '</li>' + (r[5] ? '<li>' + badge("fr-badge--blue-ecume", "Aperçu") + '</li>' : "") + (r[7] ? '<li>' + badge("fr-badge--purple-glycine", r[7]) + '</li>' : "") + (r[6] ? '<li>' + badge("fr-badge--warning", r[6]) + '</li>' : "") + '</ul></div></div></div></div></div>';
  };
  var pret = RESSOURCES.filter(function (r) { return !r[6]; }), todo = RESSOURCES.filter(function (r) { return r[6]; });
  return '<div><h1 class="fr-h2 fr-mb-1v">Ressources</h1><p class="dop-sub fr-mb-0">Ce qui sert à tous les produits. Les livrables propres à un produit sont dans sa fiche.</p></div>' +
    ["Gabarits", "Règles produit", "Règles tech", "Guides"].map(function (f) {
      var rs = pret.filter(function (r) { return r[0] === f; });
      return rs.length ? '<section class="dop-res-fam"><h2 class="fr-h4">' + f + '</h2><div class="fr-grid-row fr-grid-row--gutters">' + rs.map(card).join("") + '</div></section>' : "";
    }).join("") +
    '<section class="dop-res-fam dop-res-todo"><h2 class="fr-h4">À venir</h2><p class="dop-sub">Ressources à rédiger ou à migrer dans Docs.</p><div class="fr-grid-row fr-grid-row--gutters">' + todo.map(card).join("") + '</div></section>';
}

/* ---------- Aperçu d'un livrable ---------- */
function ouvrirApercu(key) {
  var a = (window.APERCUS || {})[key]; if (!a) return;
  $("apercu-titre").textContent = a.titre; $("apercu-lieu").textContent = a.lieu; $("apercu-corps").innerHTML = a.html;
  var d = $("apercu"); if (d.showModal) d.showModal(); else d.setAttribute("open", "");
}
$("apercu-fermer").onclick = function () { var d = $("apercu"); if (d.close) d.close(); else d.removeAttribute("open"); };

/* ---------- Routage par ancre ---------- */
function route(sur) {
  var r = (location.hash || "#portefeuille").slice(1);
  renderMenu(r);
  var revue = r.indexOf("revue") === 0;
  $("revue").hidden = !revue; $("vue").hidden = revue; $("legende").hidden = r !== "portefeuille";
  if (!revue) { $("deck").hidden = true; $("panneau-comment").classList.remove("ouvert"); }
  if (revue) {
    var id = r.slice(6);
    if (id) {
      var u = H.updates.filter(function (x) { return x.id === id; })[0];
      renderFil([["Revue mensuelle", "revue"], [u ? u.titre : id, r]]);
      H.produits = produitsCourse(u);
      window.HUB_ID = id; showHub("deck"); window.HUB.deck();
      if (!u) $("titre-update").textContent = "Mise à jour introuvable";
      $("statut-maj").value = u && !u.brouillon ? "valide" : "brouillon";
      document.title = (u ? u.titre : id) + " · Data Ops";
    } else { renderFil([["Revue mensuelle", "revue"]]); showHub(state.hubMode === "cartes" ? "cartes" : "maj"); $("seg-maj").checked = state.hubMode !== "cartes"; $("seg-cartes").checked = state.hubMode === "cartes"; }
    if (sur !== true) window.scrollTo(0, 0);
    return;
  }
  var html, fil;
  if (r.indexOf("produit-") === 0) {
    var pid = r.slice(8), p = prodBy(pid);
    if (state.prod !== pid) { state.prod = pid; state.sec = "ind"; state.tdbPre = ""; state.ret = null; state.rnew = false; }
    html = vProduit(pid); fil = [["Portefeuille", "portefeuille"], [p ? p.nom : "Produit", r]];
  }
  else if (r === "ressources") { html = vRessources(); fil = [["Ressources", r]]; }
  else if (r === "stats") { html = vStats(); fil = [["Statistiques", r]]; }
  else { html = vPortefeuille(); fil = [["Portefeuille", "portefeuille"]]; }
  var actif = document.activeElement && document.activeElement.id;
  renderFil(fil);
  $("vue").innerHTML = html;
  bind();
  if (sur === true && actif && $(actif)) $(actif).focus();
  if (sur !== true) window.scrollTo(0, 0);
}
function bind() {
  each('input[name="grp"]', function (i) { i.onchange = function () { state.group = i.value; route(true); }; });
  each('input[name="mode"]', function (i) { i.onchange = function () { state.mode = i.value; route(true); }; });
  each("[data-etape]", function (s) { s.onchange = function () { changerEtape(s.dataset.etape, +s.value); }; });
  each("[data-move]", function (b) { b.onclick = function () { changerEtape(b.dataset.move, +b.dataset.to); }; });
  each("[data-drag]", function (c) { c.ondragstart = function (e) { e.dataTransfer.setData("text/plain", c.dataset.drag); c.classList.add("dop-dragging"); }; c.ondragend = function () { c.classList.remove("dop-dragging"); }; });
  each("[data-drop]", function (z) {
    z.ondragover = function (e) { e.preventDefault(); z.classList.add("dop-over"); };
    z.ondragleave = function () { z.classList.remove("dop-over"); };
    z.ondrop = function (e) { e.preventDefault(); changerEtape(e.dataTransfer.getData("text/plain"), +z.dataset.drop); };
  });
  each("[data-statut]", function (s) { s.onchange = function () { var p = prodBy(s.dataset.statut); if (GRIST) return ecrire([["UpdateRecord", "Produits", p.rid, { Statut: STATUTS[s.value][1] }]]); p.statut = s.value; route(true); }; });
  each("[data-fait]", function (c) { c.onchange = function () { var j = prodBy(state.prod).journal[+c.dataset.fait]; if (GRIST) return ecrire([["UpdateRecord", "Journal", j[6], { Fait_le: c.checked ? maintenant() : null }]]); j[5] = c.checked ? jour() : ""; route(true); }; });
  each('input[name="sec"]', function (i) { i.onchange = function () { state.sec = i.value; state.ret = null; state.rnew = false; route(true); }; });
  var h = $("histo"); if (h) h.onchange = function () { state.histo = h.checked; route(true); };
  each("[data-att]", function (a) { var maj = function () { a.href = urlPieceJointe(a.dataset.att); }; a.onmousedown = maj; a.onfocus = maj; });
  each("[data-ap]", function (b) { b.onclick = function () { ouvrirApercu(b.dataset.ap); }; });
  each("[data-retour]", function (b) { b.onclick = function () { state.sec = "retours"; state.tdbPre = b.dataset.retour; state.rnew = true; state.ret = null; route(true); var t = $("r-txt"); if (t) { t.scrollIntoView({ block: "center" }); t.focus(); } }; });
  each("[data-rnat]", function (b) { b.onclick = function () { state.rnat = b.dataset.rnat; route(true); }; });
  each("[data-ret]", function (b) { b.onclick = function () { state.ret = b.dataset.ret; state.rnew = false; route(); }; });
  var re = $("r-env"); if (re) re.onchange = function () { state.renv = re.value; route(true); };
  var ra = $("r-arch"); if (ra) ra.onchange = function () { state.rarch = ra.checked; route(true); };
  var rn = $("r-new"); if (rn) rn.onclick = function () { state.rnew = true; state.ret = null; route(); };
  var rb = $("r-back"); if (rb) rb.onclick = function () { state.rnew = false; state.ret = null; route(); };
  var rs = $("r-st"); if (rs) rs.onchange = function () { $("g-ver").hidden = rs.value !== "livre"; };
  var rr = function () { return RETOURS.filter(function (r) { return r.key === state.ret; })[0]; };
  var sv = $("r-save"); if (sv) sv.onclick = function () {
    var r = rr(), st = $("r-st").value, ver = $("r-ver").value.trim();
    if (st === "livre" && !ver) { $("r-msg").textContent = "Indiquez la version qui embarque ce retour."; $("r-ver").focus(); return; }
    var champs = { Statut: RST[st][1] }; if (st === "livre") champs.Livre_dans = ver;
    majRetour(r, champs, st !== r.st ? [RST[st][1], jour()] : null);
  };
  var ar = $("r-archiver"); if (ar) ar.onclick = function () {
    var r = rr(), arch = !r.arch;
    majRetour(r, { Archive_le: arch ? maintenant() : null }, null);
    if (arch) { state.ret = null; route(); }
  };
  var fj = $("f-journal");
  if (fj) fj.onsubmit = function (e) {
    e.preventDefault();
    var txt = $("j-txt").value.trim();
    $("g-j").classList.toggle("fr-input-group--error", !txt); $("j-err").hidden = !!txt;
    if (!txt) { $("j-txt").focus(); return; }
    var ech = $("j-ech").value.trim(), pj = prodBy(state.prod);
    if (GRIST) return ecrire([["AddRecord", "Journal", null, { Produit: pj.rid, Date: maintenant(), Type: $("j-type").value, Contenu: txt, Qui: $("j-qui").value.trim(), Echeance: depuisJour(ech), Echeance_note: depuisJour(ech) ? "" : ech }]]);
    pj.journal.unshift([jour(), $("j-type").value, txt, $("j-qui").value.trim() || "·", ech]);
    route(true);
  };
  var f = $("f-retour");
  if (f) f.onsubmit = function (e) {
    e.preventDefault();
    var txt = $("r-txt").value.trim();
    $("g-txt").classList.toggle("fr-input-group--error", !txt); $("r-err").hidden = !!txt;
    if (!txt) { $("r-txt").focus(); return; }
    var files = Array.prototype.slice.call($("r-img").files || []);
    Promise.all(files.map(function (fl) { return new Promise(function (res) { var rd = new FileReader(); rd.onload = function () { res(rd.result); }; rd.onerror = function () { res(null); }; rd.readAsDataURL(fl); }); })).then(function (urls) {
      var NAT = $("r-type").value, ok = function () { var o = $("r-ok"); if (o) o.textContent = "Retour enregistré dans la table Retours, statut Nouveau."; };
      state.rnew = false; state.rnat = "tous"; state.renv = "tous";
      if (GRIST) return ecrire([["AddRecord", "Retours", null, { Produit: prodBy(state.prod).rid, Recu_le: maintenant(), Tableau_de_bord: $("r-tdb").value, Nature: NAT, Description: txt, Auteur: $("r-qui").value.trim(), Statut: "Nouveau", Historique: "Nouveau|" + jour() }]], ok);
      RETOURS.unshift({ key: "m" + RETOURS.length, p: state.prod, qui: $("r-qui").value.trim() || "Anonyme", quand: jour(), tdb: $("r-tdb").value, nat: NATV[NAT] || "aff", txt: txt, imgs: urls.filter(Boolean).length, st: "nouveau", hist: [["Nouveau", jour()]] });
      route(true);
    });
  };
}

/* ---------- Source Grist : dans le doc, les tables remplacent les données de la maquette ---------- */
var GRIST = window.self !== window.top && !!window.grist && !!window.grist.docApi;
/* Valeur Grist du statut → clé du kanban ; « Pris en compte » est l'ancien nom de « Réponse proposée » */
var RSTK = { "Nouveau": "nouveau", "Pris en compte": "propose", "Réponse proposée": "propose", "Validé par le produit": "valide", "En cours": "encours", "Livré": "livre", "Écarté": "ecarte" };
var REVUES = {}, INSTANTANES = {};
var jour = function (d) { d = d || new Date(); return ("0" + d.getDate()).slice(-2) + "/" + ("0" + (d.getMonth() + 1)).slice(-2); };
var versJour = function (sec) { if (!sec) return ""; var d = new Date(sec * 1000); return ("0" + d.getUTCDate()).slice(-2) + "/" + ("0" + (d.getUTCMonth() + 1)).slice(-2); };
var maintenant = function () { var d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 1000; };
var depuisJour = function (jj) { var m = /^(\d{2})\/(\d{2})$/.exec(jj || ""); return m ? Date.UTC(AUJOURDHUI.getFullYear(), +m[2] - 1, +m[1]) / 1000 : null; };
var lignes = function (t) { var cols = Object.keys(t).filter(function (k) { return k !== "manualSort"; }); var n = (t.id || []).length, out = []; for (var i = 0; i < n; i++) { var o = {}; cols.forEach(function (c) { o[c] = t[c][i]; }); out.push(o); } return out; };
var vider = function (a) { a.length = 0; return a; };
var APERCU_RESSOURCE = { "Shell vide du tableau de bord": "shell-vide", "Plan de tagging à dupliquer": "plan-basavi" };
var THEMES = { "2026-09": "de la prod réelle au relais anti-bloqueur", "2026-10": "la mesure d'impact sort de Notion" };

function chargerGrist() {
  var noms = ["Produits", "Environnements", "Indicateurs", "Livrables", "Journal", "Retours", "Cartes", "Revues", "Instantanes", "Ressources"];
  return Promise.all(noms.map(function (n) { return window.grist.docApi.fetchTable(n).then(lignes); })).then(function (t) {
    var T = {}; noms.forEach(function (n, i) { T[n] = t[i]; });
    var code = {}; T.Produits.forEach(function (r) { code[r.id] = r.Code; });
    var PILV = { "Mesuré": "ok", "En cours": "wip", "À construire": "todo" }, STV = { "Actif": "actif", "En pause": "pause", "Autonome": "autonome" };
    vider(PRODUITS);
    T.Produits.forEach(function (r) {
      var e = ETAPES.map(function (x) { return x[0]; }).indexOf(r.Etape);
      PRODUITS.push({ rid: r.id, id: r.Code, nom: r.Nom, dept: r.Departement, pm: r.Cheffe_de_projet, coach: r.Coach, statut: STV[r.Statut] || "actif",
        step: r.MEP_faite ? 5 : Math.max(-1, e - 1), depuis: versJour(r.Etape_depuis), avancee: r.Avancee_du_mois || "", figma: r.Board_atelier || "",
        m: [r.Utilisable, r.Utilise, r.Utile, r.Impactant].map(function (v) { return PILV[v] || "todo"; }),
        envs: T.Environnements.filter(function (x) { return x.Produit === r.id; }).map(function (x) { return [x.Type, x.Libelle, x.URL, x.Etat]; }),
        ind: T.Indicateurs.filter(function (x) { return x.Produit === r.id; }).map(function (x) { return [x.Indicateur, PIL.indexOf(x.Pilier), !!x.Retenu_en_atelier, !!x.Dans_la_V1, PILV[x.Statut] || "todo"]; }),
        journal: T.Journal.filter(function (x) { return x.Produit === r.id; }).sort(function (a, b) { return (b.Date || 0) - (a.Date || 0) || b.id - a.id; })
          .map(function (x) { return [versJour(x.Date), x.Type, x.Contenu, x.Qui || "", versJour(x.Echeance) || x.Echeance_note || "", versJour(x.Fait_le), x.id]; }) });
    });
    vider(RETOURS);
    T.Retours.sort(function (a, b) { return (b.Recu_le || 0) - (a.Recu_le || 0); }).forEach(function (x) {
      var caps = Array.isArray(x.Captures) ? x.Captures.slice(1) : [];
      var hist = String(x.Historique || "").split("\n").filter(Boolean).map(function (l) { return l.split("|"); });
      RETOURS.push({ key: "g" + x.id, rid: x.id, no: x.Numero || null, p: code[x.Produit], qui: x.Auteur || "Anonyme", quand: versJour(x.Recu_le), tdb: x.Tableau_de_bord || "", nat: NATV[x.Nature] || "aff",
        txt: x.Description || "", imgs: caps.length, caps: caps, st: RSTK[x.Statut] || "nouveau", an: x.Analyse || "", rep: x.Reponse || "", resp: x.Qui || "", eff: x.Effort || "", pri: x.Priorite === "Haute",
        ver: x.Livre_dans || "", arch: versJour(x.Archive_le) || null, hist: hist.length ? hist : [["Nouveau", versJour(x.Recu_le)]],
        ong: x.Onglet || "", per: x.Periode || "", seg: x.Segment || "", vtdb: x.Version_tableau || "" });
    });
    var KV = { "Contexte": "ctx", "Accomplissement": "acc", "Frein": "frein", "Prochaine étape": "next", "Échéance": "ech" };
    REVUES = {}; T.Revues.forEach(function (r) { REVUES[r.Mois] = r; });
    var moisDe = {}; T.Revues.forEach(function (r) { moisDe[r.id] = r.Mois; });
    vider(CARTES);
    T.Cartes.forEach(function (c) { CARTES.push({ rid: c.id, mois: moisDe[c.Revue], k: KV[c.Type] || "acc", cat: c.Categorie || "", col: COLS_NEXT.indexOf(c.Colonne), prod: c.Produit || "", t: c.Titre || "", d: c.Texte || "", r: c.Reponse || "", on: !!c.Retenue }); });
    vider(RESSOURCES);
    T.Ressources.forEach(function (r) { RESSOURCES.push([r.Famille, r.Titre, r.Description, r.Lieu, r.Lien || "", APERCU_RESSOURCE[r.Titre] || "", r.Statut === "À rédiger" || r.Statut === "À migrer" ? r.Statut : "", r.Statut === "Exemple" ? "Exemple" : ""]); });
    window.LIVRABLES = T.Livrables.map(function (l) {
      var f = Array.isArray(l.Fichier) && l.Fichier.length > 1 ? l.Fichier[1] : null;
      return { p: code[l.Produit] || "trans", type: l.Type, titre: l.Titre, lieu: l.Nouveau_lien ? "Migré" : f ? "Fichier joint" : l.Lieu, lien: l.Nouveau_lien || l.Lien || "", date: l.Date || "", old: l.Version === "Historique", fichier: f };
    });
    INSTANTANES = {}; T.Instantanes.forEach(function (x) { var m = moisDe[x.Revue]; (INSTANTANES[m] = INSTANTANES[m] || []).push({ rid: x.id, nom: x.Produit, etape: x.Couloir, dept: x.Departement, avance: !!x.A_change, recap: !!x.Recap }); });
    vider(INSTANTANE_AOUT); (INSTANTANES["2026-07-08"] || []).forEach(function (x) { INSTANTANE_AOUT.push(x); });
    Object.keys(MOIS).forEach(function (k) { delete MOIS[k]; });
    Object.keys(FIGEES).forEach(function (k) { delete FIGEES[k]; });
    T.Revues.forEach(function (r) {
      var iso = r.Date ? new Date(r.Date * 1000).toISOString().slice(0, 10) : "";
      MOIS[r.Mois] = [r.Titre, iso, THEMES[r.Mois] || ""];
      if (r.Statut === "Validé" && r.Contenu) { var maj = JSON.parse(r.Contenu); maj.brouillon = false; maj.mois = r.Mois; maj.id = r.Mois; FIGEES[r.Mois] = { maj: maj, produits: INSTANTANES[r.Mois] || INSTANTANE_AOUT }; }
    });
  });
}
/* Pièces jointes : lien signé par un jeton de lecture de courte durée */
var JETON = null;
function rafraichirJeton() { try { return window.grist.docApi.getAccessToken({ readOnly: true }).then(function (t) { JETON = t; }).catch(function () { JETON = null; }); } catch (e) { return Promise.resolve(); } }
function urlPieceJointe(id) { return JETON ? JETON.baseUrl + "/attachments/" + id + "/download?inline=1&auth=" + JETON.token : "#"; }
/* Écrire dans le doc, puis relire et réafficher */
function ecrire(actions, apres) {
  return window.grist.docApi.applyUserActions(actions).then(chargerGrist).then(function () { majs(); window.HUB.accueil(); route(true); if (apres) apres(); })
    .catch(function (e) { var l = $("pf-live"); if (l) l.textContent = "Écriture refusée : " + e.message; console.error(e); });
}

/* ---------- Démarrage ---------- */
$("legende-etapes").innerHTML = ETAPES.map(function (e, i) { return '<li>' + badge("fr-badge--" + e[2], (i + 1) + ". " + e[0] + " : " + e[1]) + '</li>'; }).join("");
H.etapes = [
  { id: "prochainement", label: "Prochainement", couleur: "var(--text-mention-grey)", fond: "var(--background-action-high-grey)" },
  { id: "cadrage", label: "Cadrage", couleur: "var(--text-label-orange-terre-battue)", fond: "var(--background-action-high-orange-terre-battue)" },
  { id: "accompagnement", label: "Accompagnement actif", couleur: "var(--text-label-blue-cumulus)", fond: "var(--background-action-high-blue-cumulus)" },
  { id: "autonomie", label: "Autonomie outillée", couleur: "var(--text-label-green-menthe)", fond: "var(--background-action-high-green-menthe)" }
];
H.meta.descriptif = "Le point mensuel de la démarche : produits accompagnés, ateliers menés, tableaux de bord livrés et prochaines étapes. Une mise à jour se présente comme un deck, au clavier.";
function demarrer() {
majs();
/* Maquette : septembre validé le 02/10. Dans Grist, le statut vient de la table Revues. */
if (!GRIST) (function () { var u = H.updates.filter(function (x) { return x.id === "2026-09"; })[0]; var f = copie(u); f.brouillon = false; FIGEES["2026-09"] = { maj: f, produits: produitsCourse(u) }; majs(); })();
window.hubNotice = function (msg) { var e = $("etat-comment"); if (e) e.textContent = msg.length > 160 ? "Copie refusée par le navigateur." : msg; };
window.HUB.accueil();
$("grille").addEventListener("click", function (e) { var a = e.target.closest("[data-update]"); if (!a) return; e.preventDefault(); location.hash = "revue-" + a.dataset.update; });
$("statut-maj").onchange = function () { changerStatutMaj(window.HUB_ID, this.value === "valide"); };
$("retour-liste").onclick = function () { location.hash = "revue"; };
$("seg-maj").onchange = function () { showHub("maj"); };
$("seg-cartes").onchange = function () { showHub("cartes"); };
$("back").onclick = function () { if (state.parent) location.hash = state.parent; };
var lireMini = function () { try { return localStorage.getItem("dataops-menu-replie") === "1"; } catch (e) { return false; } };
var poserMini = function (v) {
  document.documentElement.classList.toggle("dop-mini", v);
  var b = $("replier"); b.setAttribute("aria-expanded", String(!v)); b.title = v ? "Déplier le menu" : "Replier le menu"; b.querySelector("span").textContent = v ? "›" : "‹ Replier";
  try { localStorage.setItem("dataops-menu-replie", v ? "1" : "0"); } catch (e) { /* stockage indisponible : l'état reste en mémoire */ }
};
poserMini(lireMini());
$("replier").onclick = function () { poserMini(!document.documentElement.classList.contains("dop-mini")); };
window.addEventListener("hashchange", function () { route(); });
route();
}
if (GRIST) {
  document.documentElement.classList.add("dop-grist");
  window.grist.ready({ requiredAccess: "full" });
  setInterval(rafraichirJeton, 240000);
  Promise.all([chargerGrist(), rafraichirJeton()]).then(demarrer).catch(function (e) { $("vue").innerHTML = '<div class="fr-alert fr-alert--error"><p>Lecture du doc impossible : ' + esc(e.message) + '</p></div>'; console.error(e); });
} else if (!PRODUITS.length) {
  $("vue").innerHTML = '<div class="fr-alert fr-alert--info"><h3 class="fr-alert__title">Ouvrez ce widget depuis Grist</h3><p>Les données vivent dans le doc « Data Ops » : ajoutez cette adresse comme widget personnalisé, avec un accès complet au document.</p></div>';
} else demarrer();
window.DATAOPS = { PRODUITS: PRODUITS, RETOURS: RETOURS, CARTES: CARTES, RESSOURCES: RESSOURCES, ETAPES: ETAPES, INSTANTANE_AOUT: INSTANTANE_AOUT, FIGEES: FIGEES, MOIS: MOIS, H: H };
})();
