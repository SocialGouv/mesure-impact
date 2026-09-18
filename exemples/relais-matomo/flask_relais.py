"""Relais Matomo pour une application Python (Flask), sans dépendance en plus.

    from flask_relais import relais_matomo
    app.register_blueprint(relais_matomo())

Aucun hook `before_request` ne doit lire `request.form` ou `request.data` sur ces
deux chemins (CSRF compris) : le corps du hit serait consommé avant le relais.

Variables : MATOMO_URL (instance) et RELAIS_PREFIXE (ex. /k7f3a9).
Pour Django, la même logique tient dans une vue branchée sur les deux chemins.

Journalisation : exclure les deux chemins du relais du journal d'accès du serveur
WSGI (gunicorn y écrit la ligne de requête complète). La query string d'un hit porte
l'URL visitée, le titre de page et l'identifiant de visiteur : elle n'a rien à faire
dans les journaux du produit.
"""

import http.client
import ipaddress
import os
import urllib.error
import urllib.request

from flask import Blueprint, Response, abort, current_app, request

# Fichier exposé -> fichier Matomo et méthodes acceptées.
ROUTES = {
    "a.js": ("/matomo.js", {"GET"}),
    "c": ("/matomo.php", {"GET", "POST"}),
}
ENTETES_TRANSMIS = ["User-Agent", "Accept-Language", "Content-Type"]
ENTETES_RETOUR = ["Content-Type", "Cache-Control", "ETag", "Last-Modified"]
TAILLE_MAX = 64_000


class _SansRedirection(urllib.request.HTTPRedirectHandler):
    # Une redirection changerait le POST en GET et perdrait le corps : on renvoie la 3xx telle quelle.
    def redirect_request(self, *args, **kwargs):
        return None


OUVREUR = urllib.request.build_opener(_SansRedirection)


def _anonymiser_ip(ip):
    """Masque l'IP au niveau du contrat : /16 en IPv4, /48 en IPv6.

    Renvoie None si la forme n'est pas reconnue — mieux vaut aucune IP qu'une IP
    entière transmise par inadvertance.
    """
    try:
        adresse = ipaddress.ip_address(ip)
    except (ValueError, TypeError):
        return None
    if getattr(adresse, "ipv4_mapped", None):
        adresse = adresse.ipv4_mapped
    prefixe = 16 if adresse.version == 4 else 48
    return str(ipaddress.ip_network(f"{adresse}/{prefixe}", strict=False).network_address)


def relais_matomo(matomo_url=None, prefixe=None):
    matomo_url = matomo_url or os.environ["MATOMO_URL"]
    prefixe = prefixe or os.environ["RELAIS_PREFIXE"]
    bp = Blueprint("relais_matomo", __name__)

    @bp.route(f"{prefixe}/<fichier>", methods=["GET", "POST"], provide_automatic_options=False)
    def relais(fichier):
        route = ROUTES.get(fichier)
        # Flask ajoute HEAD aux routes GET : on s'en tient aux méthodes prévues.
        if route is None or request.method not in route[1]:
            abort(404)
        cible = route[0]

        corps = None
        if request.method == "POST":
            # Lecture bornée, y compris sans Content-Length (envoi par morceaux).
            corps = request.stream.read(TAILLE_MAX + 1)
            if len(corps) > TAILLE_MAX:
                abort(413)
            if not corps and (request.content_length or 0) > 0:
                abort(500, "relais Matomo : corps déjà lu avant le relais")

        entetes = {nom: request.headers[nom] for nom in ENTETES_TRANSMIS if nom in request.headers}
        # Une seule IP, masquée, celle vue par le produit : conserver l'en-tête reçu
        # laisserait le visiteur choisir l'IP enregistrée par Matomo. Derrière un proxy
        # de confiance, appliquer ProxyFix pour que remote_addr porte l'IP réelle.
        ip_anonymisee = _anonymiser_ip(request.remote_addr)
        if ip_anonymisee:
            entetes["X-Forwarded-For"] = ip_anonymisee

        query = request.query_string.decode()
        url = f"{matomo_url}{cible}" + (f"?{query}" if query else "")
        requete = urllib.request.Request(url, data=corps, headers=entetes, method=request.method)
        try:
            with OUVREUR.open(requete, timeout=5) as reponse:
                garder = {k: reponse.headers[k] for k in ENTETES_RETOUR if reponse.headers.get(k)}
                return Response(reponse.read(), status=reponse.status, headers=garder)
        except urllib.error.HTTPError as erreur:
            return Response(erreur.read(), status=erreur.code)
        except (OSError, http.client.HTTPException):
            # Sans cette trace, un relais cassé fait disparaître la mesure en silence.
            current_app.logger.exception("relais Matomo : échec de l'appel à Matomo")
            abort(502)

    return bp
