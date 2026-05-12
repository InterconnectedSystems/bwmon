<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, max-age=60');

$DATA_DIR = '/var/lib/bwmon';
$VALID_RANGES = ['1h' => 3600, '24h' => 86400, '7d' => 604800, '30d' => 2592000, '6m' => 15552000, 'all' => null];
$MAX_POINTS = 3000;

$range = $_GET['range'] ?? '24h';
if (!array_key_exists($range, $VALID_RANGES)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid range']);
    exit;
}

$iface = $_GET['iface'] ?? 'enp3s0';
if (!preg_match('/^[a-z][a-z0-9]{1,14}$/i', $iface)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid iface']);
    exit;
}

$csv = $DATA_DIR . '/bw_' . $iface . '.csv';
if (!is_readable($csv)) {
    http_response_code(404);
    echo json_encode(['error' => 'no data for iface']);
    exit;
}

$now = time();
$cutoff = $VALID_RANGES[$range] === null ? 0 : $now - $VALID_RANGES[$range];

$ts = [];
$rx = [];
$tx = [];
$fh = fopen($csv, 'r');
if (!$fh) {
    http_response_code(500);
    echo json_encode(['error' => 'cannot open data']);
    exit;
}
while (($line = fgets($fh)) !== false) {
    $parts = explode(',', trim($line));
    if (count($parts) !== 3) continue;
    $t = (int)$parts[0];
    if ($t < $cutoff) continue;
    $ts[] = $t;
    $rx[] = (float)$parts[1];
    $tx[] = (float)$parts[2];
}
fclose($fh);

$n = count($ts);
if ($n === 0) {
    echo json_encode(['range' => $range, 'iface' => $iface, 'bucket_seconds' => 0, 'points' => [], 'now' => $now]);
    exit;
}

$span = $ts[$n - 1] - $ts[0];
$target_buckets = min($MAX_POINTS, max(1, $n));
$desired_bucket = $span > 0 ? max(300, (int)ceil($span / $target_buckets)) : 300;

$bucket_seconds = 300;
foreach ([300, 900, 1800, 3600, 7200, 21600, 43200, 86400] as $b) {
    if ($b >= $desired_bucket) { $bucket_seconds = $b; break; }
    $bucket_seconds = $b;
}

$buckets = [];
for ($i = 0; $i < $n; $i++) {
    $bucket_key = (int)floor($ts[$i] / $bucket_seconds) * $bucket_seconds;
    if (!isset($buckets[$bucket_key])) {
        $buckets[$bucket_key] = ['rx_sum' => 0.0, 'tx_sum' => 0.0, 'rx_peak' => 0.0, 'tx_peak' => 0.0, 'count' => 0];
    }
    $buckets[$bucket_key]['rx_sum'] += $rx[$i];
    $buckets[$bucket_key]['tx_sum'] += $tx[$i];
    if ($rx[$i] > $buckets[$bucket_key]['rx_peak']) $buckets[$bucket_key]['rx_peak'] = $rx[$i];
    if ($tx[$i] > $buckets[$bucket_key]['tx_peak']) $buckets[$bucket_key]['tx_peak'] = $tx[$i];
    $buckets[$bucket_key]['count']++;
}
ksort($buckets);

$points = [];
foreach ($buckets as $k => $b) {
    $points[] = [
        $k,
        $b['rx_sum'] / $b['count'],
        $b['tx_sum'] / $b['count'],
        $b['rx_peak'],
        $b['tx_peak'],
    ];
}

echo json_encode([
    'range' => $range,
    'iface' => $iface,
    'bucket_seconds' => $bucket_seconds,
    'points' => $points,
    'now' => $now,
    'sample_count' => $n,
], JSON_UNESCAPED_SLASHES);
