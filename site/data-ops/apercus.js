/* Aperçus des livrables (simule le contenu tel qu'il apparaîtra dans Docs). Clé = identifiant de l'aperçu. */
window.APERCUS = {
  "plan-basavi": {
    titre: "BASAVI, plan de tagging V1",
    lieu: "Docs · La Suite numérique",
    html:
      '<p class="fr-text--sm dop-sub">Annuaire des structures d\'aide aux femmes victimes de violences. Instrumentation front Matomo, site de préprod 168, site de prod 170.</p>' +
      '<h3 class="fr-h5">1. Contexte</h3>' +
      '<p>L\'annuaire est mesuré dans Matomo pour piloter son impact. L\'axe n°1 est la <b>mise en relation</b> : une session où une femme clique un contact (téléphone, e-mail, site) ou copie l\'adresse d\'une association.</p>' +
      '<h3 class="fr-h5">2. Prérequis techniques</h3>' +
      '<ul><li><b>SPA (Next.js)</b> : rejouer <code>setCustomUrl</code> puis <code>trackPageView</code> à chaque changement de route.</li>' +
      '<li><b>RGPD</b> : aucune donnée personnelle dans les événements ni les URL. Les termes de recherche ne sont jamais tagués.</li>' +
      '<li><b>Identifiant d\'association</b> passé dans le champ nom des événements de contact, sans dimension personnalisée.</li></ul>' +
      '<h3 class="fr-h5">3. Plan de tagging</h3>' +
      '<div class="fr-table fr-table--no-caption dop-table-wrap"><table><caption>Événements</caption><thead><tr><th>Catégorie</th><th>Action</th><th>Nom</th><th>Déclencheur</th></tr></thead><tbody>' +
      '<tr><td><code>recherche</code></td><td><code>lancer</code></td><td>saisie, geoloc, ville</td><td>Rechercher, Utiliser ma position, lien territoire</td></tr>' +
      '<tr><td><code>recherche</code></td><td><code>filtrer</code></td><td>violences-conjugales, violences-sexuelles…</td><td>Puces de filtre</td></tr>' +
      '<tr><td><code>contact</code></td><td><code>clic_telephone</code></td><td>id de l\'association</td><td>Lien tel:</td></tr>' +
      '<tr><td><code>contact</code></td><td><code>clic_email</code></td><td>id de l\'association</td><td>Lien mailto:</td></tr>' +
      '<tr><td><code>contact</code></td><td><code>copie_adresse</code></td><td>id de l\'association</td><td>Bouton « Copier l\'adresse »</td></tr>' +
      '<tr><td><code>contact</code></td><td><code>clic_site</code></td><td>id de l\'association</td><td>Lien vers le site web</td></tr>' +
      '<tr><td><code>erreur</code></td><td><code>404</code> / <code>500</code></td><td>url</td><td>Rendu de la page d\'erreur</td></tr>' +
      '</tbody></table></div>' +
      '<p class="fr-text--sm dop-sub fr-mt-2w">Version du 20/08/2026 · annexe prod du 24/09/2026 · historique des versions dans Docs.</p>'
  },
  "recette-basavi": {
    titre: "BASAVI, recette du tagging de prod",
    lieu: "Docs · La Suite numérique",
    html:
      '<p class="fr-text--sm dop-sub">Recette du 24/09/2026 sur le site Matomo 170, après l\'ouverture du site public le 23/09.</p>' +
      '<div class="fr-table fr-table--no-caption dop-table-wrap"><table><caption>Recette</caption><thead><tr><th>Contrôle</th><th>Résultat</th></tr></thead><tbody>' +
      '<tr><td>Recherche lancée (saisie, géolocalisation, ville)</td><td><p class="fr-badge fr-badge--sm fr-badge--success fr-badge--no-icon">Vu</p></td></tr>' +
      '<tr><td>Filtres, valeurs réelles</td><td><p class="fr-badge fr-badge--sm fr-badge--success fr-badge--no-icon">Vu</p></td></tr>' +
      '<tr><td>Carte, 4e mode d\'entrée</td><td><p class="fr-badge fr-badge--sm fr-badge--success fr-badge--no-icon">Vu</p></td></tr>' +
      '<tr><td>4 clics de contact, dont copie de l\'adresse</td><td><p class="fr-badge fr-badge--sm fr-badge--success fr-badge--no-icon">Vu</p></td></tr>' +
      '<tr><td>Collecte de 6h dans Grist</td><td><p class="fr-badge fr-badge--sm fr-badge--success fr-badge--no-icon">Vu</p></td></tr>' +
      '</tbody></table></div>'
  },
  "shell-vide": {
    titre: "Shell vide du tableau de bord",
    lieu: "GitHub · mesure-impact",
    html:
      '<p>Le point de départ de tout nouveau tableau de bord : le widget BASAVI vidé de ses données, avec la même structure.</p>' +
      '<ul><li>Une page Synthèse puis une page par pilier : Utilisable, Utilisé, Utile, Impactant.</li>' +
      '<li>Des cartes d\'indicateurs phares et périphériques, chacune avec sa source.</li>' +
      '<li>Des titres affirmatifs, aucune cible affichée.</li>' +
      '<li>Branché sur les tables Grist par l\'API des widgets, sans autre dépendance que le DSFR.</li></ul>' +
      '<p class="fr-text--sm dop-sub">À publier dans <code>produits/_gabarit/</code> du dépôt mesure-impact.</p>'
  }
};
