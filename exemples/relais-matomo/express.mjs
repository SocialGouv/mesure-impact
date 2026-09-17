// Relais Matomo pour une application Node.js (Express).
//
//   import { relaisMatomo } from "./express.mjs";
//   app.use(relaisMatomo());   // AVANT express.json(), express.urlencoded() et tout middleware CSRF
//
// Variables : MATOMO_URL (instance) et RELAIS_PREFIXE (ex. /k7f3a9).
import express from "express";

// Fichier exposé -> fichier Matomo et méthodes acceptées.
const ROUTES = {
  "a.js": { cible: "/matomo.js", methodes: ["GET"] },
  c: { cible: "/matomo.php", methodes: ["GET", "POST"] },
};
const ENTETES_TRANSMIS = ["user-agent", "accept-language", "content-type"];
const TAILLE_MAX = 64_000;

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
      // Une seule IP, celle vue par le produit : conserver l'en-tête reçu laisserait le
      // visiteur choisir l'IP enregistrée par Matomo. Derrière un proxy de confiance,
      // poser app.set("trust proxy", ...) et utiliser req.ip.
      entetes["x-forwarded-for"] = req.ip ?? req.socket.remoteAddress;

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
