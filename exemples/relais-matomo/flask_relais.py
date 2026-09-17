"""Relais Matomo pour une application Python (Flask), sans dépendance en plus.

    from flask_relais import relais_matomo
    app.register_blueprint(relais_matomo())

Variables : MATOMO_URL (instance) et RELAIS_PREFIXE (ex. /k7f3a9).
Pour Django, la même logique tient dans une vue branchée sur les deux chemins.
"""

import os
import urllib.error
import urllib.request

from flask import Blueprint, Response, abort, request

ROUTES = {"a.js": "/matomo.js", "c": "/matomo.php"}
ENTETES_TRANSMIS = ["User-Agent", "Accept-Language", "Content-Type"]
TAILLE_MAX = 64_000


def relais_matomo(matomo_url=None, prefixe=None):
    matomo_url = matomo_url or os.environ["MATOMO_URL"]
    prefixe = prefixe or os.environ["RELAIS_PREFIXE"]
    bp = Blueprint("relais_matomo", __name__)

    @bp.route(f"{prefixe}/<fichier>", methods=["GET", "POST"])
    def relais(fichier):
        cible = ROUTES.get(fichier)
        if cible is None:
            abort(404)

        query = request.query_string.decode()
        corps = None
        if request.method == "POST":
            if (request.content_length or 0) > TAILLE_MAX:
                abort(413)
            corps = request.get_data()
        if "token_auth" in query or (corps and b"token_auth" in corps):
            abort(400)

        entetes = {nom: request.headers[nom] for nom in ENTETES_TRANSMIS if nom in request.headers}
        entetes["X-Forwarded-For"] = ", ".join(
            filter(None, [request.headers.get("X-Forwarded-For"), request.remote_addr])
        )

        url = f"{matomo_url}{cible}" + (f"?{query}" if query else "")
        requete = urllib.request.Request(url, data=corps, headers=entetes, method=request.method)
        try:
            with urllib.request.urlopen(requete, timeout=5) as reponse:
                garder = {k: reponse.headers[k] for k in ("Content-Type", "Cache-Control") if reponse.headers.get(k)}
                return Response(reponse.read(), status=reponse.status, headers=garder)
        except urllib.error.HTTPError as erreur:
            return Response(erreur.read(), status=erreur.code)
        except OSError:
            abort(502)

    return bp
