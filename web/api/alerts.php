<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, max-age=15');

$DATA_DIR = '/var/lib/bwmon';
$VALID_RANGES = ['1h' => 3600, '24h' => 86400, '7d' => 604800, '30d' => 2592000, '6m' => 15552000, 'all' => null];

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

$active_only = !empty($_GET['active']) && $_GET['active'] !== '0';

$path = $DATA_DIR . '/alerts_' . $iface . '.jsonl';
$now = time();
$cutoff = $VALID_RANGES[$range] === null ? 0 : $now - $VALID_RANGES[$range];

// Pair FIRED + CLEARED events. We do TWO passes: first read raw events,
// then walk forward pairing each FIRED with the next CLEARED whose
// fired_at matches.
$raw = [];
if (is_readable($path)) {
    $fh = @fopen($path, 'r');
    if ($fh) {
        while (($line = fgets($fh)) !== false) {
            $line = trim($line);
            if ($line === '') continue;
            $obj = json_decode($line, true);
            if (!is_array($obj) || !isset($obj['ts'], $obj['event'])) continue;
            $raw[] = $obj;
        }
        fclose($fh);
    }
}

// Build paired event list. For each FIRED look for a CLEARED with matching
// fired_at; if none, the FIRED is still active.
$cleared_by_fired_at = [];
foreach ($raw as $obj) {
    if ($obj['event'] === 'CLEARED' && isset($obj['fired_at'])) {
        $cleared_by_fired_at[(string)$obj['fired_at']] = $obj;
    }
}

$alerts = [];
foreach ($raw as $obj) {
    if ($obj['event'] !== 'FIRED') continue;
    $fired_at = $obj['ts'];
    $cleared = $cleared_by_fired_at[(string)$fired_at] ?? null;
    $is_active = ($cleared === null);
    $cleared_at = $cleared['ts'] ?? null;
    $duration = $cleared ? ($cleared['duration_s'] ?? ($cleared_at - $fired_at)) : ($now - $fired_at);
    $peak_bps = $cleared ? ($cleared['peak_during_event_bps'] ?? ($obj['peak_bps_in_window'] ?? 0)) : ($obj['peak_bps_in_window'] ?? 0);

    $top = $obj['top'] ?? [];
    $top0 = $top[0] ?? null;

    // Time-range filter: include if EITHER fired_at or cleared_at is within window
    $latest = $cleared_at ?? $fired_at;
    if ($latest < $cutoff) continue;

    if ($active_only && !$is_active) continue;

    $alerts[] = [
        'fired_at'        => $fired_at,
        'cleared_at'      => $cleared_at,
        'active'          => $is_active,
        'duration_s'      => round($duration, 1),
        'peak_avg_bps'    => $obj['rolling_avg_bps'] ?? 0,
        'peak_bps'        => $peak_bps,
        'rx_avg_bps'      => $obj['rx_avg_bps'] ?? 0,
        'tx_avg_bps'      => $obj['tx_avg_bps'] ?? 0,
        'threshold_bps'   => $obj['threshold_bps'] ?? 40000000,
        'top_name'        => $top0['name'] ?? '?',
        'top_pid'         => $top0['pid'] ?? null,
        'top_rx_bps'      => $top0['rx_bps'] ?? 0,
        'top_tx_bps'      => $top0['tx_bps'] ?? 0,
        'n_procs'         => count($top),
        'top'             => $top,
    ];
}

// Sort newest-first by fired_at
usort($alerts, fn($a, $b) => $b['fired_at'] <=> $a['fired_at']);

echo json_encode([
    'iface'        => $iface,
    'range'        => $range,
    'active_only'  => $active_only,
    'now'          => $now,
    'count'        => count($alerts),
    'alerts'       => $alerts,
], JSON_UNESCAPED_SLASHES);
