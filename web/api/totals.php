<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, max-age=300');

$DATA_DIR = '/var/lib/bwmon';

function parse_log($path) {
    $entries = [];
    if (!is_readable($path)) return $entries;
    $lines = @file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) return $entries;
    foreach ($lines as $line) {
        $parts = array_map('trim', explode('|', $line));
        if (count($parts) < 4) continue;
        $when = $parts[0];
        $range = $parts[1];
        $vals = $parts[2];
        $samples = $parts[3];
        if (preg_match('/RX\s+([0-9.]+)\s+(KB|MB|GB|TB)\s+TX\s+([0-9.]+)\s+(KB|MB|GB|TB)\s+total\s+([0-9.]+)\s+(KB|MB|GB|TB)/i', $vals, $m)) {
            $entries[] = [
                'when' => $when,
                'range' => $range,
                'rx_bytes' => to_bytes($m[1], $m[2]),
                'tx_bytes' => to_bytes($m[3], $m[4]),
                'total_bytes' => to_bytes($m[5], $m[6]),
                'samples' => preg_match('/(\d+)\s+samples/', $samples, $s) ? (int)$s[1] : null,
                'iface' => preg_match('/iface=([a-z0-9]+)/i', $samples, $i) ? $i[1] : null,
                'raw' => $line,
            ];
        }
    }
    return array_reverse($entries);
}

function to_bytes($n, $unit) {
    $n = (float)$n;
    $unit = strtoupper($unit);
    $mult = ['KB' => 1e3, 'MB' => 1e6, 'GB' => 1e9, 'TB' => 1e12];
    return $n * ($mult[$unit] ?? 1);
}

echo json_encode([
    'weekly' => parse_log($DATA_DIR . '/weekly_totals.log'),
    'monthly' => parse_log($DATA_DIR . '/monthly_totals.log'),
], JSON_UNESCAPED_SLASHES);
