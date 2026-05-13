# Changelog

All notable changes to bwmon are documented here. Format roughly follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

## [Unreleased]

### Fixed
- `setup.sh` now creates `/var/lib/bwmon` group-owned by the php-fpm group
  (auto-detected: `www-data` on Debian/Ubuntu, falls back to `nginx`/`apache`/
  `http`) with mode `2775`. Without this, `live.php` couldn't write its
  counter checkpoint and the live graph never updated — every poll returned
  `rx_bps: null` / `tx_bps: null`. Re-running `sudo ./setup.sh` on an
  affected host fixes the permissions in place.

## [1.0.0] — 2026-05-13

Initial public release. The codebase is the production build that has been
running on a single host since 2026-05.

### Added
- Live RX/TX panel with 1-second polling.
- `bwprocs` per-process attribution daemon (wraps `nethogs`).
- Spike forensics with per-process attribution, all-iface RX/TX breakdown,
  and top conntrack flows by lifetime bytes.
- 6-month rolling history with adaptive bucketing for 1h / 24h / 7d / 30d /
  6m / all views.
- Hour-of-day × day-of-week heatmap and rate-distribution histogram.
- Sustained-alert tracking (≥ 40 Mbps for 5 min by default) with banner and
  history table.
- CLI helpers: `bwmon`, `bwhistory`, `bwcollect`, `bwweekly`, `bwmonthly`.
- One-shot installer (`setup.sh`) and uninstaller (`uninstall.sh`).

### Fixed (vs. earlier internal builds)
- Alert banner no longer renders as an empty red bar when there are no
  alerts (author CSS now sets `.bw-alert-banner[hidden] { display: none }`
  ahead of the main rule).
- Spike detail panel now renders the iface breakdown and top conntrack
  flows. The collector wrote both fields all along; the API was stripping
  them out of the response.
