<?php
// Relais Matomo pour une application PHP, sans dépendance (extension curl).
//
// À appeler en tête du front controller (index.php), avant le routeur de l'application :
//
//   require __DIR__ . '/relais.php';
//   if (relais_matomo(getenv('MATOMO_URL'), getenv('RELAIS_PREFIXE'))) {
//       exit;
//   }

function relais_matomo(string $matomoUrl, string $prefixe): bool
{
    $routes = [
        $prefixe . '/a.js' => '/matomo.js',
        $prefixe . '/c' => '/matomo.php',
    ];
    $chemin = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    if (!isset($routes[$chemin])) {
        return false; // pas pour le relais : l'application continue
    }

    $methode = $_SERVER['REQUEST_METHOD'];
    if (!in_array($methode, ['GET', 'POST'], true)) {
        http_response_code(404);
        return true;
    }

    $query = $_SERVER['QUERY_STRING'] ?? '';
    $corps = $methode === 'POST' ? file_get_contents('php://input') : null;
    if ($corps !== null && strlen($corps) > 64000) {
        http_response_code(413);
        return true;
    }
    if (stripos($query, 'token_auth') !== false || ($corps !== null && stripos($corps, 'token_auth') !== false)) {
        http_response_code(400);
        return true;
    }

    $entetes = [];
    foreach (['HTTP_USER_AGENT' => 'User-Agent', 'HTTP_ACCEPT_LANGUAGE' => 'Accept-Language', 'CONTENT_TYPE' => 'Content-Type'] as $cle => $nom) {
        if (!empty($_SERVER[$cle])) {
            $entetes[] = "$nom: {$_SERVER[$cle]}";
        }
    }
    $ip = trim(($_SERVER['HTTP_X_FORWARDED_FOR'] ?? '') . ', ' . $_SERVER['REMOTE_ADDR'], ', ');
    $entetes[] = "X-Forwarded-For: $ip";

    $ch = curl_init($matomoUrl . $routes[$chemin] . ($query !== '' ? "?$query" : ''));
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $methode,
        CURLOPT_HTTPHEADER => $entetes,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 5,
    ]);
    if ($corps !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $corps);
    }

    $reponse = curl_exec($ch);
    if ($reponse === false) {
        http_response_code(502);
        return true;
    }
    http_response_code(curl_getinfo($ch, CURLINFO_RESPONSE_CODE));
    $type = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    if ($type) {
        header("Content-Type: $type");
    }
    echo $reponse;
    return true;
}
