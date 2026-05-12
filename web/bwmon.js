'use strict';

const COLOR_RX = '#22d3ee';
const COLOR_TX = '#f59e0b';
const COLOR_RX_FILL = 'rgba(34,211,238,0.25)';
const COLOR_TX_FILL = 'rgba(245,158,11,0.25)';
const COLOR_RX_PEAK = 'rgba(34,211,238,0.10)';
const COLOR_TX_PEAK = 'rgba(245,158,11,0.10)';
const FONT = "'Inter', -apple-system, sans-serif";

const PLOT_LAYOUT_BASE = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  font: { family: FONT, color: '#e9eefb', size: 11 },
  margin: { l: 60, r: 20, t: 16, b: 36 },
  xaxis: {
    gridcolor: 'rgba(167,139,250,0.10)',
    linecolor: '#2a3666',
    zerolinecolor: '#2a3666',
    tickfont: { color: '#8d9bc4' },
  },
  yaxis: {
    gridcolor: 'rgba(167,139,250,0.10)',
    linecolor: '#2a3666',
    zerolinecolor: '#2a3666',
    tickfont: { color: '#8d9bc4' },
  },
  hovermode: 'x unified',
  hoverlabel: { bgcolor: '#161e3a', bordercolor: '#2a3666', font: { color: '#e9eefb', family: FONT } },
  legend: { font: { color: '#e9eefb' }, bgcolor: 'rgba(0,0,0,0)' },
};

const PLOT_CONFIG = {
  responsive: true,
  displaylogo: false,
  modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d'],
  toImageButtonOptions: { format: 'png', filename: 'bwmon', scale: 2 },
};

const state = {
  iface: document.getElementById('iface').value,
  range: '24h',
  liveBuf: [],
  liveMax: 90,
  livePrev: null,
  histData: null,
  totalsBuf: [],
  totalsMax: 60,
  spikeActive: false,
};

const SPIKE_RATIO = 2.0;
const SPIKE_FLOOR_BPS = 1_000_000;
const PROCS_TOP = 5;

function fmtBps(bps) {
  if (bps == null || !isFinite(bps)) return '—';
  if (bps < 1e3) return bps.toFixed(0) + ' bps';
  if (bps < 1e6) return (bps / 1e3).toFixed(1) + ' Kbps';
  if (bps < 1e9) return (bps / 1e6).toFixed(2) + ' Mbps';
  return (bps / 1e9).toFixed(2) + ' Gbps';
}
function fmtBytes(b) {
  if (b == null || !isFinite(b)) return '—';
  if (b < 1e3) return b.toFixed(0) + ' B';
  if (b < 1e6) return (b / 1e3).toFixed(1) + ' KB';
  if (b < 1e9) return (b / 1e6).toFixed(2) + ' MB';
  if (b < 1e12) return (b / 1e9).toFixed(2) + ' GB';
  return (b / 1e12).toFixed(2) + ' TB';
}
function pickUnit(maxBps) {
  if (maxBps >= 1e9) return { div: 1e9, label: 'Gbps' };
  if (maxBps >= 1e6) return { div: 1e6, label: 'Mbps' };
  if (maxBps >= 1e3) return { div: 1e3, label: 'Kbps' };
  return { div: 1, label: 'bps' };
}
function fmtDuration(s) {
  if (s < 60) return s + 's';
  if (s < 3600) return Math.round(s / 60) + 'm';
  if (s < 86400) return Math.round(s / 3600) + 'h';
  return Math.round(s / 86400) + 'd';
}

/* ── LIVE TICKER ─────────────────────────────────────────────── */

const liveEl = document.getElementById('live-chart');
const liveRxEl = document.getElementById('live-rx');
const liveTxEl = document.getElementById('live-tx');
const connEl = document.getElementById('conn-status');

function initLiveChart() {
  const layout = Object.assign({}, PLOT_LAYOUT_BASE, {
    margin: { l: 50, r: 16, t: 8, b: 28 },
    xaxis: Object.assign({}, PLOT_LAYOUT_BASE.xaxis, { type: 'date', showgrid: false }),
    yaxis: Object.assign({}, PLOT_LAYOUT_BASE.yaxis, {
      title: { text: 'Mbps', font: { color: '#8d9bc4', size: 10 } },
      zeroline: true,
      zerolinewidth: 2,
      zerolinecolor: '#2a3666',
    }),
    showlegend: false,
  });
  const t0 = new Date();
  const traces = [
    { x: [t0], y: [0], name: 'RX', mode: 'lines', line: { color: COLOR_RX, width: 2, shape: 'spline' }, fill: 'tozeroy', fillcolor: COLOR_RX_FILL, hovertemplate: 'RX %{y:.2f} Mbps<extra></extra>' },
    { x: [t0], y: [0], name: 'TX', mode: 'lines', line: { color: COLOR_TX, width: 2, shape: 'spline' }, fill: 'tozeroy', fillcolor: COLOR_TX_FILL, hovertemplate: 'TX %{y:.2f} Mbps<extra></extra>' },
  ];
  Plotly.newPlot(liveEl, traces, layout, PLOT_CONFIG);
}

