<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, max-age=60');

$DATA_DIR = '/var/lib/bwmon';
$VALID_RANGES = ['1h' => 3600, '24h' => 86400, '7d' => 604800, '30d' => 2592000, '6m' => 15552000, 'all' => null];
$MAX_SPIKES = 30;

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

$path = $DATA_DIR . '/spikes_' . $iface . '.jsonl';
$now = time();
$cutoff = $VALID_RANGES[$range] === null ? 0 : $now - $VALID_RANGES[$range];

$spikes = [];
if (is_readable($path)) {
    $fh = @fopen($path, 'r');
    if ($fh) {
        while (($line = fgets($fh)) !== false) {
            $line = trim($line);
            if ($line === '') continue;
            $obj = json_decode($line, true);
            if (!is_array($obj) || !isset($obj['ts'])) continue;
            if ($obj['ts'] < $cutoff) continue;
            $top = $obj['top'] ?? [];
            $top0 = $top[0] ?? null;
            $row = [
                'ts' => $obj['ts'],
                'total_bps' => $obj['total_bps'] ?? 0,
                'rx_bps' => $obj['rx_bps'] ?? 0,
                'tx_bps' => $obj['tx_bps'] ?? 0,
                'avg_bps' => $obj['avg_bps'] ?? 0,
                'trigger' => $obj['trigger'] ?? '',
                'top_name' => $top0['name'] ?? '?',
                'top_pid' => $top0['pid'] ?? null,
                'top_total_bps' => $top0 ? (($top0['rx_bps'] ?? 0) + ($top0['tx_bps'] ?? 0)) : 0,
                'top_rx_bps' => $top0['rx_bps'] ?? 0,
                'top_tx_bps' => $top0['tx_bps'] ?? 0,
                'n_procs' => count($top),
                'top' => $top,
                'iface' => $obj['iface'] ?? $iface,
            ];
            if (isset($obj['iface_rates']) && is_array($obj['iface_rates'])) {
                $row['iface_rates'] = $obj['iface_rates'];
            }
            if (isset($obj['top_flows']) && is_array($obj['top_flows'])) {
                $row['top_flows'] = $obj['top_flows'];
            }
            $spikes[] = $row;
        }
        fclose($fh);
    }
}

$total = count($spikes);
$truncated = false;
if ($total > $MAX_SPIKES) {
    usort($spikes, fn($a, $b) => $b['total_bps'] <=> $a['total_bps']);
    $spikes = array_slice($spikes, 0, $MAX_SPIKES);
    $truncated = true;
}
usort($spikes, fn($a, $b) => $a['ts'] <=> $b['ts']);

echo json_encode([
    'iface' => $iface,
    'range' => $range,
    'total' => $total,
    'shown' => count($spikes),
    'truncated' => $truncated,
    'spikes' => $spikes,
], JSON_UNESCAPED_SLASHES);
