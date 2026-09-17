# Collecter malgré les bloqueurs : le relais Matomo

**Statut** : proposition, à valider par le studio tech · **Décision** : [`decisions/0004`](decisions/0004-collecte-client-side-via-relais.md)

## Le problème

Les bloqueurs de publicité installés sur les postes agents (uBlock) coupent la mesure Matomo.
Leurs listes bloquent l'adresse de l'instance et les fichiers `matomo.js` et `matomo.php`. Les
visites bloquées n'apparaissent nulle part : le tableau de bord sous-estime l'usage sans le
signaler.

## Le principe

La page ne parle plus à Matomo directement. Elle appelle **deux adresses neutres sur le domaine
du produit**, que le serveur du produit relaie vers Matomo.

```
Avant   navigateur ──────────────────────────────> matomo.fabrique.social.gouv.fr/matomo.php   (bloqué)

Après   navigateur ──> monproduit.gouv.fr/k7f3a9/c ──(relais)──> matomo.fabrique.social.gouv.fr/matomo.php
```

La mesure reste **côté navigateur** : cookie Matomo, pages vues, events et dimensions
fonctionnent comme avant, le plan de tagging ne change pas. Seules les deux adresses du snippet
changent. Exception : les heatmaps, enregistrements de session et l'Overlay (voir les limites).

## Le contrat, identique pour tous les produits

| | Règle |
|---|---|
| Préfixe | Un segment neutre propre au produit, par exemple `/k7f3a9`. Jamais `matomo`, `piwik`, `stats`, `track`, `analytics`. |
| `<préfixe>/a.js` | `GET` uniquement, relayé vers `matomo.js` |
| `<préfixe>/c` | `GET` et `POST`, relayé vers `matomo.php` |
| Tout le reste | Jamais relayé vers Matomo : ni l'API, ni l'interface, ni d'autres fichiers. |
| En-têtes transmis | `User-Agent`, `Accept-Language`, `Content-Type`, l'IP dans `X-Forwarded-For`. `Accept-Encoding` pour le script est facultatif (script compressé) |
| En-têtes jamais transmis | Tous les autres : cookies, `Authorization`, jetons, en-têtes d'authentification ajoutés en amont. La session du produit ne part pas chez Matomo. |
| Corps | 64 Ko au plus, lus en entier par le relais, jamais par un middleware avant lui |
| Délai | Requête vers Matomo abandonnée après 5 secondes sans réponse |

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