async function pollLive() {
  try {
    const r = await fetch(`api/live.php?iface=${encodeURIComponent(state.iface)}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('http ' + r.status);
    const d = await r.json();
    connEl.classList.remove('stale');

    if (d.rx_bps != null) {
      const tnow = new Date(d.ts * 1000);
      state.liveBuf.push({ t: tnow, rx: d.rx_bps / 1e6, tx: -(d.tx_bps / 1e6) });
      if (state.liveBuf.length > state.liveMax) state.liveBuf.shift();
      const total = d.rx_bps + d.tx_bps;
      state.totalsBuf.push(total);
      if (state.totalsBuf.length > state.totalsMax) state.totalsBuf.shift();
      updateSpikeStatus(total);
      liveRxEl.textContent = fmtBps(d.rx_bps);
      liveTxEl.textContent = fmtBps(d.tx_bps);
      const xs = state.liveBuf.map(p => p.t);
      const rxs = state.liveBuf.map(p => p.rx);
      const txs = state.liveBuf.map(p => p.tx);
      Plotly.react(liveEl, [
        { x: xs, y: rxs, name: 'RX', mode: 'lines', line: { color: COLOR_RX, width: 2, shape: 'spline' }, fill: 'tozeroy', fillcolor: COLOR_RX_FILL, hovertemplate: 'RX %{y:.2f} Mbps<extra></extra>' },
        { x: xs, y: txs, name: 'TX', mode: 'lines', line: { color: COLOR_TX, width: 2, shape: 'spline' }, fill: 'tozeroy', fillcolor: COLOR_TX_FILL, hovertemplate: 'TX %{customdata:.2f} Mbps<extra></extra>', customdata: txs.map(v => Math.abs(v)) },
      ], liveEl.layout, PLOT_CONFIG);
    }
  } catch (e) {
    connEl.classList.add('stale');
  }
}

/* ── TOP PROCESSES PANEL ─────────────────────────────────────── */

const procsListEl = document.getElementById('procs-list');
const procsMetaEl = document.getElementById('procs-meta');
const spikeBadgeEl = document.getElementById('spike-badge');

function updateSpikeStatus(currentBps) {
  if (state.totalsBuf.length < 5) return;
  const sum = state.totalsBuf.reduce((a, b) => a + b, 0);
  const avg = sum / state.totalsBuf.length;
  const isSpike = currentBps > SPIKE_FLOOR_BPS && currentBps > SPIKE_RATIO * avg;
  if (isSpike !== state.spikeActive) {
    state.spikeActive = isSpike;
    spikeBadgeEl.hidden = !isSpike;
    procsListEl.classList.toggle('spike', isSpike);
  }
}

function renderProcesses(d) {
  if (!d.processes || !d.processes.length) {
    procsListEl.innerHTML = '<div class="bw-procs-empty">No active per-process traffic</div>';
    procsMetaEl.textContent = d.note ? d.note : 'iface ' + (d.iface || '') + ' · age ' + Math.round((Date.now()/1000) - (d.ts || 0)) + 's';
    return;
  }
  const top = d.processes.slice(0, PROCS_TOP);
  const maxTotal = Math.max(...top.map(p => p.tx_bps + p.rx_bps), 1);
  let html = '';
  for (const p of top) {
    const total = p.tx_bps + p.rx_bps;
    const pct = (total / maxTotal) * 100;
    const rxFrac = total > 0 ? p.rx_bps / total : 0;
    const txFrac = 1 - rxFrac;
    const rxW = (rxFrac * pct).toFixed(2);
    const txW = (txFrac * pct).toFixed(2);
    const safeName = escapeHtml(p.name);
    html += `<div class="bw-procs-row" title="uid ${p.uid} · pid ${p.pid}">
      <div class="bw-procs-name">${safeName}<span class="bw-procs-pid">·${p.pid}</span></div>
      <div class="bw-procs-bar-wrap">
        <div class="bw-procs-bar bw-procs-bar-rx" style="width:${rxW}%"></div>
        <div class="bw-procs-bar bw-procs-bar-tx" style="width:${txW}%"></div>
      </div>
      <div class="bw-procs-rate">
        <span class="bw-procs-rate-rx">↓${fmtBps(p.rx_bps)}</span>
        <span class="bw-procs-rate-tx">↑${fmtBps(p.tx_bps)}</span>
      </div>
    </div>`;
  }
  procsListEl.innerHTML = html;
  const age = Math.round((Date.now() / 1000) - (d.ts || 0));
  procsMetaEl.textContent = `${d.processes.length} tracked · top ${top.length} shown · refresh ${(d.interval_seconds || 2).toFixed(1)}s · age ${age}s`;
}

async function pollProcesses() {
  try {
    const r = await fetch(`api/processes.php?iface=${encodeURIComponent(state.iface)}`, { cache: 'no-store' });
    if (!r.ok) {
      if (r.status === 404) {
        procsListEl.innerHTML = '<div class="bw-procs-empty">No bwprocs daemon for this interface</div>';
        procsMetaEl.textContent = '';
      }
      return;
    }
    const d = await r.json();
    renderProcesses(d);
  } catch (e) { /* swallow */ }
}

/* ── ALERTS (sustained-rate ≥ 40 Mbps for 5 min) ─────────────── */

const alertBannerEl = document.getElementById('alert-banner');
const alertBannerTitleEl = document.getElementById('alert-banner-title');
const alertBannerSubEl = document.getElementById('alert-banner-sub');
const alertBannerDismissEl = document.getElementById('alert-banner-dismiss');
const alertHistoryEl = document.getElementById('alert-history');

function fmtDurationLong(s) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60), rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}
function fmtAlertTime(ts) {
  return new Date(ts * 1000).toLocaleString(undefined, { hour12: false });
}

function dismissedKey(firedAt) { return 'bwmon:alertDismissed:' + firedAt; }
function isDismissed(firedAt) {
  try { return !!localStorage.getItem(dismissedKey(firedAt)); }
  catch (_) { return false; }
}
function markDismissed(firedAt) {
  try { localStorage.setItem(dismissedKey(firedAt), '1'); } catch (_) {}
}

function pickPrimaryAlert(list, now) {
  // Prefer an active alert; otherwise the most recently cleared within 24h.
  const undismissed = list.filter(a => !isDismissed(a.fired_at));
  const active = undismissed.find(a => a.active);
  if (active) return active;
  const recent = undismissed
    .filter(a => !a.active && a.cleared_at && (now - a.cleared_at) < 86400)
    .sort((a, b) => b.cleared_at - a.cleared_at);
  return recent[0] || null;
}

function renderAlertBanner(list, nowSec) {
  const a = pickPrimaryAlert(list, nowSec);
  if (!a) {
    alertBannerEl.hidden = true;
    return;
  }
  alertBannerEl.hidden = false;
  alertBannerEl.classList.toggle('cleared', !a.active);
  if (a.active) {
    alertBannerTitleEl.textContent =
      `ACTIVE ALERT — sustained ${fmtBps(a.peak_avg_bps)} avg for ${fmtDurationLong(a.duration_s)} (≥ 40 Mbps threshold)`;
    alertBannerSubEl.textContent =
      `started ${fmtAlertTime(a.fired_at)} · top: ${a.top_name}${a.top_pid ? ' (pid ' + a.top_pid + ')' : ''} · peak ${fmtBps(a.peak_bps)}`;
  } else {
    alertBannerTitleEl.textContent =
      `Recent alert (cleared) — ${fmtDurationLong(a.duration_s)} above 40 Mbps, peak ${fmtBps(a.peak_bps)}`;
    alertBannerSubEl.textContent =
      `${fmtAlertTime(a.fired_at)} → ${fmtAlertTime(a.cleared_at)} · top: ${a.top_name}${a.top_pid ? ' (pid ' + a.top_pid + ')' : ''}`;
  }
  alertBannerDismissEl.onclick = () => {
    markDismissed(a.fired_at);
    alertBannerEl.hidden = true;
  };
}

function renderAlertHistory(list) {
  if (!list || !list.length) {
    alertHistoryEl.innerHTML = '<div class="bw-loading">No alerts in this window.</div>';
    return;
  }
  let html = '<table><thead><tr><th>Started</th><th>Status</th><th>Duration</th><th>Peak avg</th><th>Peak instant</th><th>Top process</th></tr></thead><tbody>';
  for (const a of list.slice(0, 50)) {
    const status = a.active
      ? '<td class="bw-alert-active">● ACTIVE</td>'
      : '<td class="bw-alert-cleared">cleared ' + fmtAlertTime(a.cleared_at).split(',').pop().trim() + '</td>';
    html += `<tr>
      <td>${escapeHtml(fmtAlertTime(a.fired_at))}</td>
      ${status}
      <td>${fmtDurationLong(a.duration_s)}</td>
      <td class="bw-alert-rate">${fmtBps(a.peak_avg_bps)}</td>
      <td class="bw-alert-rate">${fmtBps(a.peak_bps)}</td>
      <td class="bw-alert-top">${escapeHtml(a.top_name || '?')}${a.top_pid ? ' <span style="color:var(--bw-muted);font-size:11px;">·' + a.top_pid + '</span>' : ''}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  alertHistoryEl.innerHTML = html;
}

async function pollAlerts() {
  try {
    const ifaceQ = encodeURIComponent(state.iface);
    const r = await fetch(`api/alerts.php?iface=${ifaceQ}&range=24h`, { cache: 'no-store' });
    if (!r.ok) return;
    const d = await r.json();
    state.alertsData = d;
    renderAlertBanner(d.alerts || [], d.now || (Date.now() / 1000));
  } catch (_) { /* swallow */ }
}

async function loadAlertHistory() {
  try {
    const ifaceQ = encodeURIComponent(state.iface);
    const r = await fetch(`api/alerts.php?iface=${ifaceQ}&range=30d`, { cache: 'no-store' });
    if (!r.ok) {
      alertHistoryEl.innerHTML = '<div class="bw-loading">Failed to load alerts.</div>';
      return;
    }
    const d = await r.json();
    renderAlertHistory(d.alerts || []);
  } catch (e) {
    alertHistoryEl.innerHTML = '<div class="bw-loading">Failed to load alerts.</div>';
  }
}

function buildAlertBands(alerts, points) {
  if (!alerts || !alerts.length || !points.length) return [];
  const xMin = points[0][0] * 1000;
  const xMax = points[points.length - 1][0] * 1000;
  const shapes = [];
  for (const a of alerts) {
    const x0 = a.fired_at * 1000;
    const x1 = (a.cleared_at || (Date.now() / 1000)) * 1000;
    if (x1 < xMin || x0 > xMax) continue;
    shapes.push({
      type: 'rect',
      xref: 'x', yref: 'paper',
      x0: new Date(Math.max(x0, xMin)),
      x1: new Date(Math.min(x1, xMax)),
      y0: 0, y1: 1,
      fillcolor: a.active ? 'rgba(248,113,113,0.10)' : 'rgba(245,158,11,0.07)',
      line: { width: 0 },
      layer: 'below',
    });
  }
  return shapes;
}

/* ── HISTORICAL CHART ────────────────────────────────────────── */

const histEl = document.getElementById('hist-chart');
const histMetaEl = document.getElementById('hist-meta');

function buildSpikeAnnotations(spikes, unit, points) {
  if (!spikes || !spikes.length || !points.length) return [];
  // Build a fast lookup of bucket center → rx_avg (in unit) for placing annotations on the curve
  const tsToY = new Map();
  for (const p of points) tsToY.set(p[0], p[1] / unit.div);
  const tsArr = points.map(p => p[0]);

  function nearestY(ts) {
    let lo = 0, hi = tsArr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tsArr[mid] < ts) lo = mid + 1; else hi = mid;
    }
    const a = tsArr[Math.max(0, lo - 1)], b = tsArr[lo];
    const closest = (Math.abs(a - ts) < Math.abs(b - ts)) ? a : b;
    return tsToY.get(closest) ?? 0;
  }

  return spikes.map(sp => {
    const y = nearestY(sp.ts);
    const hasTop = sp.top_pid != null && sp.top_name && sp.top_name !== '?';
    const name = hasTop
      ? sp.top_name.replace(/^.*\//, '').replace(/^sshd:.*/, 'sshd').slice(0, 16)
      : '(unattributed)';
    const totalArrow = (sp.rx_bps || 0) > (sp.tx_bps || 0) ? '↓' : '↑';
    const txt = hasTop
      ? `${name}${totalArrow}${fmtBpsShort(sp.total_bps)}`
      : `(unattributed)${totalArrow}${fmtBpsShort(sp.total_bps)}`;
    return {
      x: new Date(sp.ts * 1000),
      y: y,
      text: txt,
      showarrow: true,
      arrowhead: 2,
      arrowsize: 0.8,
      arrowcolor: '#f87171',
      arrowwidth: 1.2,
      ax: 0,
      ay: -28,
      bgcolor: 'rgba(248,113,113,0.85)',
      bordercolor: '#f87171',
      borderwidth: 1,
      borderpad: 3,
      font: { color: '#fff', size: 10, family: FONT },
      hovertext: hasTop
        ? `${escapeHtml(sp.top_name)} (pid ${sp.top_pid}) — top proc ↓${fmtBps(sp.top_rx_bps)} ↑${fmtBps(sp.top_tx_bps)}<br>iface total ${fmtBps(sp.total_bps)} · ${sp.n_procs} procs tracked<br><i>click for full attribution</i>`
        : `iface spike ${fmtBps(sp.total_bps)} (RX ${fmtBps(sp.rx_bps)}, TX ${fmtBps(sp.tx_bps)})<br>nethogs had no per-process attribution at this moment — likely VM/wg0/forwarded or short burst<br><i>click for details</i>`,
      captureevents: true,
    };
  });
}

/* ── SPIKE DETAIL PANEL ──────────────────────────────────────── */

const spikeDetailEl = document.getElementById('spike-detail');
const spikeDetailTitle = document.getElementById('spike-detail-title');
const spikeDetailSub = document.getElementById('spike-detail-sub');
const spikeDetailBody = document.getElementById('spike-detail-body');
const spikeDetailClose = document.getElementById('spike-detail-close');

let lastClickedSpikeTs = null;

function fmtSpikeTime(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, { hour12: false });
}

