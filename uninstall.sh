#!/usr/bin/env bash
# bwmon — uninstaller.
#
# Removes collector scripts, systemd unit, cron, nginx server block, and web root.
# Does NOT delete /var/lib/bwmon by default — pass --purge-data to wipe it.

set -euo pipefail

PREFIX="${PREFIX:-/opt/bwmon}"
DATA_DIR="${DATA_DIR:-/var/lib/bwmon}"
BIN_DIR="${BIN_DIR:-/usr/local/bin}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
PURGE_DATA=0

while [ $# -gt 0 ]; do
    case "$1" in
        --purge-data) PURGE_DATA=1; shift ;;
        -h|--help) echo "Usage: sudo $0 [--purge-data]"; exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done

[ "$(id -u)" -eq 0 ] || { echo "must be run as root" >&2; exit 1; }

log(){ printf '\e[36m▮\e[0m %s\n' "$*"; }
ok(){  printf '\e[32m✓\e[0m %s\n' "$*"; }

log "stopping bwprocs services"
for svc in $(systemctl list-units --no-legend --plain 'bwprocs@*.service' 2>/dev/null | awk '{print $1}'); do
    systemctl disable --now "$svc" >/dev/null 2>&1 || true
done

log "removing systemd unit"
rm -f "$SYSTEMD_DIR/bwprocs@.service"
systemctl daemon-reload

log "removing cron"
rm -f /etc/cron.d/bwmon

log "removing module/sysctl drop-ins"
rm -f /etc/modules-load.d/bwmon.conf /etc/sysctl.d/99-bwmon-conntrack.conf

log "removing collector scripts"
for f in bwcollect bwprocs bwhistory bwmon bwweekly bwmonthly; do
    rm -f "$BIN_DIR/$f"
done

log "removing nginx server block"
rm -f /etc/nginx/sites-enabled/bwmon /etc/nginx/sites-available/bwmon /etc/nginx/conf.d/bwmon.conf
if command -v nginx >/dev/null && nginx -t 2>/dev/null; then
    systemctl reload nginx 2>/dev/null || true
fi

log "removing web root"
rm -rf "$PREFIX/web"
rmdir "$PREFIX" 2>/dev/null || true

if [ "$PURGE_DATA" -eq 1 ]; then
    log "deleting $DATA_DIR (--purge-data)"
    rm -rf "$DATA_DIR"
else
    log "leaving $DATA_DIR intact (pass --purge-data to delete)"
fi

ok "bwmon removed"
