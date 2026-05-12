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

$lines = @file('/proc/net/dev', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
if ($lines === false) {
    http_response_code(500);
    echo json_encode(['error' => 'cannot read /proc/net/dev']);
    exit;
}

$rx_bytes = null;
$tx_bytes = null;
$ifaces_seen = [];
foreach ($lines as $line) {
    if (!str_contains($line, ':')) continue;
    [$name, $data] = explode(':', $line, 2);
    $name = trim($name);
    if ($name === 'lo') continue;
    $ifaces_seen[] = $name;
    if ($name !== $iface) continue;
    $fields = preg_split('/\s+/', trim($data));
    $rx_bytes = (int)$fields[0];
    $tx_bytes = (int)$fields[8];
}

if ($rx_bytes === null) {
    http_response_code(404);
    echo json_encode(['error' => 'iface not found', 'available' => $ifaces_seen]);
    exit;
}

$now = microtime(true);
$state_path = $DATA_DIR . '/web_state_' . $iface . '.json';
$rx_bps = null;
$tx_bps = null;
$delta_t = null;

if (is_readable($state_path)) {
    $prev = @json_decode(@file_get_contents($state_path), true);
    if (is_array($prev) && isset($prev['ts'], $prev['rx_bytes'], $prev['tx_bytes'])) {
        $delta_t = $now - (float)$prev['ts'];
        if ($delta_t > 0.1 && $delta_t < 600) {
            $rx_delta = $rx_bytes - (int)$prev['rx_bytes'];
            $tx_delta = $tx_bytes - (int)$prev['tx_bytes'];
            if ($rx_delta >= 0 && $tx_delta >= 0) {
                $rx_bps = ($rx_delta * 8) / $delta_t;
                $tx_bps = ($tx_delta * 8) / $delta_t;
            }
        }
    }
}

$payload = json_encode(['ts' => $now, 'rx_bytes' => $rx_bytes, 'tx_bytes' => $tx_bytes]);
@file_put_contents($state_path, $payload, LOCK_EX);

echo json_encode([
    'ts' => $now,
    'iface' => $iface,
    'rx_bps' => $rx_bps,
    'tx_bps' => $tx_bps,
    'rx_bytes_total' => $rx_bytes,
    'tx_bytes_total' => $tx_bytes,
    'delta_t' => $delta_t,
], JSON_UNESCAPED_SLASHES);
