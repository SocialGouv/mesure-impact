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
| En-têtes transmis | `User-Agent`, `Accept-Language`, `Content-Type`, et l'IP du client vue par le produit dans `X-Forwarded-For`, qui **remplace** l'en-tête reçu. `Accept-Encoding` pour le script est facultatif (script compressé) |
| IP transmise | **Déjà masquée par le relais** : deux octets en IPv4 (`81.250.0.0`), 48 bits en IPv6 (`2001:db8:85a3::`). Une forme non reconnue n'envoie aucun en-tête plutôt qu'une IP entière. |
| En-têtes jamais transmis | Tous les autres : cookies, `Authorization`, jetons, en-têtes d'authentification ajoutés en amont. La session du produit ne part pas chez Matomo. |
| Corps | 64 Ko au plus, lus en entier par le relais, jamais par un middleware avant lui |
| Délai | Requête vers Matomo abandonnée après 5 secondes sans réponse |
| Journalisation | Les deux chemins du relais sont **exclus du journal d'accès** du produit : la query string d'un hit porte l'URL visitée, le titre de page et l'identifiant de visiteur. |

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
| Tout produit derrière nginx | [`nginx.conf`](../exemples/relais-matomo/nginx.conf) | Un `map` au niveau `http`, trois blocs `location`, aucun code |
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

Le masquage de l'IP est écrit quatre fois, dans quatre langages : les quatre implémentations
ont été exécutées côte à côte (nginx 1.27, Node, Python 3, PHP 8.3) sur le même jeu d'adresses
— IPv4, IPv4 en IPv6 (`::ffff:`), IPv6 pleine, IPv6 compressée, lien-local, boucle locale — et
rendent toutes la même valeur. C'est ce banc qui a fait tomber deux gabarits produisant
l'adresse invalide `2001:db8:::`.

**Next.js.** `matomo-next` fournit déjà le relais, avec un préfixe et des noms de fichiers
régénérés à chaque build. Son gestionnaire relaie cependant **tout chemin** vers l'instance.
Le filtre ci-dessous limite le relais à ses deux fichiers :

```ts
// app/api/mp/[...path]/route.ts
import { createMatomoProxyHandler } from "@socialgouv/matomo-next/lib/server-proxy";
// Même masquage que les autres exemples, à recopier depuis exemples/relais-matomo/express.mjs.
import { anonymiserIp } from "./anonymiser-ip";

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

  // Le gestionnaire transmet le X-Forwarded-For reçu tel quel : on ne garde que la dernière
  // entrée, celle ajoutée par l'ingress, sinon un visiteur choisirait l'IP enregistrée, et on
  // la masque avant de la laisser partir.
  const entetes = new Headers(req.headers);
  const chaine = (req.headers.get("x-forwarded-for") ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  const ipAnonymisee = chaine.length > 0 ? anonymiserIp(chaine[chaine.length - 1]) : undefined;
  if (ipAnonymisee) entetes.set("x-forwarded-for", ipAnonymisee);
  else entetes.delete("x-forwarded-for");
  const requete = new Request(req.url, { method: req.method, headers: entetes, body: req.body, duplex: "half" } as RequestInit);

  return relais[methode](requete, ctx);
}

export const GET = (req: Request, ctx: any) => filtrer("GET", req, ctx);
export const POST = (req: Request, ctx: any) => filtrer("POST", req, ctx);
```

Le filtrage des chemins a été testé avec Next.js 15.5 et `matomo-next` 1.14.2 : seuls les deux
fichiers générés au build sont relayés, et l'IP transmise est celle ajoutée par le proxy placé
devant l'application. Le masquage de l'IP, ajouté ensuite, n'a été vérifié que sur les quatre
autres exemples. Sans proxy de confiance devant l'application, retirer l'en-tête au lieu de le
réécrire, et ne pas déclarer l'IP du produit dans `proxy_ips[]` côté instance.

