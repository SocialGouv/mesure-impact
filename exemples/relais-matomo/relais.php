<?php
// Relais Matomo pour une application PHP, sans dépendance (extension curl).
//
// À appeler en tête du front controller (index.php), avant le routeur de l'application :
//
//   require __DIR__ . '/relais.php';
//   if (relais_matomo((string) getenv('MATOMO_URL'), (string) getenv('RELAIS_PREFIXE'))) {
//       exit;
//   }
//
// Journalisation : exclure les deux chemins du relais du journal d'accès du serveur web
// placé devant PHP. La query string d'un hit porte l'URL visitée, le titre de page et
// l'identifiant de visiteur : elle n'a rien à faire dans les journaux du produit.

// Masque l'IP au niveau du contrat : deux octets en IPv4, 48 bits en IPv6. Chaîne vide si
// la forme n'est pas reconnue — mieux vaut aucune IP qu'une IP entière transmise par
// inadvertance.
function relais_matomo_ip_anonymisee(string $ip): string
{
    if (stripos($ip, '::ffff:') === 0) {
        $ip = substr($ip, 7);
    }
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false) {
        [$a, $b] = explode('.', $ip);
        return "$a.$b.0.0";
    }
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) !== false) {
        return (string) inet_ntop(substr((string) inet_pton($ip), 0, 6) . str_repeat("\0", 10));
    }
    return '';
}

function relais_matomo(string $matomoUrl, string $prefixe): bool
{
    if ($matomoUrl === '' || $prefixe === '') {
        return false; // relais non configuré : l'application continue normalement
    }

    // Fichier exposé -> fichier Matomo et méthodes acceptées.
    $routes = [
        $prefixe . '/a.js' => ['/matomo.js', ['GET']],
        $prefixe . '/c' => ['/matomo.php', ['GET', 'POST']],
    ];
    $chemin = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    if (!isset($routes[$chemin])) {
        return false; // pas pour le relais : l'application continue
    }
    [$cible, $methodes] = $routes[$chemin];

    $methode = $_SERVER['REQUEST_METHOD'];
    if (!in_array($methode, $methodes, true)) {
        http_response_code(404);
        return true;
    }

    $corps = null;
    if ($methode === 'POST') {
        // Lecture bornée, y compris sans Content-Length.
        $corps = (string) stream_get_contents(fopen('php://input', 'rb'), 64001);
        if (strlen($corps) > 64000) {
            http_response_code(413);
            return true;
        }
    }

    $entetes = [];
    foreach (['HTTP_USER_AGENT' => 'User-Agent', 'HTTP_ACCEPT_LANGUAGE' => 'Accept-Language', 'CONTENT_TYPE' => 'Content-Type'] as $cle => $nom) {
        if (!empty($_SERVER[$cle])) {
            $entetes[] = "$nom: {$_SERVER[$cle]}";
        }
    }
    // Une seule IP, masquée, celle vue par le produit : conserver l'en-tête reçu
    // laisserait le visiteur choisir l'IP enregistrée par Matomo. Derrière un proxy de
    // confiance, reprendre l'IP réelle résolue par l'application.
    $ipAnonymisee = relais_matomo_ip_anonymisee((string) ($_SERVER['REMOTE_ADDR'] ?? ''));
    if ($ipAnonymisee !== '') {
        $entetes[] = "X-Forwarded-For: $ipAnonymisee";
    }

    $retour = [];
    $query = $_SERVER['QUERY_STRING'] ?? '';
    $ch = curl_init($matomoUrl . $cible . ($query !== '' ? "?$query" : ''));
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $methode,
        CURLOPT_HTTPHEADER => $entetes,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 5,
        CURLOPT_HEADERFUNCTION => function ($ch, $ligne) use (&$retour) {
            if (preg_match('/^(Content-Type|Cache-Control|ETag|Last-Modified):/i', $ligne)) {
                $retour[] = trim($ligne);
            }
            return strlen($ligne);
        },
    ]);
    if ($corps !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $corps);
    }

    $reponse = curl_exec($ch);
    if ($reponse === false) {
        // Sans cette trace, un relais cassé fait disparaître la mesure en silence.
        error_log('relais Matomo : échec de l\'appel à Matomo : ' . curl_error($ch));
        http_response_code(502);
        return true;
    }
    http_response_code(curl_getinfo($ch, CURLINFO_RESPONSE_CODE));
    foreach ($retour as $ligne) {
        header($ligne, false);
    }
    echo $reponse;
    return true;
}
