#!/usr/bin/env bash
#
# Installs the Inter-Sprint ingestion worker on the FTP VM.
#
# Idempotent: safe to re-run after every deploy. It provisions no runtime,
# because the worker needs none — bash, curl, sha256sum, gzip and flock are
# already on a stock Ubuntu. That is a deliberate security choice: this box is
# reachable from the internet on port 21, and adding Node plus an npm tree
# would widen its attack surface for no benefit. All parsing and all database
# access happen on the application server.
#
#   sudo ./install.sh
#
# Afterwards, fill in /etc/gommarush/intersprint-worker.env. NO SECRET IS
# WRITTEN BY THIS SCRIPT.

set -Eeuo pipefail

WORKER_USER="${WORKER_USER:-gr-ingest}"
WORKER_GROUP="${WORKER_GROUP:-gr-ingest}"
FTP_USER="${FTP_USER:-intersprint}"
FEED_ROOT="${FEED_ROOT:-/srv/ftp/intersprint}"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/lib/gommarush}"
CONFIG_DIR="${CONFIG_DIR:-/etc/gommarush}"
CONFIG_FILE="$CONFIG_DIR/intersprint-worker.env"
LOG_FILE="${LOG_FILE:-/var/log/gommarush/intersprint-worker.log}"
LOCK_FILE="${LOCK_FILE:-/var/lock/gommarush-intersprint-worker.lock}"

log() { printf '  %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "run as root"
[[ -d "$FEED_ROOT" ]] || die "$FEED_ROOT does not exist; run infra/ftp/provision-intersprint-ftp.sh first"

# --- least-privileged worker account ----------------------------------------
# No shell, no home, no password. It exists only to own a cron job and read
# one secret file.
if ! id -u "$WORKER_USER" >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$WORKER_USER"
  log "created system user $WORKER_USER (no shell)"
else
  log "system user $WORKER_USER already exists"
fi

# --- directory permissions ---------------------------------------------------
# incoming/  supplier writes, worker must be able to move files OUT of it, so
#            it is group-writable by the worker's group.
# the rest   owned by the worker; the FTP user cannot read our archive at all,
#            which is tighter than the original provisioning.
install -d -o root -g root -m 0755 "$FEED_ROOT"
install -d -o "$FTP_USER" -g "$WORKER_GROUP" -m 0770 "$FEED_ROOT/incoming"
for dir in processing processed failed; do
  install -d -o "$WORKER_USER" -g "$WORKER_GROUP" -m 0750 "$FEED_ROOT/$dir"
done
log "feed directories under $FEED_ROOT prepared"

# --- worker script -----------------------------------------------------------
install -d -o root -g root -m 0755 "$INSTALL_DIR"
install -o root -g "$WORKER_GROUP" -m 0750 \
  "$(dirname "$0")/ingest-feed.sh" "$INSTALL_DIR/intersprint-ingest-feed.sh"
log "worker installed at $INSTALL_DIR/intersprint-ingest-feed.sh"

# --- configuration (no secrets written here) ---------------------------------
install -d -o root -g "$WORKER_GROUP" -m 0750 "$CONFIG_DIR"
if [[ ! -f "$CONFIG_FILE" ]]; then
  cat > "$CONFIG_FILE" <<'ENV'
# Inter-Sprint ingestion worker configuration.
#
# NOT IN GIT. Readable by root and the worker group only.

# The application endpoints. Use the production hostname, HTTPS only.
INGEST_URL=https://REPLACE_ME/api/feed/intersprint/ingest
COMMIT_URL=https://REPLACE_ME/api/feed/intersprint/commit

# Must match FEED_WORKER_TOKEN in the application environment.
# Generate with:  openssl rand -hex 32
FEED_WORKER_TOKEN=

# Seconds a file must stop changing before it is believed complete.
# vsftpd STOR is not atomic; the file appears at its final name and grows.
STABLE_SECONDS=90
ENV
  chown root:"$WORKER_GROUP" "$CONFIG_FILE"
  chmod 0640 "$CONFIG_FILE"
  log "created $CONFIG_FILE — FILL IN THE URLS AND TOKEN"
else
  chown root:"$WORKER_GROUP" "$CONFIG_FILE"
  chmod 0640 "$CONFIG_FILE"
  log "$CONFIG_FILE already exists; permissions reasserted"
fi

# --- log destination ---------------------------------------------------------
install -d -o "$WORKER_USER" -g "$WORKER_GROUP" -m 0750 "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"
chown "$WORKER_USER":"$WORKER_GROUP" "$LOG_FILE"
chmod 0640 "$LOG_FILE"

cat > /etc/logrotate.d/gommarush-intersprint-worker <<ROTATE
$LOG_FILE {
  weekly
  rotate 8
  compress
  missingok
  notifempty
  create 0640 $WORKER_USER $WORKER_GROUP
}
ROTATE
log "logging to $LOG_FILE, rotated weekly"

# --- schedule ----------------------------------------------------------------
# Every 10 minutes. The supplier uploads a handful of times a day at roughly
# 06:27/10:27/12:2x/14:27, but those times are an observation, not a promise —
# polling on a short fixed interval ingests soon after any delivery without
# depending on the schedule holding.
#
# flock -n makes overlapping runs impossible: a second invocation exits
# immediately rather than racing the first for the same file.
install -o root -g root -m 0644 /dev/stdin /etc/cron.d/gommarush-intersprint-worker <<CRON
# Inter-Sprint feed ingestion. Managed by infra/intersprint-worker/install.sh.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/10 * * * * $WORKER_USER flock -n $LOCK_FILE $INSTALL_DIR/intersprint-ingest-feed.sh >> $LOG_FILE 2>&1
CRON
log "cron installed: every 10 minutes as $WORKER_USER, serialised with flock"

printf '\nDone. Remaining manual steps:\n'
printf '  1. Edit %s and set INGEST_URL, COMMIT_URL and FEED_WORKER_TOKEN.\n' "$CONFIG_FILE"
printf '  2. Set the SAME token as FEED_WORKER_TOKEN in the application environment,\n'
printf '     along with INTERSPRINT_SUPPLIER_ID.\n'
printf '  3. Dry run:  sudo -u %s %s/intersprint-ingest-feed.sh\n' "$WORKER_USER" "$INSTALL_DIR"
printf '  4. Watch:    tail -f %s\n' "$LOG_FILE"