Le reste du contrat n'est pas couvert par `matomo-next` : pas de limite de corps ni de délai.
À compléter côté plateforme (limite de taille et délai à l'ingress) ou dans `filtrer`. Penser
aussi à exclure les deux chemins du journal d'accès.

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
   navigateur, le `User-Agent` n'est pas transmis), et la localisation s'arrête à la région,
   jamais à la ville — c'est le signe que le relais masque bien l'IP. Une seule ville pour tous
   les hits signale l'inverse : le relais transmet l'IP du serveur, pas celle du visiteur.
4. **Dans les journaux du produit** : aucune ligne pour les deux chemins du relais. Une query
   string de hit qui y apparaît porte l'URL visitée et l'identifiant de visiteur.

## Limites connues

- **Aucune garantie définitive.** Vérifié le 17/09/2026 : EasyList, EasyPrivacy, les listes
  uBlock, Peter Lowe et AdGuard Tracking bloquent `matomo.js` et `matomo.php` mais laissent
  passer les adresses du relais. Une liste future pourrait filtrer sur les paramètres des
  hits (`idsite`, `rec`, `action_name`). D'où l'étape 2 de la recette, à refaire si le
  bloqueur change de listes.
- **Heatmaps, enregistrements de session et Overlay** ne passent pas par le relais : ces
  plugins appellent d'autres fichiers de Matomo (`plugins/...`), que le contrat n'expose pas.
  Un produit qui les utilise les garde en direct ou demande l'extension du contrat.
- **L'adresse IP est transmise déjà masquée.** Matomo ignore `X-Forwarded-For` tant que
  l'instance n'est pas réglée pour lui faire confiance : `proxy_client_headers[] =
  HTTP_X_FORWARDED_FOR`, `proxy_ip_read_last_in_list = 1`, et dans `proxy_ips[]` l'adresse par
  laquelle les relais sortent. Sans ce réglage, tous les hits portent l'IP du serveur du
  produit : la géolocalisation devient fausse et la distinction des visiteurs repose sur le
  seul cookie Matomo — les visiteurs sans cookie fusionnent alors en un seul, silencieusement.

  Deux raisons de masquer l'IP dans le relais plutôt que de laisser l'instance le faire :

  - **La confiance accordée ne se limite pas au relais.** Sur Kubernetes, les produits sortent
    par une adresse partagée : déclarer « l'IP du relais » dans `proxy_ips[]` revient à faire
    confiance au `X-Forwarded-For` de tout ce qui sort par là. Une IP déjà masquée réduit ce
    qu'une usurpation rapporte au niveau d'une région.
  - **Le masquage voyage avec la donnée.** Il ne dépend pas d'un réglage d'instance qu'un
    produit ne contrôle pas et ne voit pas.

  Les exemples envoient **une seule IP**, masquée, et écrasent l'en-tête reçu : un visiteur ne
  peut pas choisir l'IP enregistrée. Un relais qui se contenterait d'ajouter son IP à l'en-tête
  reçu la rendrait falsifiable dès que son adresse figure dans `proxy_ips[]`.

  **Le produit doit d'abord connaître l'IP réelle de son visiteur.** Derrière un ingress, sans
  `set_real_ip_from` (nginx), `trust proxy` (Express) ou `ProxyFix` (Flask), le relais voit
  l'IP du pod ingress : tous les hits porteront la même valeur et régler l'instance ne
  rapportera rien. À valider avec les opérateurs de l'instance.
- **Le relais n'ajoute pas de droits**, à condition d'écraser `X-Forwarded-For` comme le font
  les exemples. `matomo.php` est déjà public : ce qui passe par le relais (y compris une requête
  portant un `token_auth`) pouvait être envoyé directement à l'instance. Seule différence, ces
  requêtes portent l'IP du serveur du produit. Filtrer `token_auth` a été écarté : les variantes
  d'écriture que Matomo accepte sont trop nombreuses pour un filtre fiable, et le filtre
  bloquait des hits légitimes. Un filtre qui énumère des orthographes certifie une orthographe,
  pas un comportement. Ce qui reste à traiter n'est pas un droit d'accès mais une trace : la
  query string relayée n'a pas à atterrir dans les journaux du produit, d'où la ligne
  « Journalisation » du contrat.
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
