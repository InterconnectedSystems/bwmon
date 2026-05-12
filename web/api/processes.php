<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache');

$DATA_DIR = '/var/lib/bwmon';
$iface = $_GET['iface'] ?? 'enp3s0';
if (!preg_match('/^[a-z][a-z0-9]{1,14}$/i', $iface)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid iface']);
    exit;
}

$path = $DATA_DIR . '/procs_' . $iface . '.json';
if (!is_readable($path)) {
    http_response_code(404);
    echo json_encode(['error' => 'no process data', 'iface' => $iface, 'hint' => 'is bwprocs@' . $iface . '.service running?']);
    exit;
}

$raw = @file_get_contents($path);
if ($raw === false) {
    http_response_code(500);
    echo json_encode(['error' => 'cannot read process data']);
    exit;
}

$age = time() - filemtime($path);
header('X-Bwprocs-Age-Seconds: ' . $age);
echo $raw;
