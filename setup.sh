#!/usr/bin/env bash
# bwmon — one-shot installer.
#
# Installs: nethogs + php-fpm + nginx (apt), copies collector scripts,
# enables systemd unit, drops nginx server block, registers cron jobs.
# Idempotent — re-run safely to update or repair.

set -euo pipefail

PREFIX="${PREFIX:-/opt/bwmon}"
DATA_DIR="${DATA_DIR:-/var/lib/bwmon}"
BIN_DIR="${BIN_DIR:-/usr/local/bin}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
PORT="${PORT:-8080}"
IFACE="${IFACE:-}"
SKIP_DEPS=0
SKIP_NGINX=0
WEB_USER="${WEB_USER:-www-data}"

usage() {
    cat <<EOF
Usage: sudo $0 [options]

Options:
  --iface <name>    Network interface to monitor (default: auto-detect)
  --port <n>        Port for the nginx server block (default: 8080)
  --prefix <dir>    Install root for web files (default: /opt/bwmon)
  --skip-deps       Don't run apt-get install
  --skip-nginx      Don't write/enable an nginx server block
  -h, --help        Show this help
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --iface)      IFACE="$2"; shift 2 ;;
        --port)       PORT="$2"; shift 2 ;;
        --prefix)     PREFIX="$2"; shift 2 ;;
        --skip-deps)  SKIP_DEPS=1; shift ;;
        --skip-nginx) SKIP_NGINX=1; shift ;;
        -h|--help)    usage; exit 0 ;;
        *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
done

if [ "$(id -u)" -ne 0 ]; then
    echo "must be run as root (try: sudo $0)" >&2
    exit 1
fi

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

log() { printf '\e[36m▮\e[0m %s\n' "$*"; }
ok()  { printf '\e[32m✓\e[0m %s\n' "$*"; }
warn(){ printf '\e[33m!\e[0m %s\n' "$*" >&2; }
die() { printf '\e[31m✗\e[0m %s\n' "$*" >&2; exit 1; }

# ── Detect interface ──────────────────────────────────────────────────────────
if [ -z "$IFACE" ]; then
    IFACE="$(ip -4 route show default 2>/dev/null | awk '/^default/ {print $5; exit}')"
    [ -z "$IFACE" ] && IFACE="$(ls /sys/class/net/ | grep -v '^lo$' | head -1)"
    [ -z "$IFACE" ] && die "could not detect a network interface — pass --iface <name>"
fi
[ -d "/sys/class/net/$IFACE" ] || die "interface '$IFACE' not present on this host"
log "interface:       $IFACE"
log "install prefix:  $PREFIX"
log "data directory:  $DATA_DIR"
log "web port:        $PORT"

# ── Dependencies ──────────────────────────────────────────────────────────────
if [ "$SKIP_DEPS" -eq 0 ]; then
    log "installing apt packages (nethogs, php-fpm, php-cli, nginx)…"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq nethogs php-fpm php-cli nginx >/dev/null
    ok   "dependencies installed"
fi

NETHOGS_BIN="$(command -v nethogs || true)"
[ -z "$NETHOGS_BIN" ] && die "nethogs not found — install it or re-run without --skip-deps"
if [ "$NETHOGS_BIN" != "/usr/sbin/nethogs" ] && [ ! -e /usr/sbin/nethogs ]; then
    ln -sf "$NETHOGS_BIN" /usr/sbin/nethogs
    ok "symlinked $NETHOGS_BIN → /usr/sbin/nethogs (bwprocs expects this path)"
fi

# ── Collector scripts ─────────────────────────────────────────────────────────
log "installing collector scripts to $BIN_DIR/"
install -m 0755 "$SRC_DIR/bin/bwcollect" "$BIN_DIR/bwcollect"
install -m 0755 "$SRC_DIR/bin/bwprocs"   "$BIN_DIR/bwprocs"
install -m 0755 "$SRC_DIR/bin/bwhistory" "$BIN_DIR/bwhistory"
install -m 0755 "$SRC_DIR/bin/bwmon"     "$BIN_DIR/bwmon"
install -m 0755 "$SRC_DIR/bin/bwweekly"  "$BIN_DIR/bwweekly"
install -m 0755 "$SRC_DIR/bin/bwmonthly" "$BIN_DIR/bwmonthly"
ok "collector scripts installed"

# ── Data directory ────────────────────────────────────────────────────────────
install -d -m 0755 -o root -g root "$DATA_DIR"
ok "data directory ready: $DATA_DIR"

