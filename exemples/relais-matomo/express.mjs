// Relais Matomo pour une application Node.js (Express).
//
//   import { relaisMatomo } from "./express.mjs";
//   app.use(relaisMatomo());
//
// Variables : MATOMO_URL (instance) et RELAIS_PREFIXE (ex. /k7f3a9).
import express from "express";

const ROUTES = { "a.js": "/matomo.js", c: "/matomo.php" };
const ENTETES_TRANSMIS = ["user-agent", "accept-language", "content-type"];
const TAILLE_MAX = 64_000;

export function relaisMatomo({
  matomoUrl = process.env.MATOMO_URL,
  prefixe = process.env.RELAIS_PREFIXE,
} = {}) {
  const router = express.Router();

  router.all(
    `${prefixe}/:fichier`,
    express.raw({ type: () => true, limit: TAILLE_MAX }),
    async (req, res) => {
      const cible = ROUTES[req.params.fichier];
      if (!cible || !["GET", "POST"].includes(req.method)) return res.sendStatus(404);

      const query = req.originalUrl.split("?")[1] ?? "";
      const corps = req.method === "POST" && Buffer.isBuffer(req.body) ? req.body : undefined;
      if (/token_auth/i.test(query) || corps?.includes("token_auth")) return res.sendStatus(400);

      const entetes = {};
      for (const nom of ENTETES_TRANSMIS) if (req.headers[nom]) entetes[nom] = req.headers[nom];
      entetes["x-forwarded-for"] = [req.headers["x-forwarded-for"], req.socket.remoteAddress]
        .filter(Boolean)
        .join(", ");

      try {
        const reponse = await fetch(`${matomoUrl}${cible}${query ? `?${query}` : ""}`, {
          method: req.method,
          headers: entetes,
          body: corps,
          signal: AbortSignal.timeout(5000),
        });
        res.status(reponse.status);
        for (const nom of ["content-type", "cache-control"]) {
          const valeur = reponse.headers.get(nom);
          if (valeur) res.set(nom, valeur);
        }
        res.send(Buffer.from(await reponse.arrayBuffer()));
      } catch {
        res.sendStatus(502);
      }
    },
  );

  return router;
}
