# bwmon

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Platform: Linux](https://img.shields.io/badge/platform-linux-555.svg)
![Shell: bash](https://img.shields.io/badge/installer-bash-4eaa25.svg)
![PHP](https://img.shields.io/badge/php-%E2%89%A57.4-777bb4.svg)
![Python](https://img.shields.io/badge/python-%E2%89%A53.9-3776ab.svg)
![Status: stable](https://img.shields.io/badge/status-stable-brightgreen.svg)

A self-hosted bandwidth monitor for a single Linux host. Live RX/TX graph,
per-process attribution, spike forensics with conntrack flow tables, sustained
alerts, and 6 months of history — installed in one command, no agents, no
cloud, no signup.

```bash
git clone <this-repo> bwmon && cd bwmon && sudo ./setup.sh
```

That's the whole install. Open `http://<host>:8080/` when it finishes.

---

## Table of contents

- [Why bwmon?](#why-bwmon)
- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Update / Uninstall](#update--uninstall)
- [How it works](#how-it-works)
- [Data layout](#data-layout)
- [Configuration](#configuration)
- [Authentication](#authentication)
- [CLI tools](#cli-tools)
- [Troubleshooting](#troubleshooting)
- [Tested on](#tested-on)
- [License](#license)

---

## Why bwmon?

You want to know *why* a Linux box is using bandwidth right now and over the
last week — without standing up Prometheus, Grafana, an InfluxDB, an SNMP
collector, and a `vnstat` daemon for good measure.

| Tool                  | Live | Per-process | Spike forensics | History | Setup       |
|-----------------------|:----:|:-----------:|:---------------:|:-------:|:-----------:|
| `vnstat`              | ✗    | ✗           | ✗               | ✓       | trivial     |
| `iftop` / `nload`     | ✓    | ✗           | ✗               | ✗       | trivial     |
| `nethogs`             | ✓    | ✓           | ✗               | ✗       | trivial     |
| ntopng                | ✓    | partial     | ✓               | ✓       | heavy       |
| Grafana + node_exp    | ✓    | external    | ✗               | ✓       | very heavy  |
| **bwmon**             | ✓    | ✓           | ✓               | ✓       | one command |

bwmon is purpose-built for the "what just used 200 Mbps for 30 seconds at 3am"
question on a single host. If you need multi-host or long-horizon analytics,
the heavyweight stacks are still the right answer.

---

## Features

- **Live panel** — 1-second-poll RX/TX with a rolling chart for the active
  interface and an instant top-process list.
- **Per-process attribution** — daemonised `nethogs` writes the top talkers
  to a JSON file every ~2 s. The web UI tails that file.
- **Spike forensics** — when iface total exceeds 5× the rolling 2-minute
  average, a spike record is written with: per-process attribution captured
  at the spike instant, *all*-iface RX/TX breakdown (so VM/WireGuard/NAT
  forwarding is visible), and the top conntrack flows by lifetime bytes.
- **History** — 5-minute samples kept for 6 months with adaptive bucketing
  for the 1h / 24h / 7d / 30d / 6m / all-time views.
- **Heatmap & distribution** — hour-of-day × day-of-week average rates and
  a histogram of how often each rate occurs.
- **Sustained alerts** — when the rolling 5-minute average crosses 40 Mbps a
  banner lights up; cleared alerts stay in the history table.
- **Zero JavaScript dependencies at runtime** other than a single vendored
  copy of `plotly-basic.min.js`. No bundlers, no npm, no postinstall hooks.

---

## Requirements

- Linux host with `/proc/net/dev` (any kernel ≥ 4.0; tested on 5.x and 6.x).
- Root access (systemd unit + cron + `/var/lib/bwmon`).
- Debian / Ubuntu — the installer uses `apt`. Other distros work, but you
  install nginx, php-fpm, php-cli, and nethogs yourself, then run
  `./setup.sh --skip-deps`.
- One network interface to watch (auto-detected from the default route).
- ≤ 50 MB disk for 6 months of history per interface.
- < 1% of one CPU core at idle for the `bwprocs` daemon.

---

## Install

```bash
git clone <this-repo> bwmon
cd bwmon
sudo ./setup.sh
```

The installer:

1. apt-installs `nethogs`, `php-fpm`, `php-cli`, `nginx` (skip with `--skip-deps`).
2. Auto-detects the default-route interface (`--iface <name>` to override).
3. Copies the collector scripts to `/usr/local/bin/`.
4. Copies the web app to `/opt/bwmon/web/` (`--prefix <dir>` to change).
5. Installs and enables `bwprocs@<iface>.service`.
6. Registers `bwcollect` (every 5 min), `bwweekly`, `bwmonthly` in `/etc/cron.d/bwmon`.
7. Drops an nginx server block on port 8080 (`--port <n>` to change,
   `--skip-nginx` to bring your own).
8. Reloads nginx, primes the first sample, and prints the URL.

### Options

| Flag             | Default      | Notes                                                  |
|------------------|--------------|--------------------------------------------------------|
| `--iface <name>` | auto-detect  | Interface to monitor.                                  |
| `--port <n>`     | `8080`       | Port for the nginx server block.                       |
| `--prefix <dir>` | `/opt/bwmon` | Web-files install root.                                |
| `--skip-deps`    | off          | Don't `apt-get install`. For non-Debian hosts.         |
| `--skip-nginx`   | off          | Don't write or reload nginx. Wire your own webserver.  |

Environment overrides: `IFACE`, `PORT`, `PREFIX`, `DATA_DIR`, `BIN_DIR`,
`SYSTEMD_DIR`.

### What you'll see

- First **live** numbers: immediately.
- First **history** points: after the second 5-minute cron fires (the first
  one just primes the counter — there's no rate to record until the second).
- First **spike** record: whenever traffic actually spikes past 5× rolling avg.
- First **sustained alert**: 5 consecutive minutes at ≥ 40 Mbps avg.

---

## Update / Uninstall

**Update:** pull the latest source and re-run `sudo ./setup.sh`. The installer
is idempotent — it overwrites scripts and web files, reloads systemd, and
reloads nginx without disturbing the historical data in `/var/lib/bwmon/`.

**Uninstall:**

```bash
sudo ./uninstall.sh             # leaves /var/lib/bwmon intact
sudo ./uninstall.sh --purge-data  # wipes data too
```

---

## How it works

```
                ┌─────────────────────────────────────────────────┐
                │                  /var/lib/bwmon/                │
   /proc/       │                                                 │
   net/dev ─┐   │   bw_<iface>.csv      (5-min RX/TX bps)         │
            │   │   state_<iface>.json  (last counter)            │
            ▼   │   procs_<iface>.json  (live top procs, ~2s)     │
       bwcollect│   spikes_<iface>.jsonl (spike forensics)        │
       (cron)   │   alerts_<iface>.jsonl (sustained alerts)       │
            ┌──>│   web_state_<iface>.json (live.php checkpoint)  │
            │   │   weekly_totals.log / monthly_totals.log        │
   bwprocs ─┘   └─────────────────┬───────────────────────────────┘
   (systemd)                      │
       │                          ▼
       │              ┌──────────────────────┐
       │              │   web/api/*.php      │
   nethogs ──────────>│  ↑ totals, history,  │
   (conntrack       ◄─┤  ↑ live, processes,  │
   read from         ┌┤  ↑ spikes, alerts    │
   /proc/net/        ││  └──────────────────┘
   nf_conntrack)     │└─────────┬─────────────┐
                     ▼          ▼             ▼
                  nginx + php-fpm  ──── browser (bwmon.js / Plotly)
```

- `bwcollect` reads `/proc/net/dev` every 5 min, computes RX/TX bps from the
  counter delta against the previous run, and appends one CSV row.
- `bwprocs` runs `nethogs -t -d 2 <iface>` as a long-lived child. It refreshes
  the live procs JSON on every nethogs tick and watches the iface total. When
  the iface total exceeds 5× the rolling 2-min average it captures the moment
  to `spikes_<iface>.jsonl` along with the top processes, all iface rates,
  and the top conntrack flows.
- `bwweekly` / `bwmonthly` integrate the CSV over a window and append one
  human-readable line to the totals log.
- The PHP API is stateless — every endpoint reads files from `/var/lib/bwmon/`
  and returns JSON. The browser polls `live.php` once a second and the other
  endpoints on demand.

---

## Data layout

Everything lives in `/var/lib/bwmon/`:

| File                            | Producer    | Purpose                                |
|---------------------------------|-------------|----------------------------------------|
| `bw_<iface>.csv`                | bwcollect   | 5-min RX/TX bps samples (6 months)     |
| `state_<iface>.json`            | bwcollect   | last-counter checkpoint                |
| `procs_<iface>.json`            | bwprocs     | live top processes (refreshed ~2 s)    |
| `spikes_<iface>.jsonl`          | bwprocs     | spike records with full attribution    |
| `alerts_<iface>.jsonl`          | bwprocs     | sustained-rate alert events            |
| `web_state_<iface>.json`        | live.php    | counter checkpoint for the live poller |
| `weekly_totals.log`             | bwweekly    | one line per week                      |
| `monthly_totals.log`            | bwmonthly   | one line per month                     |

---

## Configuration

Most tuneables live near the top of the relevant script.

| Setting              | File                          | Default        |
|----------------------|-------------------------------|----------------|
| Spike threshold      | `/usr/local/bin/bwprocs`      | 5× rolling avg |
| Rolling window       | `/usr/local/bin/bwprocs`      | 120 s          |
| Sustained alert bps  | `/usr/local/bin/bwprocs`      | 40 Mbps        |
| Alert hold time      | `/usr/local/bin/bwprocs`      | 300 s          |
| Sample interval      | `/etc/cron.d/bwmon`           | 5 min          |
| History retention    | `/usr/local/bin/bwcollect`    | 180 days       |
| Default iface (UI)   | nginx fastcgi_param           | `$IFACE` (install-time) |

---

## Authentication

The bundled nginx server block is open. For an internet-exposed install put
it behind a reverse proxy with auth, or add basic auth to the server block:

```nginx
auth_basic           "bwmon";
auth_basic_user_file /etc/nginx/.bwmon.htpasswd;
```

Generate the htpasswd file with `htpasswd -c /etc/nginx/.bwmon.htpasswd you`.

---

## CLI tools

Even with the web UI running, the CLI helpers stay useful:

```
bwmon              # curses-style live RX/TX top (no web stack needed)
bwhistory          # text-table history summary, last 24h by default
bwcollect <iface>  # take a sample now (idempotent — safe to run anytime)
bwweekly <iface>   # append a weekly total line and print it
bwmonthly <iface>  # append a monthly total line and print it
```

---

## Troubleshooting

### The dashboard loads but RX/TX are zero / dashes forever
Live numbers need the *second* `live.php` poll to have a delta — wait one
second after first paint. If they still don't move, hit `api/live.php?iface=<name>`
directly. Two checks:

- A `404 no data` means the interface name is wrong; pick from the dropdown.
- `rx_bps: null` / `tx_bps: null` on every poll means `/var/lib/bwmon/` isn't
  writable by the web server, so `live.php` can't maintain its counter
  checkpoint. Fix:
  ```bash
  sudo chgrp www-data /var/lib/bwmon && sudo chmod g+w /var/lib/bwmon
  ```
  (Or just re-run `sudo ./setup.sh` — newer builds set this automatically.)

### "no process data" in the live panel
`bwprocs@<iface>.service` isn't running. Check:
```bash
systemctl status bwprocs@<iface>.service
journalctl -u bwprocs@<iface>.service -n 50
```
The two common causes are (a) `nethogs` not installed and (b) `nethogs` is at
`/usr/bin/nethogs` instead of `/usr/sbin/nethogs`. The installer symlinks the
binary if needed; if you're managing it yourself, create the symlink:
```bash
ln -sf "$(command -v nethogs)" /usr/sbin/nethogs
```

### History chart is empty
`bwcollect` needs to run **twice** before there's a rate to plot — the first
run just records the counter. Wait one cron tick (default 5 min) or run it
manually as root.

### Empty red banner at the top of the dashboard
Fixed in this build. If you ever re-introduce it via a CSS edit, make sure
`.bw-alert-banner[hidden] { display: none; }` precedes the main rule, since
author CSS overrides the user-agent `[hidden]` rule.

### Spike forensics says "captured before flow tracking was enabled"
The spike record genuinely predates `iface_rates`/`top_flows` data — this
happens for spikes captured by an old `bwprocs` build. New spikes after
upgrading will have the full flow table.

### bwprocs crashes when conntrack table is huge (>1 M flows)
Reduce the number of flows captured per spike. Edit `MAX_FLOWS_PER_SPIKE`
near the top of `/usr/local/bin/bwprocs` (default 50) downward, then
`systemctl restart bwprocs@<iface>.service`.

### Reverse-proxied behind another nginx and the live poll 502's
`live.php` is sub-second; bump the upstream `proxy_read_timeout` to ≥ 30s
or you'll get spurious 502s during heavy load.

---

## Tested on

| OS                | Kernel | PHP   | Python | Notes                              |
|-------------------|--------|-------|--------|------------------------------------|
| Debian 11 (Bullseye) | 5.10  | 8.3   | 3.9    | Reference platform.                |
| Debian 12 (Bookworm) | 6.1   | 8.2   | 3.11   | Smoke-tested.                      |
| Ubuntu 22.04 LTS  | 5.15   | 8.1   | 3.10   | Works out of the box.              |
| Ubuntu 24.04 LTS  | 6.8    | 8.3   | 3.12   | Works out of the box.              |

If you've run it on something else, send a PR adding a row.

---

## Layout

```
bwmon/
├── setup.sh                one-click installer
├── uninstall.sh
├── bin/                    → /usr/local/bin/
│   ├── bwcollect           5-min sampler (cron)
│   ├── bwprocs             per-process daemon (systemd)
│   ├── bwhistory           CLI history viewer
│   ├── bwmon               curses-style live top
│   ├── bwweekly            weekly totalizer (cron)
│   └── bwmonthly           monthly totalizer (cron)
├── web/                    → /opt/bwmon/web/
│   ├── index.php
│   ├── bwmon.{js,css}
│   ├── vendor/plotly-basic.min.js
│   └── api/*.php
├── systemd/
│   └── bwprocs@.service
├── CHANGELOG.md
├── CONTRIBUTING.md
└── LICENSE
```

---

## License

MIT — see [LICENSE](LICENSE). Bundles
[plotly.js](https://github.com/plotly/plotly.js) basic build (also MIT).