# ── Web root ──────────────────────────────────────────────────────────────────
log "copying web app to $PREFIX/web/"
install -d -m 0755 "$PREFIX/web/api" "$PREFIX/web/vendor"
install -m 0644 "$SRC_DIR/web/index.php" "$PREFIX/web/index.php"
install -m 0644 "$SRC_DIR/web/bwmon.css" "$PREFIX/web/bwmon.css"
install -m 0644 "$SRC_DIR/web/bwmon.js"  "$PREFIX/web/bwmon.js"
install -m 0644 "$SRC_DIR/web/vendor/plotly-basic.min.js" "$PREFIX/web/vendor/plotly-basic.min.js"
for f in "$SRC_DIR"/web/api/*.php; do
    install -m 0644 "$f" "$PREFIX/web/api/$(basename "$f")"
done
ok "web app deployed"

# ── systemd unit ──────────────────────────────────────────────────────────────
install -m 0644 "$SRC_DIR/systemd/bwprocs@.service" "$SYSTEMD_DIR/bwprocs@.service"
systemctl daemon-reload
systemctl enable --now "bwprocs@${IFACE}.service" >/dev/null
ok "bwprocs@${IFACE}.service enabled and started"

# ── Cron ──────────────────────────────────────────────────────────────────────
CRON_FILE=/etc/cron.d/bwmon
cat >"$CRON_FILE" <<EOF
# bwmon — 5-minute sampler + weekly/monthly totals
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
*/5 * * * * root $BIN_DIR/bwcollect $IFACE
0   0 * * 0 root $BIN_DIR/bwweekly  $IFACE
0   0 1 * * root $BIN_DIR/bwmonthly $IFACE
EOF
chmod 0644 "$CRON_FILE"
ok "cron schedule written to $CRON_FILE"

# Prime the counter so the first 5-minute sample isn't lost
"$BIN_DIR/bwcollect" "$IFACE" >/dev/null || true

# ── nginx ─────────────────────────────────────────────────────────────────────
if [ "$SKIP_NGINX" -eq 0 ]; then
    PHP_SOCK="$(ls /run/php/php*-fpm.sock 2>/dev/null | sort -V | tail -1 || true)"
    if [ -z "$PHP_SOCK" ]; then
        warn "no php-fpm socket found under /run/php/ — skipping nginx config"
    else
        log "writing nginx server block (php-fpm: $PHP_SOCK)"
        SITES_AVAIL=/etc/nginx/sites-available
        SITES_ENABL=/etc/nginx/sites-enabled
        [ -d "$SITES_AVAIL" ] || SITES_AVAIL=/etc/nginx/conf.d
        [ -d "$SITES_ENABL" ] || SITES_ENABL="$SITES_AVAIL"
        CONF_PATH="$SITES_AVAIL/bwmon"
        [ "$SITES_AVAIL" = "/etc/nginx/conf.d" ] && CONF_PATH="$SITES_AVAIL/bwmon.conf"
        cat >"$CONF_PATH" <<NGINX
server {
    listen $PORT default_server;
    listen [::]:$PORT default_server;

    server_name _;
    root $PREFIX/web;
    index index.php;

    access_log /var/log/nginx/bwmon.access.log;
    error_log  /var/log/nginx/bwmon.error.log;

    location / {
        try_files \$uri \$uri/ /index.php\$is_args\$args;
    }

    location ~ \.php\$ {
        include fastcgi_params;
        fastcgi_pass unix:$PHP_SOCK;
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
        fastcgi_param BWMON_IFACE     "$IFACE";
        fastcgi_read_timeout 30s;
    }

    location ~ /\. { deny all; }
}
NGINX
        if [ "$SITES_AVAIL" != "$SITES_ENABL" ] && [ ! -e "$SITES_ENABL/bwmon" ]; then
            ln -s "$CONF_PATH" "$SITES_ENABL/bwmon"
        fi
        if nginx -t 2>/dev/null; then
            systemctl reload nginx
            ok "nginx reloaded — site live"
        else
            warn "nginx -t failed; not reloading. Inspect: $CONF_PATH"
            nginx -t || true
        fi
    fi
fi

HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -z "$HOST_IP" ] && HOST_IP="localhost"

echo
ok "bwmon installed."
echo "    URL:        http://$HOST_IP:$PORT/"
echo "    web root:   $PREFIX/web/"
echo "    data:       $DATA_DIR/"
echo "    service:    systemctl status bwprocs@${IFACE}.service"
echo "    samples:    tail -f $DATA_DIR/bw_${IFACE}.csv"
echo
echo "First history points appear after the 5-minute cron fires twice; live RX/TX is immediate."
