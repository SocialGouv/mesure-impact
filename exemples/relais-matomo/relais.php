<?php
// Relais Matomo pour une application PHP, sans dépendance (extension curl).
//
// À appeler en tête du front controller (index.php), avant le routeur de l'application :
//
//   require __DIR__ . '/relais.php';
//   if (relais_matomo((string) getenv('MATOMO_URL'), (string) getenv('RELAIS_PREFIXE'))) {
//       exit;
//   }

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
    // Une seule IP, celle vue par le produit : conserver l'en-tête reçu laisserait le
    // visiteur choisir l'IP enregistrée par Matomo. Derrière un proxy de confiance,
    // reprendre l'IP réelle résolue par l'application.
    $entetes[] = "X-Forwarded-For: {$_SERVER['REMOTE_ADDR']}";

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