| Stack du produit | Exemple | Intégration |
|---|---|---|
| Tout produit derrière nginx | [`nginx.conf`](../exemples/relais-matomo/nginx.conf) | Trois blocs `location`, aucun code |
| Node.js (Express) | [`express.mjs`](../exemples/relais-matomo/express.mjs) | Un `app.use`, **avant** les parseurs de corps et le CSRF |
| PHP | [`relais.php`](../exemples/relais-matomo/relais.php) | Un `require` et un `if` en tête du front controller |
| Python (Flask, logique transposable à Django) | [`flask_relais.py`](../exemples/relais-matomo/flask_relais.py) | Un `register_blueprint`, sans hook qui lit le corps sur ces chemins |
| Next.js | [`@socialgouv/matomo-next`](https://github.com/SocialGouv/matomo-next), voir ci-dessous | Configuration du paquet |

**Pourquoi l'ordre compte.** Par défaut, `matomo.js` envoie **tous** ses hits en `POST`
(`sendBeacon`), le corps n'étant rempli que pour les hits longs et les envois groupés. Un
parseur de corps ou une protection CSRF placés avant le relais font perdre les hits sans
aucune erreur dans la page. Les exemples Express et Flask répondent 500 si le corps a déjà été
lu, ce qui se voit dans les journaux du serveur et fait échouer `verifier-relais.sh`. Pour
Django, exempter la vue du CSRF.

Les quatre premiers exemples ont été vérifiés contre un Matomo simulé et contre une vraie
instance : hits `GET`, `POST` et groupés enregistrés, seuls les en-têtes du navigateur prévus par le
contrat transmis, autres chemins et méthodes non relayés, corps de plus de 64 Ko refusé (y
compris envoyé par morceaux), abandon après 5 secondes sans réponse. Le
snippet a été vérifié dans un vrai navigateur à travers le relais Express : page vue, event et
lien sortant enregistrés.

**Next.js.** `matomo-next` fournit déjà le relais, avec un préfixe et des noms de fichiers
régénérés à chaque build. Son gestionnaire relaie cependant **tout chemin** vers l'instance.
Le filtre ci-dessous limite le relais à ses deux fichiers :

```ts
// app/api/mp/[...path]/route.ts
import { createMatomoProxyHandler } from "@socialgouv/matomo-next/lib/server-proxy";

const relais = createMatomoProxyHandler();
const FICHIERS = [
  process.env.NEXT_PUBLIC_MATOMO_PROXY_JS_TRACKER_FILE,
  process.env.NEXT_PUBLIC_MATOMO_PROXY_PHP_TRACKER_FILE,
];
// Sans ces variables (posées au build par withMatomoProxy), tout serait refusé en silence.
if (FICHIERS.some((f) => !f)) {
  throw new Error("Relais Matomo : withMatomoProxy n'a pas posé les noms de fichiers");
}

async function filtrer(methode: "GET" | "POST", req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await ctx.params;
  if (path.length !== 1 || !FICHIERS.includes(path[0])) return new Response(null, { status: 404 });
  return relais[methode](req, ctx);
}

export const GET = (req: Request, ctx: any) => filtrer("GET", req, ctx);
export const POST = (req: Request, ctx: any) => filtrer("POST", req, ctx);
```

Filtre testé avec Next.js 15.5 et `matomo-next` 1.14.2 : seuls les deux fichiers générés au
build sont relayés. Il ne couvre que les chemins. Le gestionnaire de `matomo-next` n'applique pas le reste
du contrat : pas de limite de corps ni de délai, et il transmet tel quel le `X-Forwarded-For`
reçu. À compléter côté plateforme (limite de taille et délai à l'ingress) ou dans `filtrer`.

## Recette

1. **Depuis n'importe quel poste** :
   `exemples/relais-matomo/verifier-relais.sh https://monproduit.gouv.fr/k7f3a9`
   (script servi par Matomo, `POST` relayé jusqu'à Matomo, aucune réponse de Matomo sur
   d'autres chemins). Aucun hit n'est enregistré. Pour Next.js, passer en plus les deux noms
   générés au build : `verifier-relais.sh https://monproduit.gouv.fr/api/a1b2c3 s1234.js t5678`.
2. **Depuis un poste agent équipé du bloqueur**, le seul test qui compte : naviguer sur le
   produit, puis vérifier dans Matomo (Visites en temps réel) que la visite et ses events
   arrivent.
3. **Dans Matomo** : le rapport appareils et navigateurs est varié (s'il ne montre qu'un seul
   navigateur, le `User-Agent` n'est pas transmis).

## Limites connues

- **Aucune garantie définitive.** Vérifié le 17/09/2026 : EasyList, EasyPrivacy, les listes
  uBlock, Peter Lowe et AdGuard Tracking bloquent `matomo.js` et `matomo.php` mais laissent
  passer les adresses du relais. Une liste future pourrait filtrer sur les paramètres des
  hits (`idsite`, `rec`, `action_name`). D'où l'étape 2 de la recette, à refaire si le
  bloqueur change de listes.
- **Heatmaps, enregistrements de session et Overlay** ne passent pas par le relais : ces
  plugins appellent d'autres fichiers de Matomo (`plugins/...`), que le contrat n'expose pas.
  Un produit qui les utilise les garde en direct ou demande l'extension du contrat.
- **L'adresse IP.** Matomo ignore `X-Forwarded-For` tant que l'instance n'est pas réglée pour
  lui faire confiance. Sinon, tous les hits portent l'IP du serveur du produit : la
  géolocalisation devient fausse et la distinction des visiteurs repose sur le cookie Matomo.
  Le réglage se fait sur l'instance : `proxy_client_headers[] = HTTP_X_FORWARDED_FOR`, et dans
  `proxy_ips[]` les IP des relais **et des proxys placés devant eux** (ingress, répartiteur de
  charge), en gardant `proxy_ip_read_last_in_list = 1`. Matomo lit alors l'en-tête quelle que
  soit la source : un visiteur qui appelle l'instance en direct peut fixer l'IP enregistrée,
  sauf si le proxy devant Matomo ajoute l'IP réelle en fin d'en-tête. À valider avec les
  opérateurs de l'instance.
- **Le relais n'ajoute pas de droits.** `matomo.php` est déjà public : ce qui passe par le relais
  (y compris une requête portant un `token_auth`) pouvait être envoyé directement à l'instance.
  Seule différence, ces requêtes portent l'IP du serveur du produit. Filtrer `token_auth` a été
  écarté : les variantes d'écriture que Matomo accepte sont trop nombreuses pour un filtre
  fiable, et le filtre bloquait des hits légitimes.
- **Pas de limite de débit dans les exemples.** Tous les hits relayés portant l'IP du serveur du
  produit, Matomo ne peut pas bloquer un abus sans bloquer tout le produit. Si le risque
  compte, limiter le débit au niveau de l'ingress ou du relais.
- **Les redirections ne sont pas suivies.** Une redirection changerait le `POST` en `GET` et
  perdrait le corps : `MATOMO_URL` doit pointer directement sur l'instance (`https`, sans
  redirection). Le relais renvoie alors une erreur visible plutôt qu'un hit tronqué.
- **Le cookie Matomo reste déposé.** Les obligations d'information des utilisateurs sont
  inchangées par rapport à une intégration classique.
- **Préfixe fixe.** Les exemples utilisent un préfixe choisi une fois. Le changer à chaque
  déploiement (variable d'environnement) rend le blocage plus difficile.
