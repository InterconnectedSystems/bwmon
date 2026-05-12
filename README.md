# bwmon

Self-hosted bandwidth monitor for a single Linux host. Polls `/proc/net/dev`
and `nethogs` to give you a live RX/TX graph, per-process attribution, spike
forensics with conntrack flow tables, and 6 months of history. No agents, no
cloud, no signup.

## What it does

- **Live panel** — RX/TX bars and a 1-second-poll rolling graph for the active interface.
- **Per-process attribution** — wraps `nethogs` in a daemon and writes the top talkers
  to a JSON file every ~2 s. Spikes are captured along with the top processes at the
  moment they fire.
- **Spike forensics** — when iface total exceeds 5× the rolling 2-minute average, a
  spike record is written that includes per-process attribution, iface breakdown
  (so you can see VM/WireGuard/NAT forwarding), and the top conntrack flows by
  lifetime bytes.
- **History** — 5-minute samples kept for 6 months with adaptive bucketing
  (1h / 24h / 7d / 30d / 6m / all-time views).
- **Heatmap** — hour-of-day × day-of-week average rate.
- **Distribution** — histogram of how often each rate occurs.
- **Sustained alerts** — when the rolling 5-minute average crosses 40 Mbps the
  banner lights up; cleared alerts are kept in history.

## Requirements

- Debian / Ubuntu host (the installer uses `apt`).
- Root access to install the systemd unit and cron entries.
- A network interface to watch (auto-detected from the default route).
- `nethogs`, `php-fpm`, `php-cli`, `nginx` — the installer pulls these in for you.

Other distros: read `setup.sh`, install the equivalents by hand, then run
`./setup.sh --skip-deps`.

## Install

```bash
git clone <this repo> bwmon
cd bwmon
sudo ./setup.sh
```

That's it. The installer auto-detects your default interface, drops an
nginx server block on port 8080, registers the cron schedule, and brings up
`bwprocs@<iface>.service`. When it finishes it prints a URL.

### Options

| Flag             | Default        | Notes                                                  |
|------------------|----------------|--------------------------------------------------------|
| `--iface <name>` | auto-detect    | Interface to monitor.                                  |
| `--port <n>`     | `8080`         | Port for the nginx server block.                       |
| `--prefix <dir>` | `/opt/bwmon`   | Where the web files land.                              |
| `--skip-deps`    | off            | Don't run `apt-get install`. Use on non-Debian hosts.  |
| `--skip-nginx`   | off            | Don't write or reload nginx. Use if you wire your own. |

Environment variables `IFACE`, `PORT`, `PREFIX`, `DATA_DIR`, `BIN_DIR`,
`SYSTEMD_DIR` are honored as well.

### Updating

Pull the latest source and re-run `sudo ./setup.sh`. The installer is
idempotent — it overwrites scripts and the web app, reloads systemd, and
reloads nginx without disturbing your data in `/var/lib/bwmon/`.

### Uninstall

```bash
sudo ./uninstall.sh             # leaves /var/lib/bwmon intact
sudo ./uninstall.sh --purge-data  # wipes the data too
```

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
└── systemd/
    └── bwprocs@.service
```

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

## Authentication

The bundled nginx server block is open. For an internet-exposed install put it
behind a reverse proxy with auth, or add `auth_basic` to the server block:

```nginx
auth_basic           "bwmon";
auth_basic_user_file /etc/nginx/.bwmon.htpasswd;
```

Generate the htpasswd file with `htpasswd -c /etc/nginx/.bwmon.htpasswd you`.

## Tuning

- **Spike threshold** — `bwprocs` flags an event when iface total exceeds 5× the
  rolling 2-minute average. Edit `THRESHOLD` near the top of `/usr/local/bin/bwprocs`.
- **Alert threshold** — sustained ≥ 40 Mbps for 5 min. Same file, `ALERT_BPS`.
- **History retention** — 6 months. Edit `KEEP` in `/usr/local/bin/bwcollect`.
- **Default interface** — set `BWMON_IFACE` in the nginx server block's
  `fastcgi_param` line (the installer wires this for you).

## CLI tools

Even with the web UI running, the CLI helpers stay useful:

```
bwmon              # curses-style live RX/TX top
bwhistory          # text history summary
bwcollect <iface>  # take a sample now (idempotent)
bwweekly <iface>   # append a weekly total line
bwmonthly <iface>  # append a monthly total line
```

## License

MIT — see `LICENSE`.
