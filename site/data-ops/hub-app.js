/* ============================================================================
   HUB MESURE D'IMPACT, Logique (accueil + deck)
   Un seul fichier, se comporte selon la page (présence de #grille ou #scene).
   Données : window.MESURE_IMPACT (data/updates.js). Copie adaptée au widget Data Ops : liens internes, pas d'alert().
   ============================================================================ */
(function () {
  "use strict";
  var DATA = window.MESURE_IMPACT;
  if (!DATA) { console.error("Données introuvables (data/updates.js)"); return; }

  var MOIS_FR = ["janvier","février","mars","avril","mai","juin","juillet",
                 "août","septembre","octobre","novembre","décembre"];

  function dateLisible(iso) {
    var p = (iso || "").split("-");
    if (p.length !== 3) return iso || "";
    return Number(p[2]) + " " + MOIS_FR[Number(p[1]) - 1] + " " + p[0];
  }
  function echapper(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function el(id) { return document.getElementById(id); }

  function etapeMeta(id) {
    return (DATA.etapes || []).filter(function (x) { return x.id === id; })[0] || null;
  }
  function pastilleEtape(id) {
    var e = etapeMeta(id);
    if (!e) return "";
    return ' <span class="etape-tag" style="background:' + (e.fond || e.couleur) + '">' + echapper(e.label) + '</span>';
  }

  /* ======================================================================== */
  /* PAGE ACCUEIL                                                             */
  /* ======================================================================== */
  function rendreAccueil() {
    var m = DATA.meta || {};
    el("titre").textContent = m.titre || "";
    el("soustitre").textContent = m.sousTitre || "";
    el("descriptif").textContent = m.descriptif || "";

    var grille = el("grille");
    var updates = (DATA.updates || []).slice().sort(function (a, b) {
      return (b.date || "").localeCompare(a.date || "");
    });

    if (!updates.length) {
      grille.innerHTML = '<div class="fr-col-12"><p class="fr-mt-2w">Aucune mise à jour pour le moment.</p></div>';
      return;
    }

    grille.innerHTML = updates.map(function (u) {
      var nb = (u.slides || []).length;
      var badge = '<div class="fr-card__start"><ul class="fr-badges-group"><li>' +
        (u.brouillon ? '<p class="fr-badge fr-badge--info fr-badge--no-icon">Brouillon</p>' : '<p class="fr-badge fr-badge--success fr-badge--no-icon">Validé</p>') + '</li></ul></div>';
      return '<div class="fr-col-12 fr-col-md-4">' +
        '<div class="fr-card fr-enlarge-link">' +
          '<div class="fr-card__body"><div class="fr-card__content">' +
            badge +
            '<h3 class="fr-card__title">' +
              '<a href="#" data-update="' + echapper(u.id) + '">' + echapper(u.titre) + '</a>' +
            '</h3>' +
            '<p class="fr-card__desc">' + echapper(dateLisible(u.date)) + '</p>' +
            '<div class="fr-card__end">' +
              '<p class="fr-card__detail">' + nb + ' slide' + (nb > 1 ? "s" : "") + '</p>' +
            '</div>' +
          '</div></div>' +
        '</div>' +
      '</div>';
    }).join("");
  }

  /* ======================================================================== */
  /* PAGE DECK                                                                */
  /* ======================================================================== */
  var etat = { update: null, i: 0 };

  function updateCourante() {
    var id = window.HUB_ID;
    var updates = DATA.updates || [];
    return updates.filter(function (u) { return u.id === id; })[0] || null;
  }

  /* --- rendu d'une slide selon son type --- */
  /* Regroupe des items par catégorie (Gouvernance / Technique / Produit) en gardant
     l'ordre d'apparition. Sans catégorie, on renvoie un seul groupe anonyme. */
  function grouperParCategorie(items) {
    var ordre = [], paquets = {};
    (items || []).forEach(function (it) {
      var c = it.cat || "";
      if (!paquets[c]) { paquets[c] = []; ordre.push(c); }
      paquets[c].push(it);
    });
    return ordre.map(function (c) { return { cat: c, items: paquets[c] }; });
  }

  function htmlGroupes(items, rendreItem, classeBlocs) {
    return grouperParCategorie(items).map(function (g) {
      return (g.cat ? '<h3 class="cat">' + echapper(g.cat) + '</h3>' : "") +
        '<div class="blocs' + (classeBlocs || "") + '">' + g.items.map(rendreItem).join("") + '</div>';
    }).join("");
  }

  /* Petit histogramme mensuel, sans librairie : la dernière barre est le mois courant. */
  function htmlCourbe(c) {
    var pts = c.points || [];
    var max = Math.max.apply(null, pts.map(function (p) { return p.valeur; }).concat([1]));
    // Hauteur en pixels plutôt qu'en pourcentage : dans un conteneur flex, un
    // pourcentage de hauteur ne se résout pas et toutes les barres sortent égales.
    var HAUT = 56;
    var barres = pts.map(function (p) {
      var h = Math.max(3, Math.round((p.valeur / max) * HAUT));
      return '<div class="barre' + (p.ici ? " ici" : "") + '">' +
        '<div class="v">' + p.valeur + '</div>' +
        '<div class="fut" style="height:' + HAUT + 'px"><div class="rem" style="height:' + h + 'px"></div></div>' +
        '<div class="m">' + echapper(p.mois) + '</div></div>';
    }).join("");
    return '<div class="courbe"><div class="c-titre">' + echapper(c.titre) + '</div>' +
      (c.note ? '<div class="c-note">' + echapper(c.note) + '</div>' : "") +
      '<div class="barres">' + barres + '</div></div>';
  }

  function htmlSlide(slide) {
    var tete =
      '<p class="kicker">' + echapper(slide.titre || "") + '</p>' +
      (slide.sousTitre ? '<div class="sous">' + echapper(slide.sousTitre) + '</div>' : "");
    var corps = "";

    switch (slide.type) {

      case "intro":
        corps = '<div class="corps">' +
          (slide.sections && slide.sections.length
            ? '<div class="sections">' + slide.sections.map(function (s) {
                return '<div class="section"><div class="s-titre">' + echapper(s.titre) + '</div>' +
                       '<div class="s-texte">' + echapper(s.texte) + '</div></div>';
              }).join("") + '</div>'
            : "") +
          (slide.body || []).map(function (t) {
            return '<p class="puce">' + echapper(t) + '</p>';
          }).join("") +
          (slide.chiffres && slide.chiffres.length
            ? '<div class="chiffres">' + slide.chiffres.map(function (c) {
                return '<div class="chiffre"><div class="val">' + echapper(c.valeur) + '</div>' +
                       '<div class="lab">' + echapper(c.label) + '</div>' +
                       (c.detail ? '<div class="det">' + echapper(c.detail) + '</div>' : "") + '</div>';
              }).join("") + '</div>'
            : "") +
          '</div>';
        return '<h2>' + echapper(slide.titre) + '</h2>' +
               (slide.sousTitre ? '<div class="sous">' + echapper(slide.sousTitre) + '</div>' : "") +
               corps;

      case "recap":
        // Au-delà de 4 produits, on passe sur deux colonnes pour rester dans l'écran.
        var colonnesRecap = (slide.items || []).length > 4 ? " deux" : "";
        corps = '<div class="corps"><div class="blocs' + colonnesRecap + '">' +
          (slide.items || []).map(function (it) {
            return '<div class="bloc' + (it.avance ? " avance" : "") + '">' +
              '<div class="b-titre">' + echapper(it.produit) + (it.etape ? pastilleEtape(it.etape) : "") +
              (it.avance ? '<span class="marqueur">a changé d\'étape</span>' : "") + '</div>' +
              '<div class="b-texte">' + echapper(it.avancee) + '</div></div>';
          }).join("") + '</div></div>';
        return '<h2>' + echapper(slide.titre) + '</h2>' +
               (slide.sousTitre ? '<div class="sous">' + echapper(slide.sousTitre) + '</div>' : "") + corps;

      case "accomplissements":
        corps = '<div class="corps">' +
          htmlGroupes(slide.items, function (it) {
            return '<div class="bloc jalon">' +
              '<div class="b-titre">' + echapper(it.titre) + '</div>' +
              (it.texte ? '<div class="b-texte">' + echapper(it.texte) + '</div>' : "") +
              '</div>';
          }, " deux") + '</div>';
        return '<h2>' + echapper(slide.titre) + '</h2>' +
               (slide.sousTitre ? '<div class="sous">' + echapper(slide.sousTitre) + '</div>' : "") + corps;

      case "problems":
        // Le frein seul ici : les réponses vivent sur la slide suivante, appariées par numéro.
        var numPb = 0;
        corps = '<div class="corps">' +
          htmlGroupes(slide.items, function (it) {
            numPb += 1;
            return '<div class="bloc probleme">' +
              '<div class="b-titre"><span class="num">' + numPb + '</span>' + echapper(it.titre || "") + '</div>' +
              '<div class="b-texte">' + echapper(it.probleme) + '</div></div>';
          }, " deux") + '</div>';
        return '<h2>' + echapper(slide.titre) + '</h2>' +
               (slide.sousTitre ? '<div class="sous">' + echapper(slide.sousTitre) + '</div>' : "") + corps;

      case "next":
        var cols = slide.colonnes || [
          { titre: slide.colGaucheTitre || "Prochaines actions", items: slide.items || [] },
          { titre: slide.colDroiteTitre || "Prochains produits", items: slide.produits || [] }
        ];
        corps = '<div class="corps"><div class="cols" style="grid-template-columns:repeat(' + cols.length + ',1fr)">' +
          cols.map(function (c) {
            return '<div><h3>' + echapper(c.titre) + '</h3>' +
              (c.items || []).map(function (t) { return '<p class="puce">' + echapper(t) + '</p>'; }).join("") +
              '</div>';
          }).join("") + '</div>' +
          (slide.echeances && slide.echeances.length
            ? '<h3 class="cat">Prochaines échéances</h3><div class="echeances">' +
              slide.echeances.map(function (e) {
                return '<div class="echeance"><span class="quand">' + echapper(e.date) + '</span>' +
                       '<span class="quoi">' + echapper(e.quoi) + '</span></div>';
              }).join("") + '</div>'
            : "") +
          '</div>';
        return '<h2>' + echapper(slide.titre) + '</h2>' +
               (slide.sousTitre ? '<div class="sous">' + echapper(slide.sousTitre) + '</div>' : "") + corps;

      case "solutions":
        // Reprend les items de la slide « problems » de la même mise à jour : une seule
        // source de vérité, et la numérotation reste alignée d'une slide à l'autre.
        var src = (etat.update.slides || []).filter(function (s) { return s.type === "problems"; })[0];
        var numSol = 0;
        corps = '<div class="corps">' +
          htmlGroupes((src && src.items) || [], function (it) {
            numSol += 1;
            return '<div class="bloc reponse">' +
              '<div class="b-titre"><span class="num vert">' + numSol + '</span>' + echapper(it.titre || "") + '</div>' +
              '<div class="b-texte">' + echapper(it.solution || "") + '</div></div>';
          }, " deux") + '</div>';
        return '<h2>' + echapper(slide.titre) + '</h2>' +
               (slide.sousTitre ? '<div class="sous">' + echapper(slide.sousTitre) + '</div>' : "") + corps;

      case "trajectoire":
        corps = '<div class="corps"><div class="frise">' +
          (slide.jalons || []).map(function (j) {
            return '<div class="jalon' + (j.ici ? " ici" : "") + '">' +
              '<div class="periode">' + echapper(j.periode) + '</div>' +
              (j.ici ? '<div class="ici-tag">nous sommes ici</div>' : "") +
              '<div class="j-texte">' + echapper(j.texte) + '</div></div>';
          }).join("") + '</div>' +
          (slide.courbes && slide.courbes.length
            ? '<div class="courbes">' + slide.courbes.map(htmlCourbe).join("") + '</div>'
            : "") + '</div>';
        return '<h2>' + echapper(slide.titre) + '</h2>' +
               (slide.sousTitre ? '<div class="sous">' + echapper(slide.sousTitre) + '</div>' : "") + corps;

      case "roadmap":
        return '<h2>' + echapper(slide.titre) + '</h2>' +
               (slide.sousTitre ? '<div class="sous">' + echapper(slide.sousTitre) + '</div>' : "") +
               '<div class="corps">' + htmlCourse() + '</div>';

      default:
        return '<h2>' + echapper(slide.titre || "Slide") + '</h2>';
    }
  }

  /* --- la roadmap "petits chevaux de course" --- */
  function htmlCourse() {
    var etapes = DATA.etapes || [];
    var produits = DATA.produits || [];

    var colonnes = etapes.map(function (et, idx) {
      var estArrivee = (idx === etapes.length - 1);
      var chevaux = produits.filter(function (p) { return p.etape === et.id; });

      var contenu = chevaux.length
        ? chevaux.map(function (p) {
            if (p.recap) {
              return '<div class="cheval recap"><span>' + echapper(p.nom) + '</span></div>';
            }
            return '<div class="cheval' + (p.avance ? " bouge" : "") + '" style="border-color:' + et.couleur + '">' +
              '<span class="ico" aria-hidden="true">🐎</span>' +
              '<span>' + echapper(p.nom) + '</span>' +
              (p.dept ? '<span class="dept">' + echapper(p.dept) + '</span>' : "") +
              (p.avance ? '<span class="badge-bouge">▲ ce mois</span>' : "") +
            '</div>';
          }).join("")
        : '<div class="cheval" style="opacity:.4;border-style:dashed"><span>·</span></div>';

      return '<div class="couloir">' +
        '<div class="couloir-tete" style="border-bottom-color:' + et.couleur + ';color:' + et.couleur + '">' +
          echapper(et.label) +
          '<span class="flag" aria-hidden="true">' + (estArrivee ? "🏁" : "") + '</span>' +
        '</div>' +
        '<div class="couloir-corps">' + contenu + '</div>' +
      '</div>';
    }).join("");

    return '<div class="course">' + colonnes + '</div>' +
           '<p class="course-legende">Cadre vert = produit qui a changé d\'étape ce mois. Arrivée = autonomie outillée 🏁.</p>';
  }

  /* --- affichage de la slide courante --- */
  function afficher() {
    var u = etat.update;
    var slide = u.slides[etat.i];
    var scene = el("scene");
    scene.innerHTML = '<div class="slide">' + htmlSlide(slide) + '</div>';
    scene.scrollTop = 0;

    el("compteur").textContent = (etat.i + 1) + " / " + u.slides.length;
    el("prec").disabled = (etat.i === 0);
    el("suiv").disabled = (etat.i === u.slides.length - 1);

    Array.prototype.forEach.call(document.querySelectorAll(".point"), function (pt, k) {
      pt.classList.toggle("on", k === etat.i);
    });

    chargerComment();
  }

  function aller(i) {
    etat.i = Math.max(0, Math.min(etat.update.slides.length - 1, i));
    afficher();
  }

  /* --- commentaires (localStorage, par update + slide) --- */
  function cleComment(i) { return "mi-comment:" + etat.update.id + ":" + i; }

  function chargerComment() {
    var zone = el("zone-comment");
    if (!zone) return;
    zone.value = localStorage.getItem(cleComment(etat.i)) || "";
    el("etat-comment").textContent = "";
  }
  function sauverComment() {
    var zone = el("zone-comment");
    localStorage.setItem(cleComment(etat.i), zone.value);
    var e = el("etat-comment");
    e.textContent = "Enregistré.";
    clearTimeout(sauverComment._t);
    sauverComment._t = setTimeout(function () { e.textContent = ""; }, 1200);
  }
  function copierTousComment() {
    var u = etat.update;
    var lignes = ["# Commentaires : " + u.titre + " (" + dateLisible(u.date) + ")", ""];
    u.slides.forEach(function (s, i) {
      var c = localStorage.getItem(cleComment(i));
      if (c && c.trim()) {
        lignes.push("## Slide " + (i + 1) + " : " + (s.titre || ""));
        lignes.push(c.trim(), "");
      }
    });
    var txt = lignes.length > 2 ? lignes.join("\n") : "(aucun commentaire saisi)";
    var e = el("etat-comment");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(
        function () { e.textContent = "Commentaires copiés dans le presse-papier."; },
        function () { window.hubNotice(txt); }
      );
    } else { window.hubNotice(txt); }
  }
  /* Plein écran : l'iframe Grist peut refuser l'API, on le dit au lieu d'échouer en silence */
  function pleinEcran() {
    var d = el("deck"), avis = el("deck-avis");
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    var refus = function () {
      avis.textContent = "Le plein écran est bloqué dans Grist. Agrandis la section du widget (icône en haut à droite de la section), puis le plein écran du navigateur (F11 ou Ctrl+Cmd+F).";
      avis.hidden = false; setTimeout(function () { avis.hidden = true; }, 9000);
    };
    if (!document.fullscreenEnabled || !d.requestFullscreen) { refus(); return; }
    try { var p = d.requestFullscreen(); if (p && p.catch) p.catch(refus); } catch (e) { refus(); }
  }

  function basculerPanneau(forcer) {
    var p = el("panneau-comment");
    var ouvert = (forcer != null) ? forcer : !p.classList.contains("ouvert");
    p.classList.toggle("ouvert", ouvert);
    var b = el("btn-comment");
    b.classList.toggle("actif", ouvert);
    b.setAttribute("aria-pressed", ouvert ? "true" : "false");
    if (ouvert) el("zone-comment").focus();
  }

  /* --- export markdown de toute la mise à jour --- */
  function exporter() {
    var u = etat.update;
    var L = ["# " + u.titre + " · Mesure d'impact (" + dateLisible(u.date) + ")", ""];
    u.slides.forEach(function (s, i) {
      L.push("## " + (i + 1) + ". " + (s.titre || ""));
      if (s.sousTitre) L.push("_" + s.sousTitre + "_");
      (s.body || []).forEach(function (t) { L.push("- " + t); });
      (s.items || []).forEach(function (it) {
        if (it.produit) L.push("- **" + it.produit + "** : " + it.avancee);
        else if (it.titre) L.push("- **" + it.titre + "** " + (it.texte || ""));
        else if (it.probleme) L.push("- " + it.probleme + (it.solution ? " → " + it.solution : ""));
        else L.push("- " + it);
      });
      (s.produits || []).forEach(function (t) { L.push("- (produit) " + t); });
      var c = localStorage.getItem(cleComment(i));
      if (c && c.trim()) L.push("", "> Commentaire : " + c.trim());
      L.push("");
    });
    var txt = L.join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(
        function () { window.hubNotice("Mise à jour copiée en Markdown (prête à coller dans Notion)."); },
        function () { window.hubNotice(txt); }
      );
    } else { window.hubNotice(txt); }
  }

  function rendreDeck() {
    var u = updateCourante();
    if (!u) { el("scene").innerHTML = '<div class="slide"><h2>Mise à jour introuvable</h2></div>'; el("compteur").textContent = ""; el("points").innerHTML = ""; return; }
    var dejaPret = rendreDeck._pret; rendreDeck._pret = true;
    var garderI = (window.HUB_GARDER && etat.update && etat.update.id === u.id);
    etat.update = u;
    etat.i = garderI ? etat.i : 0;

    el("titre-update").innerHTML = echapper(u.titre) +
      (u.brouillon ? ' <span class="fr-badge fr-badge--sm fr-badge--info fr-badge--no-icon">Brouillon</span>' : ' <span class="fr-badge fr-badge--sm fr-badge--success fr-badge--no-icon">Validé</span>');
    document.title = u.titre + " · Mesure d'impact";

    var pts = el("points");
    if (dejaPret) { pts.innerHTML = u.slides.map(function (_, k) { return '<button class="point" data-i="' + k + '" aria-label="Slide ' + (k + 1) + '"></button>'; }).join(""); afficher(); return; }
    pts.innerHTML = u.slides.map(function (_, k) {
      return '<button class="point" data-i="' + k + '" aria-label="Slide ' + (k + 1) + '"></button>';
    }).join("");
    pts.addEventListener("click", function (e) {
      var b = e.target.closest(".point"); if (b) aller(Number(b.dataset.i));
    });

    el("prec").addEventListener("click", function () { aller(etat.i - 1); });
    el("suiv").addEventListener("click", function () { aller(etat.i + 1); });
    el("btn-comment").addEventListener("click", function () { basculerPanneau(); });
    el("btn-export").addEventListener("click", exporter);
    el("btn-plein").addEventListener("click", function () { pleinEcran(); });
    document.addEventListener("fullscreenchange", function () {
      var on = document.fullscreenElement === el("deck");
      el("btn-plein").setAttribute("aria-pressed", on ? "true" : "false");
      el("btn-plein").lastChild.textContent = on ? "Quitter le plein écran" : "Plein écran";
    });
    el("btn-copier-tout").addEventListener("click", copierTousComment);
    el("zone-comment").addEventListener("input", sauverComment);

    document.addEventListener("keydown", function (e) {
      if (el("deck").hidden || el("revue").hidden) return;
      if (e.target && (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT")) {
        if (e.key === "Escape") e.target.blur();
        return;
      }
      if (e.key === "ArrowRight") { e.preventDefault(); aller(etat.i + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); aller(etat.i - 1); }
      else if (e.key === "c" || e.key === "C") { e.preventDefault(); basculerPanneau(); }
      else if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); pleinEcran(); }
      else if (e.key === "Home") { e.preventDefault(); aller(0); }
      else if (e.key === "End") { e.preventDefault(); aller(etat.update.slides.length - 1); }
    });

    afficher();
  }

  /* --- aiguillage --- */
  window.HUB = { accueil: rendreAccueil, deck: rendreDeck };
})();
