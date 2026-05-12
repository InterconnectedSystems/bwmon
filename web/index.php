<?php
$ifaces = [];
$lines = @file('/proc/net/dev', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
if ($lines !== false) {
    foreach ($lines as $line) {
        if (!str_contains($line, ':')) continue;
        [$name, $_] = explode(':', $line, 2);
        $name = trim($name);
        if ($name === 'lo') continue;
        $ifaces[] = $name;
    }
}
$default_iface = getenv('BWMON_IFACE') ?: ($ifaces[0] ?? 'eth0');
if (!in_array($default_iface, $ifaces, true) && !empty($ifaces)) {
    $default_iface = $ifaces[0];
}
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Bandwidth Monitor</title>
<link rel="stylesheet" href="bwmon.css">
<script src="vendor/plotly-basic.min.js"></script>
</head>
<body>
<header class="bw-header">
  <div class="bw-title">
    <span class="bw-logo">▮▮▮</span>
    <h1>Bandwidth Monitor</h1>
  </div>
  <div class="bw-controls">
    <label for="iface">Interface:</label>
    <select id="iface">
      <?php foreach ($ifaces as $i): ?>
        <option value="<?= htmlspecialchars($i) ?>"<?= $i === $default_iface ? ' selected' : '' ?>><?= htmlspecialchars($i) ?></option>
      <?php endforeach; ?>
    </select>
    <span id="conn-status" class="bw-status">●</span>
  </div>
</header>

<main class="bw-main">

  <div id="alert-banner" class="bw-alert-banner" hidden>
    <div class="bw-alert-banner-icon">⚠</div>
    <div class="bw-alert-banner-body">
      <div id="alert-banner-title">—</div>
      <div id="alert-banner-sub" class="bw-alert-banner-sub">—</div>
    </div>
    <button type="button" id="alert-banner-dismiss" aria-label="Dismiss">×</button>
  </div>

  <section class="bw-row bw-live-row">
    <div class="bw-card bw-live-card">
      <div class="bw-card-head">
        <h2>Live · <span id="live-iface"><?= htmlspecialchars($default_iface) ?></span></h2>
        <div class="bw-live-readout">
          <span class="bw-rx">RX <strong id="live-rx">—</strong></span>
          <span class="bw-tx">TX <strong id="live-tx">—</strong></span>
        </div>
      </div>
      <div id="live-chart" class="bw-chart bw-chart-live"></div>

      <div class="bw-procs">
        <div class="bw-procs-head">
          <h3>Top processes <span class="bw-procs-sub">(live, ~2s refresh)</span></h3>
          <span id="spike-badge" class="bw-spike-badge" hidden>⚠ SPIKE</span>
        </div>
        <div id="procs-list" class="bw-procs-list">
          <div class="bw-procs-empty">Waiting for first samples…</div>
        </div>
        <div class="bw-procs-foot"><span id="procs-meta">—</span></div>
      </div>
    </div>
  </section>

  <section class="bw-row bw-stats-row">
    <div class="bw-stat-card"><span class="bw-stat-label">RX peak (24h)</span><strong id="stat-rx-peak">—</strong><div id="spark-rx" class="bw-sparkline"></div></div>
    <div class="bw-stat-card"><span class="bw-stat-label">TX peak (24h)</span><strong id="stat-tx-peak">—</strong><div id="spark-tx" class="bw-sparkline"></div></div>
    <div class="bw-stat-card"><span class="bw-stat-label">Avg (24h)</span><strong id="stat-avg">—</strong></div>
    <div class="bw-stat-card"><span class="bw-stat-label">95th pct (24h)</span><strong id="stat-p95">—</strong></div>
    <div class="bw-stat-card"><span class="bw-stat-label">Total (24h)</span><strong id="stat-total">—</strong></div>
    <div class="bw-stat-card"><span class="bw-stat-label">Samples</span><strong id="stat-samples">—</strong></div>
  </section>

  <section class="bw-row">
    <div class="bw-card bw-card-wide">
      <div class="bw-card-head">
        <h2>History · RX / TX</h2>
        <div class="bw-range-buttons" role="tablist">
          <button data-range="1h">1h</button>
          <button data-range="24h" class="active">24h</button>
          <button data-range="7d">7d</button>
          <button data-range="30d">30d</button>
          <button data-range="6m">6m</button>
          <button data-range="all">All</button>
        </div>
      </div>
      <div id="hist-chart" class="bw-chart bw-chart-main"></div>
      <div class="bw-chart-meta"><span id="hist-meta">—</span><span class="bw-chart-hint"> · click any spike label for full attribution</span></div>

      <div id="spike-detail" class="bw-spike-detail" hidden>
        <div class="bw-spike-detail-head">
          <div>
            <h3 id="spike-detail-title">Spike</h3>
            <div class="bw-spike-detail-sub" id="spike-detail-sub">—</div>
          </div>
          <button type="button" id="spike-detail-close" aria-label="Close">×</button>
        </div>
        <div id="spike-detail-body"></div>
      </div>
    </div>
  </section>

  <section class="bw-row bw-row-twocol">
    <div class="bw-card">
      <div class="bw-card-head">
        <h2>Heatmap · hour of day × day of week</h2>
        <div class="bw-card-sub">avg total (RX+TX) over the loaded window</div>
      </div>
      <div id="heat-chart" class="bw-chart bw-chart-heat"></div>
    </div>

    <div class="bw-card">
      <div class="bw-card-head">
        <h2>Distribution · sample rates</h2>
        <div class="bw-card-sub">how often each rate occurs (RX vs TX)</div>
      </div>
      <div id="hist-dist-chart" class="bw-chart bw-chart-heat"></div>
    </div>
  </section>

  <section class="bw-row bw-row-twocol">
    <div class="bw-card">
      <div class="bw-card-head"><h2>Weekly totals</h2></div>
      <div id="weekly-totals" class="bw-table-wrap"><div class="bw-loading">Loading…</div></div>
    </div>
    <div class="bw-card">
      <div class="bw-card-head"><h2>Monthly totals</h2></div>
      <div id="monthly-totals" class="bw-table-wrap"><div class="bw-loading">Loading…</div></div>
    </div>
  </section>

  <section class="bw-row">
    <div class="bw-card bw-card-wide">
      <div class="bw-card-head">
        <h2>Alert history <span class="bw-card-sub">sustained ≥ 40 Mbps for 5+ min</span></h2>
      </div>
      <div id="alert-history" class="bw-table-wrap"><div class="bw-loading">Loading…</div></div>
    </div>
  </section>

</main>

<footer class="bw-footer">
  <span>data: <code>/var/lib/bwmon/</code> · collector: <code>bwcollect</code> @ 5-min · live: 1-second poll</span>
</footer>

<script src="bwmon.js"></script>
</body>
</html>
