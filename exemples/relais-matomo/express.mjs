// Relais Matomo pour une application Node.js (Express).
//
//   import { relaisMatomo } from "./express.mjs";
//   app.use(relaisMatomo());   // AVANT express.json(), express.urlencoded() et tout middleware CSRF
//
// Variables : MATOMO_URL (instance) et RELAIS_PREFIXE (ex. /k7f3a9).
//
// Journalisation : exclure les deux chemins du relais du logger d'accès (avec morgan,
// l'option `skip`). La query string d'un hit porte l'URL visitée, le titre de page et
// l'identifiant de visiteur : elle n'a rien à faire dans les journaux du produit.
import express from "express";

// Fichier exposé -> fichier Matomo et méthodes acceptées.
const ROUTES = {
  "a.js": { cible: "/matomo.js", methodes: ["GET"] },
  c: { cible: "/matomo.php", methodes: ["GET", "POST"] },
};
const ENTETES_TRANSMIS = ["user-agent", "accept-language", "content-type"];
const TAILLE_MAX = 64_000;

// L'IP transmise à Matomo est masquée au niveau du contrat : deux octets pour IPv4,
// les 48 premiers bits pour IPv6. Une forme non reconnue ne donne aucune IP, plutôt
// qu'une IP entière transmise par inadvertance.
function anonymiserIp(ip) {
  if (!ip) return undefined;
  const octets = ip.replace(/^::ffff:/i, "").split(".");
  if (octets.length === 4 && octets.every((o) => /^\d{1,3}$/.test(o))) {
    return `${octets[0]}.${octets[1]}.0.0`;
  }
  if (!ip.includes(":")) return undefined;

  // La forme compressée doit être développée en 8 groupes avant d'être tronquée :
  // découper naïvement sur « : » produirait « 2001:db8::: » pour « 2001:db8::1 ».
  const [avant, apres] = ip.split("::");
  const tete = avant ? avant.split(":") : [];
  const queue = apres ? apres.split(":") : [];
  const groupes =
    apres === undefined
      ? tete
      : [...tete, ...Array(8 - tete.length - queue.length).fill("0"), ...queue];
  if (groupes.length !== 8 || !groupes.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return undefined;

  const gardes = groupes.slice(0, 3).map((g) => g.replace(/^0+(?=.)/, "").toLowerCase());
  while (gardes.length > 1 && gardes[gardes.length - 1] === "0") gardes.pop();
  return gardes[0] === "0" ? "::" : `${gardes.join(":")}::`;
}

export function relaisMatomo({
  matomoUrl = process.env.MATOMO_URL,
  prefixe = process.env.RELAIS_PREFIXE,
} = {}) {
  if (!matomoUrl || !prefixe) throw new Error("relaisMatomo : MATOMO_URL et RELAIS_PREFIXE sont requis");
  const router = express.Router({ caseSensitive: true, strict: true });

  router.all(
    `${prefixe}/:fichier`,
    express.raw({ type: () => true, limit: TAILLE_MAX }),
    async (req, res) => {
      const route = Object.hasOwn(ROUTES, req.params.fichier) ? ROUTES[req.params.fichier] : undefined;
      if (!route || !route.methodes.includes(req.method)) return res.sendStatus(404);

      let corps;
      if (req.method === "POST") {
        // Un parseur monté avant le relais a déjà lu le corps : le hit serait perdu en silence.
        if (!Buffer.isBuffer(req.body)) return res.status(500).send("relais Matomo monté après un parseur de corps");
        corps = req.body;
      }

      const entetes = {};
      for (const nom of ENTETES_TRANSMIS) if (req.headers[nom]) entetes[nom] = req.headers[nom];
      // Une seule IP, masquée, celle vue par le produit : conserver l'en-tête reçu
      // laisserait le visiteur choisir l'IP enregistrée par Matomo. Derrière un proxy de
      // confiance, désigner précisément le saut : app.set("trust proxy", 1) (nombre de
      // proxys) ou le CIDR du proxy. Jamais `true` : req.ip prendrait alors la première
      // entrée de l'en-tête reçu, donc une valeur choisie par le visiteur.
      const ipAnonymisee = anonymiserIp(req.ip ?? req.socket.remoteAddress);
      if (ipAnonymisee) entetes["x-forwarded-for"] = ipAnonymisee;

      const query = req.originalUrl.split("?")[1] ?? "";
      try {
        const reponse = await fetch(`${matomoUrl}${route.cible}${query ? `?${query}` : ""}`, {
          method: req.method,
          headers: entetes,
          body: corps,
          // Une redirection changerait le POST en GET et perdrait le corps : on échoue (502).
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        });
        const contenu = Buffer.from(await reponse.arrayBuffer());
        res.status(reponse.status);
        for (const nom of ["content-type", "cache-control", "etag", "last-modified"]) {
          const valeur = reponse.headers.get(nom);
          if (valeur) res.set(nom, valeur);
        }
        res.send(contenu);
      } catch (erreur) {
        // Sans cette trace, un relais cassé fait disparaître la mesure en silence.
        console.error("relais Matomo : échec de l'appel à Matomo", erreur);
        res.sendStatus(502);
      }
    },
  );

  return router;
}