function showSpikeDetail(spike) {
  if (lastClickedSpikeTs === spike.ts && !spikeDetailEl.hidden) {
    hideSpikeDetail();
    return;
  }
  lastClickedSpikeTs = spike.ts;

  const hasTop = spike.top && spike.top.length > 0;
  const headLabel = hasTop
    ? (spike.top_name || '').replace(/^sshd:.*/, 'sshd').slice(0, 64)
    : '(unattributed)';
  spikeDetailTitle.textContent = `Spike · ${headLabel}`;
  spikeDetailSub.textContent = fmtSpikeTime(spike.ts) + (spike.trigger ? ` · trigger: ${spike.trigger}` : '');

  let html = `<div class="bw-spike-detail-stats">
    <span>iface total <strong>${fmtBps(spike.total_bps)}</strong></span>
    <span class="bw-rx">RX <strong>${fmtBps(spike.rx_bps)}</strong></span>
    <span class="bw-tx">TX <strong>${fmtBps(spike.tx_bps)}</strong></span>
    <span>rolling avg <strong>${fmtBps(spike.avg_bps || 0)}</strong></span>
    <span>×<strong>${spike.avg_bps ? (spike.total_bps / spike.avg_bps).toFixed(1) : '∞'}</strong> over avg</span>
    <span>tracked <strong>${spike.n_procs}</strong></span>
  </div>`;

  if (hasTop) {
    html += '<h4 class="bw-spike-section-h">Host process attribution</h4>';
    const maxTotal = Math.max(...spike.top.map(p => (p.tx_bps || 0) + (p.rx_bps || 0)), 1);
    html += '<div class="bw-procs-list">';
    for (const p of spike.top) {
      const rate = (p.tx_bps || 0) + (p.rx_bps || 0);
      const pct = (rate / maxTotal) * 100;
      const rxFrac = rate > 0 ? (p.rx_bps || 0) / rate : 0;
      const rxW = (rxFrac * pct).toFixed(2);
      const txW = ((1 - rxFrac) * pct).toFixed(2);
      const isUnattr = (p.pid === 0);
      const pidLabel = isUnattr ? '' : `<span class="bw-procs-pid">·${p.pid}</span>`;
      html += `<div class="bw-procs-row" title="uid ${p.uid} · pid ${p.pid}">
        <div class="bw-procs-name">${escapeHtml(p.name)}${pidLabel}</div>
        <div class="bw-procs-bar-wrap">
          <div class="bw-procs-bar bw-procs-bar-rx" style="width:${rxW}%"></div>
          <div class="bw-procs-bar bw-procs-bar-tx" style="width:${txW}%"></div>
        </div>
        <div class="bw-procs-rate">
          <span class="bw-procs-rate-rx">↓${fmtBps(p.rx_bps || 0)}</span>
          <span class="bw-procs-rate-tx">↑${fmtBps(p.tx_bps || 0)}</span>
        </div>
      </div>`;
    }
    html += '</div>';
    const sumTop = spike.top.reduce((a, p) => a + (p.tx_bps || 0) + (p.rx_bps || 0), 0);
    const coverage = spike.total_bps > 0 ? (sumTop / spike.total_bps) * 100 : 0;
    if (coverage < 50) {
      html += `<div class="bw-coverage-note">
        Host processes account for only <strong>${coverage.toFixed(1)}%</strong> of this burst —
        the rest is kernel-level traffic (VM forwarding, WireGuard, or NAT). See iface breakdown and connection flows below.
      </div>`;
    }
  } else {
    html += '<h4 class="bw-spike-section-h">Host process attribution</h4>';
    html += `<div class="bw-coverage-note">
      No userspace process owned this burst on the host. This is normal for KVM VM traffic
      (forwarded via virbr0/vnet0), WireGuard (kernel-encrypted), or short bursts.
      <strong>Look at the iface breakdown and connection flows below to see where the bytes went.</strong>
    </div>`;
  }

  // ── Iface breakdown ──
  if (spike.iface_rates && Object.keys(spike.iface_rates).length) {
    html += renderIfaceBreakdown(spike.iface_rates, spike.iface);
  }

  // ── Top connection flows ──
  if (spike.top_flows && spike.top_flows.length) {
    html += renderTopFlows(spike.top_flows);
  } else if (spike.top_flows !== undefined) {
    html += '<h4 class="bw-spike-section-h">Top connection flows</h4>';
    html += '<div class="bw-coverage-note">No tracked flows had byte counters at this moment.</div>';
  } else {
    html += '<h4 class="bw-spike-section-h">Top connection flows</h4>';
    html += '<div class="bw-coverage-note">This spike was captured before flow tracking was enabled. Newer spikes will show connection flows here.</div>';
  }

  spikeDetailBody.innerHTML = html;
  spikeDetailEl.hidden = false;
  spikeDetailEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderIfaceBreakdown(ifaceRates, activeIface) {
  let html = '<h4 class="bw-spike-section-h">Iface breakdown <span class="bw-spike-section-sub">cross-correlation: matching rates indicate forwarded traffic</span></h4>';
  const entries = Object.entries(ifaceRates).map(([name, r]) => ({
    name,
    rx: r.rx_bps || 0,
    tx: r.tx_bps || 0,
    total: (r.rx_bps || 0) + (r.tx_bps || 0),
  }));
  const maxTotal = Math.max(...entries.map(e => e.total), 1);
  // Active-iface total used for cross-correlation detection
  const activeRow = entries.find(e => e.name === activeIface);
  const activeTotal = activeRow ? activeRow.total : maxTotal;

  // Sort: active first, then by total descending
  entries.sort((a, b) => {
    if (a.name === activeIface) return -1;
    if (b.name === activeIface) return 1;
    return b.total - a.total;
  });

  html += '<div class="bw-iface-list">';
  for (const e of entries) {
    const isActive = e.name === activeIface;
    const corrRatio = activeTotal > 0 ? e.total / activeTotal : 0;
    const isCorrelated = !isActive && corrRatio >= 0.20 && e.total > 100_000;
    const pct = (e.total / maxTotal) * 100;
    const rxFrac = e.total > 0 ? e.rx / e.total : 0;
    const rxW = (rxFrac * pct).toFixed(2);
    const txW = ((1 - rxFrac) * pct).toFixed(2);
    let badge = '';
    if (isActive) badge = '<span class="bw-iface-badge bw-iface-badge-active">spike target</span>';
    else if (isCorrelated) badge = `<span class="bw-iface-badge bw-iface-badge-corr">↳ ${(corrRatio * 100).toFixed(0)}% match — likely forwarded</span>`;
    html += `<div class="bw-procs-row bw-iface-row${isActive ? ' active' : ''}${isCorrelated ? ' correlated' : ''}">
      <div class="bw-procs-name">${escapeHtml(e.name)}${badge}</div>
      <div class="bw-procs-bar-wrap">
        <div class="bw-procs-bar bw-procs-bar-rx" style="width:${rxW}%"></div>
        <div class="bw-procs-bar bw-procs-bar-tx" style="width:${txW}%"></div>
      </div>
      <div class="bw-procs-rate">
        <span class="bw-procs-rate-rx">↓${fmtBps(e.rx)}</span>
        <span class="bw-procs-rate-tx">↑${fmtBps(e.tx)}</span>
      </div>
    </div>`;
  }
  html += '</div>';
  return html;
}

function renderTopFlows(flows) {
  let html = '<h4 class="bw-spike-section-h">Top connection flows <span class="bw-spike-section-sub">by lifetime bytes in conntrack</span></h4>';
  html += '<div class="bw-flow-table-wrap"><table class="bw-flow-table"><thead><tr>';
  html += '<th>Proto</th><th>Source</th><th>→</th><th>Destination</th><th>Bytes</th><th>Packets</th><th>State</th>';
  html += '</tr></thead><tbody>';
  for (const f of flows) {
    const src = f.family === 'ipv6' ? abbrevIPv6(f.src) : f.src;
    const dst = f.family === 'ipv6' ? abbrevIPv6(f.dst) : f.dst;
    html += `<tr>
      <td>${escapeHtml(f.proto || '?')}</td>
      <td class="bw-flow-ip">${escapeHtml(src)}<span class="bw-flow-port">:${f.sport}</span></td>
      <td class="bw-flow-arrow">→</td>
      <td class="bw-flow-ip">${escapeHtml(dst)}<span class="bw-flow-port">:${f.dport}</span></td>
      <td class="bw-flow-bytes">${fmtBytes(f.bytes || 0)}</td>
      <td class="bw-flow-pkts">${(f.packets || 0).toLocaleString()}</td>
      <td class="bw-flow-state">${escapeHtml(f.state || '')}</td>
    </tr>`;
  }
  html += '</tbody></table></div>';
  return html;
}

function abbrevIPv6(ip) {
  if (!ip || !ip.includes(':')) return ip;
  // Compress runs of zero groups, keep first 2 + last 2 groups for readability
  const parts = ip.split(':');
  if (parts.length <= 4) return ip;
  return parts.slice(0, 2).join(':') + '::' + parts.slice(-2).join(':');
}

function hideSpikeDetail() {
  spikeDetailEl.hidden = true;
  lastClickedSpikeTs = null;
}

spikeDetailClose.addEventListener('click', hideSpikeDetail);

function wireSpikeClicks() {
  histEl.removeAllListeners?.('plotly_clickannotation');
  histEl.on('plotly_clickannotation', evt => {
    const idx = evt.index;
    const spikes = state.spikesData?.spikes || [];
    if (idx >= 0 && idx < spikes.length) {
      showSpikeDetail(spikes[idx]);
    }
  });
}

function fmtBpsShort(bps) {
  if (bps >= 1e9) return (bps / 1e9).toFixed(1) + 'G';
  if (bps >= 1e6) return (bps / 1e6).toFixed(1) + 'M';
  if (bps >= 1e3) return (bps / 1e3).toFixed(0) + 'K';
  return Math.round(bps) + '';
}

function renderHist(d, spikesData) {
  if (!d.points.length) {
    Plotly.purge(histEl);
    histEl.innerHTML = '<div class="bw-loading">No data in this range yet.</div>';
    histMetaEl.textContent = '';
    return;
  }
  const xs = d.points.map(p => new Date(p[0] * 1000));
  const rxAvg = d.points.map(p => p[1]);
  const txAvg = d.points.map(p => p[2]);
  const rxPeak = d.points.map(p => p[3]);
  const txPeak = d.points.map(p => p[4]);
  const maxAll = Math.max(...rxPeak, ...txPeak, 1);
  const unit = pickUnit(maxAll);

  const rxAvgU = rxAvg.map(v => v / unit.div);
  const txAvgU = txAvg.map(v => v / unit.div);
  const rxPeakU = rxPeak.map(v => v / unit.div);
  const txPeakU = txPeak.map(v => v / unit.div);

  const traces = [
    {
      x: xs, y: rxPeakU, name: 'RX peak', mode: 'lines',
      line: { color: COLOR_RX, width: 0 },
      fill: 'tozeroy', fillcolor: COLOR_RX_PEAK,
      hovertemplate: 'RX peak %{y:.2f} ' + unit.label + '<extra></extra>',
      showlegend: true,
    },
    {
      x: xs, y: rxAvgU, name: 'RX avg', mode: 'lines',
      line: { color: COLOR_RX, width: 2, shape: 'spline', smoothing: 0.4 },
      fill: 'tozeroy', fillcolor: COLOR_RX_FILL,
      hovertemplate: 'RX %{y:.2f} ' + unit.label + '<extra></extra>',
    },
    {
      x: xs, y: txPeakU, name: 'TX peak', mode: 'lines',
      line: { color: COLOR_TX, width: 0 },
      fill: 'tozeroy', fillcolor: COLOR_TX_PEAK,
      hovertemplate: 'TX peak %{y:.2f} ' + unit.label + '<extra></extra>',
      showlegend: true,
    },
    {
      x: xs, y: txAvgU, name: 'TX avg', mode: 'lines',
      line: { color: COLOR_TX, width: 2, shape: 'spline', smoothing: 0.4 },
      fill: 'tozeroy', fillcolor: COLOR_TX_FILL,
      hovertemplate: 'TX %{y:.2f} ' + unit.label + '<extra></extra>',
    },
  ];

  const annotations = buildSpikeAnnotations(spikesData?.spikes, unit, d.points);
  const alertShapes = buildAlertBands(state.alertsData?.alerts, d.points);
  const layout = Object.assign({}, PLOT_LAYOUT_BASE, {
    margin: { l: 60, r: 20, t: 8, b: 40 },
    xaxis: Object.assign({}, PLOT_LAYOUT_BASE.xaxis, { type: 'date', rangeslider: { visible: false } }),
    yaxis: Object.assign({}, PLOT_LAYOUT_BASE.yaxis, { title: { text: unit.label, font: { color: '#8d9bc4', size: 11 } }, rangemode: 'tozero' }),
    legend: { orientation: 'h', y: 1.06, x: 0, font: { color: '#e9eefb', size: 11 }, bgcolor: 'rgba(0,0,0,0)' },
    annotations: annotations,
    shapes: alertShapes,
  });

  Plotly.react(histEl, traces, layout, PLOT_CONFIG);
  wireSpikeClicks();

  let meta = `${d.sample_count} raw samples · bucket ${fmtDuration(d.bucket_seconds)} · ${d.points.length} buckets · iface ${d.iface}`;
  if (spikesData) {
    if (spikesData.truncated) {
      meta += ` · ${spikesData.shown} of ${spikesData.total} spikes shown (largest by peak)`;
    } else if (spikesData.total > 0) {
      meta += ` · ${spikesData.total} spike${spikesData.total === 1 ? '' : 's'} labeled`;
    }
  }
  histMetaEl.textContent = meta;
}

/* ── STAT CARDS + SPARKLINES ─────────────────────────────────── */

async function refreshStats() {
  try {
    const r = await fetch(`api/history.php?iface=${encodeURIComponent(state.iface)}&range=24h`, { cache: 'no-store' });
    const d = await r.json();
    if (!d.points || !d.points.length) return;
    const rx = d.points.map(p => p[1]);
    const tx = d.points.map(p => p[2]);
    const rxPeak = Math.max(...rx);
    const txPeak = Math.max(...tx);
    const total = d.points.reduce((a, p) => a + (p[1] + p[2]) * d.bucket_seconds / 8, 0);
    const avg = (rx.reduce((a, b) => a + b, 0) + tx.reduce((a, b) => a + b, 0)) / d.points.length;
    const all = rx.concat(tx).sort((a, b) => a - b);
    const p95 = all[Math.floor(all.length * 0.95)] || 0;

    document.getElementById('stat-rx-peak').textContent = fmtBps(rxPeak);
    document.getElementById('stat-tx-peak').textContent = fmtBps(txPeak);
    document.getElementById('stat-avg').textContent = fmtBps(avg);
    document.getElementById('stat-p95').textContent = fmtBps(p95);
    document.getElementById('stat-total').textContent = fmtBytes(total);
    document.getElementById('stat-samples').textContent = d.sample_count.toLocaleString();

    const sparkLayout = {
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      margin: { l: 0, r: 0, t: 0, b: 0 },
      xaxis: { visible: false, showgrid: false, zeroline: false },
      yaxis: { visible: false, showgrid: false, zeroline: false },
      showlegend: false,
    };
    const sparkConfig = { displayModeBar: false, staticPlot: true, responsive: true };
    Plotly.react(document.getElementById('spark-rx'), [{
      y: rx, mode: 'lines', line: { color: COLOR_RX, width: 1.5, shape: 'spline' },
      fill: 'tozeroy', fillcolor: COLOR_RX_FILL,
    }], sparkLayout, sparkConfig);
    Plotly.react(document.getElementById('spark-tx'), [{
      y: tx, mode: 'lines', line: { color: COLOR_TX, width: 1.5, shape: 'spline' },
      fill: 'tozeroy', fillcolor: COLOR_TX_FILL,
    }], sparkLayout, sparkConfig);
  } catch (e) { /* swallow */ }
}

/* ── HEATMAP ─────────────────────────────────────────────────── */

const heatEl = document.getElementById('heat-chart');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function renderHeatmap(d) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(null));
  const counts = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const p of d.points) {
    const dt = new Date(p[0] * 1000);
    const dow = dt.getDay();
    const hour = dt.getHours();
    const total = (p[1] + p[2]) / 1e6;
    grid[dow][hour] = (grid[dow][hour] || 0) + total;
    counts[dow][hour]++;
  }
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 24; j++) {
      if (counts[i][j] > 0) grid[i][j] = grid[i][j] / counts[i][j];
    }
  }

  const trace = {
    z: grid,
    x: Array.from({ length: 24 }, (_, i) => i),
    y: DAYS,
    type: 'heatmap',
    colorscale: 'Viridis',
    hovertemplate: '%{y} %{x}:00 — %{z:.2f} Mbps<extra></extra>',
    colorbar: {
      title: { text: 'Mbps', font: { color: '#8d9bc4', size: 10 } },
      tickfont: { color: '#8d9bc4', size: 10 },
      thickness: 12, len: 0.85, outlinewidth: 0,
    },
    xgap: 1, ygap: 1,
  };

  const layout = Object.assign({}, PLOT_LAYOUT_BASE, {
    margin: { l: 50, r: 60, t: 8, b: 36 },
    xaxis: Object.assign({}, PLOT_LAYOUT_BASE.xaxis, { title: { text: 'Hour of day', font: { color: '#8d9bc4', size: 11 } }, dtick: 2, showgrid: false }),
    yaxis: Object.assign({}, PLOT_LAYOUT_BASE.yaxis, { showgrid: false, autorange: 'reversed' }),
  });

  Plotly.react(heatEl, [trace], layout, PLOT_CONFIG);
}

