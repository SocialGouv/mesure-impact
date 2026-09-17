# Collecter malgré les bloqueurs : le relais Matomo

**Statut** : proposition, à valider par le studio tech · **Décision** : [`decisions/0004`](decisions/0004-collecte-client-side-via-relais.md)

## Le problème

Les bloqueurs de publicité installés sur les postes agents (uBlock) coupent la mesure Matomo.
Ils reconnaissent l'adresse de l'instance et les fichiers `matomo.js` et `matomo.php`. Les
visites bloquées n'apparaissent nulle part : le tableau de bord sous-estime l'usage sans le
signaler.

## Le principe

La page ne parle plus à Matomo directement. Elle appelle **deux adresses neutres sur le domaine
du produit**, que le serveur du produit relaie vers Matomo.

```
Avant   navigateur ──────────────────────────────> matomo.fabrique.social.gouv.fr/matomo.php   (bloqué)

Après   navigateur ──> monproduit.gouv.fr/k7f3a9/c ──(relais)──> matomo.fabrique.social.gouv.fr/matomo.php
```

La mesure reste **côté navigateur** : cookie Matomo, events, dimensions et plan de tagging ne
changent pas. Seules les deux adresses du snippet changent.

## Le contrat, identique pour tous les produits

| | Règle |
|---|---|
| Préfixe | Un segment neutre propre au produit, par exemple `/k7f3a9`. Jamais `matomo`, `piwik`, `stats`, `track`, `analytics`. |
| `<préfixe>/a.js` | `GET` uniquement, relayé vers `matomo.js` |
| `<préfixe>/c` | `GET` et `POST`, relayé vers `matomo.php` |
| Tout le reste | Refusé (404). Le relais ne donne jamais accès à l'API ni à l'interface de Matomo. |
| En-têtes transmis | `User-Agent`, `Accept-Language`, `Content-Type`, et l'IP dans `X-Forwarded-For` |
| En-têtes jamais transmis | `Cookie`, `Authorization` : la session du produit ne part pas chez Matomo |
| Refus | Toute requête contenant `token_auth` (400), corps de plus de 64 Ko |
| Délai | 5 secondes au plus vers Matomo |

## Le snippet dans la page

Le snippet Matomo habituel, avec les deux adresses du relais :

```html
<script>
  var _paq = (window._paq = window._paq || []);
  _paq.push(["trackPageView"]);
  _paq.push(["enableLinkTracking"]);
  (function () {
    var u = "/k7f3a9/";
    _paq.push(["setTrackerUrl", u + "c"]);
    _paq.push(["setSiteId", "162"]);
    var d = document, g = d.createElement("script"), s = d.getElementsByTagName("script")[0];
    g.async = true;
    g.src = u + "a.js";
    s.parentNode.insertBefore(g, s);
  })();
</script>
```

Les events (`_paq.push(["trackEvent", ...])`) s'écrivent exactement comme avant.

## Mettre en place le relais

Choisir **une** implémentation, de préférence la première.

| Stack du produit | Exemple | Code applicatif |
|---|---|---|
| Tout produit derrière nginx | [`nginx.conf`](../exemples/relais-matomo/nginx.conf) | Aucun |
| Node.js (Express) | [`express.mjs`](../exemples/relais-matomo/express.mjs) | Un `app.use` |
| PHP | [`relais.php`](../exemples/relais-matomo/relais.php) | Deux lignes dans le front controller |
| Python (Flask, logique transposable à Django) | [`flask_relais.py`](../exemples/relais-matomo/flask_relais.py) | Un `register_blueprint` |
| Next.js | [`@socialgouv/matomo-next`](https://github.com/SocialGouv/matomo-next), voir ci-dessous | Configuration du paquet |

Chaque exemple applique le contrat ci-dessus. Les quatre premiers ont été vérifiés contre un
Matomo simulé : script et hits relayés (`GET` et `POST`), en-têtes transmis, cookie retiré,
autres chemins, `token_auth` et méthodes non prévues refusés. L'exemple Express a aussi été
branché sur une vraie instance Matomo : les events envoyés en `GET` et en `POST` via le relais
sont bien enregistrés.

**Next.js.** `matomo-next` fournit déjà le relais, avec un préfixe et des noms de fichiers
régénérés à chaque build. Son gestionnaire relaie cependant **tout chemin** vers l'instance.
Pour respecter le contrat, n'exposer que ses deux fichiers :

```ts
// app/api/mp/[...path]/route.ts
import { createMatomoProxyHandler } from "@socialgouv/matomo-next/lib/server-proxy";

const relais = createMatomoProxyHandler();
const FICHIERS = [
  process.env.NEXT_PUBLIC_MATOMO_PROXY_JS_TRACKER_FILE,
  process.env.NEXT_PUBLIC_MATOMO_PROXY_PHP_TRACKER_FILE,
];

async function filtrer(methode: "GET" | "POST", req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await ctx.params;
  if (path.length !== 1 || !FICHIERS.includes(path[0])) return new Response(null, { status: 404 });
  return relais[methode](req, ctx);
}

export const GET = (req: Request, ctx: any) => filtrer("GET", req, ctx);
export const POST = (req: Request, ctx: any) => filtrer("POST", req, ctx);
```

## Recette

1. **Depuis n'importe quel poste** :
   `exemples/relais-matomo/verifier-relais.sh https://monproduit.gouv.fr/k7f3a9`
   (script servi, collecte joignable, autres chemins et `token_auth` refusés).
2. **Depuis un poste agent équipé du bloqueur**, le seul test qui compte : naviguer sur le
   produit, puis vérifier dans Matomo (Visites en temps réel) que la visite et ses events
   arrivent.
3. **Dans Matomo** : le rapport appareils et navigateurs est varié (s'il ne montre qu'un seul
   navigateur, le `User-Agent` n'est pas transmis).

## Limites connues

- **Aucune garantie définitive.** Les noms sont masqués, mais chaque hit porte toujours les
  paramètres Matomo (`idsite`, `rec`, `action_name`). Une liste de blocage qui filtre sur ces
  paramètres bloquerait encore. D'où l'étape 2 de la recette, à refaire si le bloqueur change
  de listes.
- **L'adresse IP.** Matomo n'utilise l'IP de `X-Forwarded-For` que si l'instance est réglée
  pour lui faire confiance. Sinon, tous les hits portent l'IP du serveur du produit : la
  géolocalisation devient fausse, et la distinction des visiteurs repose sur le cookie Matomo.
  À régler au niveau de l'instance.
- **Le cookie Matomo reste déposé.** Les obligations d'information des utilisateurs sont
  inchangées par rapport à une intégration classique.
- **Préfixe fixe.** Les exemples utilisent un préfixe choisi une fois. Le changer à chaque
  déploiement (variable d'environnement) rend le blocage plus difficile.