/* ── DISTRIBUTION HISTOGRAM ──────────────────────────────────── */

const distEl = document.getElementById('hist-dist-chart');

function renderDistribution(d) {
  if (!d.points.length) return;
  const rx = d.points.map(p => p[1] / 1e6);
  const tx = d.points.map(p => p[2] / 1e6);
  const traces = [
    { x: rx, type: 'histogram', name: 'RX', marker: { color: COLOR_RX_FILL, line: { color: COLOR_RX, width: 1 } }, opacity: 0.7, hovertemplate: 'RX %{x:.2f} Mbps · %{y} samples<extra></extra>' },
    { x: tx, type: 'histogram', name: 'TX', marker: { color: COLOR_TX_FILL, line: { color: COLOR_TX, width: 1 } }, opacity: 0.7, hovertemplate: 'TX %{x:.2f} Mbps · %{y} samples<extra></extra>' },
  ];
  const layout = Object.assign({}, PLOT_LAYOUT_BASE, {
    margin: { l: 50, r: 16, t: 8, b: 36 },
    barmode: 'overlay',
    xaxis: Object.assign({}, PLOT_LAYOUT_BASE.xaxis, { title: { text: 'rate (Mbps)', font: { color: '#8d9bc4', size: 11 } } }),
    yaxis: Object.assign({}, PLOT_LAYOUT_BASE.yaxis, { title: { text: 'sample count', font: { color: '#8d9bc4', size: 11 } } }),
    legend: { orientation: 'h', y: 1.08, x: 0, font: { color: '#e9eefb', size: 11 }, bgcolor: 'rgba(0,0,0,0)' },
  });
  Plotly.react(distEl, traces, layout, PLOT_CONFIG);
}

/* ── TOTALS TABLES ───────────────────────────────────────────── */

function buildTotalsTable(rows) {
  if (!rows || !rows.length) return '<div class="bw-loading">No entries yet.</div>';
  let html = '<table><thead><tr><th>Logged</th><th>Range</th><th>RX</th><th>TX</th><th>Total</th><th>Samples</th></tr></thead><tbody>';
  for (const r of rows) {
    html += `<tr>
      <td>${escapeHtml(r.when)}</td>
      <td>${escapeHtml(r.range)}</td>
      <td class="bw-rx">${fmtBytes(r.rx_bytes)}</td>
      <td class="bw-tx">${fmtBytes(r.tx_bytes)}</td>
      <td><strong>${fmtBytes(r.total_bytes)}</strong></td>
      <td>${r.samples != null ? r.samples.toLocaleString() : '—'}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  return html;
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function loadTotals() {
  try {
    const r = await fetch('api/totals.php', { cache: 'no-store' });
    const d = await r.json();
    document.getElementById('weekly-totals').innerHTML = buildTotalsTable(d.weekly);
    document.getElementById('monthly-totals').innerHTML = buildTotalsTable(d.monthly);
  } catch (e) {
    document.getElementById('weekly-totals').innerHTML = '<div class="bw-loading">Failed to load.</div>';
    document.getElementById('monthly-totals').innerHTML = '<div class="bw-loading">Failed to load.</div>';
  }
}

/* ── HISTORY LOAD + RANGE BUTTONS ────────────────────────────── */

async function loadHistory() {
  histEl.classList.add('bw-loading-overlay');
  try {
    const ifaceQ = encodeURIComponent(state.iface);
    const [rH, rS] = await Promise.all([
      fetch(`api/history.php?iface=${ifaceQ}&range=${state.range}`, { cache: 'no-store' }),
      fetch(`api/spikes.php?iface=${ifaceQ}&range=${state.range}`, { cache: 'no-store' }).catch(() => null),
    ]);
    if (!rH.ok) throw new Error('history http ' + rH.status);
    const d = await rH.json();
    let spikesData = null;
    if (rS && rS.ok) {
      try { spikesData = await rS.json(); } catch (_) { spikesData = null; }
    }
    state.histData = d;
    state.spikesData = spikesData;
    renderHist(d, spikesData);
    renderHeatmap(d);
    renderDistribution(d);
  } catch (e) {
    Plotly.purge(histEl);
    histEl.innerHTML = '<div class="bw-loading">Failed to load history: ' + escapeHtml(String(e.message || e)) + '</div>';
    console.error('[bwmon] loadHistory failed', e);
  } finally {
    histEl.classList.remove('bw-loading-overlay');
  }
}

document.querySelectorAll('.bw-range-buttons button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.bw-range-buttons button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.range = btn.dataset.range;
    hideSpikeDetail();
    loadHistory();
  });
});

document.getElementById('iface').addEventListener('change', e => {
  state.iface = e.target.value;
  state.liveBuf = [];
  state.totalsBuf = [];
  state.spikeActive = false;
  spikeBadgeEl.hidden = true;
  procsListEl.classList.remove('spike');
  document.getElementById('live-iface').textContent = state.iface;
  loadHistory();
  refreshStats();
  pollProcesses();
  pollAlerts();
  loadAlertHistory();
});

/* ── INIT ────────────────────────────────────────────────────── */

window.addEventListener('DOMContentLoaded', () => {
  initLiveChart();
  loadHistory();
  refreshStats();
  loadTotals();
  loadAlertHistory();
  pollAlerts();
  pollLive();
  pollProcesses();
  setInterval(pollLive, 1000);
  setInterval(pollProcesses, 2000);
  setInterval(pollAlerts, 15_000);
  setInterval(loadAlertHistory, 60_000);
  setInterval(refreshStats, 60_000);
  setInterval(loadHistory, 5 * 60_000);
});
