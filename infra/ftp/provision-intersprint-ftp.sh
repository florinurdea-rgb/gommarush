#!/usr/bin/env bash
#
# GommaRush — Inter-Sprint FTP endpoint provisioning
# ==================================================
# Configures an Ubuntu server as a plain-FTP drop point for Inter-Sprint.
#
# IDEMPOTENT: safe to run any number of times. Every file is written only
# when its content actually differs, the service is restarted only when
# something changed, and the FTP password is generated once and then left
# alone unless you explicitly pass a new one.
#
#   Usage (as root):
#     bash provision-intersprint-ftp.sh
#
#   Optional environment overrides:
#     INTERSPRINT_PASSWORD=...        set/rotate the password explicitly
#     INTERSPRINT_ALLOWED_IPS="a b"   restrict FTP to these source addresses
#     SSH_PORT=22                     if sshd listens somewhere else
#
# ---------------------------------------------------------------------------
# SECURITY NOTE, deliberately at the top
# ---------------------------------------------------------------------------
# This configures PLAIN FTP, as specified. FTP has no transport encryption:
# the username, the password and every byte of every file cross the internet
# in clear text, and anyone on the path can read or alter them. Nothing in
# this script can fix that — it is a property of the protocol.
#
# The single most effective mitigation is to stop accepting FTP from the
# whole internet. Set INTERSPRINT_ALLOWED_IPS to Inter-Sprint's source
# addresses and the firewall will only open port 21 and the passive range to
# them. Ask Inter-Sprint for their egress IPs; most EDI partners publish
# them. Everything else here (no anonymous access, no shell, chroot, a
# single permitted user, a restricted passive range) limits what an attacker
# can do AFTER they have the credentials, not whether they can obtain them.
# ---------------------------------------------------------------------------

set -euo pipefail

FTP_USER="${FTP_USER:-intersprint}"
FTP_HOME="${FTP_HOME:-/srv/ftp/intersprint}"
PUBLIC_IP="${PUBLIC_IP:-62.238.60.247}"
PASV_MIN_PORT="${PASV_MIN_PORT:-40000}"
PASV_MAX_PORT="${PASV_MAX_PORT:-40020}"
SSH_PORT="${SSH_PORT:-22}"
ALLOWED_IPS="${INTERSPRINT_ALLOWED_IPS:-}"
CREDENTIALS_FILE="/root/${FTP_USER}-ftp-credentials.txt"

CHANGED=0
RESTART_SSHD=0

log()  { printf '  %s\n' "$*"; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mFAILED:\033[0m %s\n' "$*" >&2; exit 1; }

# Writes stdin to $1 with mode $2, but only if the content differs. This is
# what makes re-running the script a no-op rather than a service restart.
install_file() {
  local dest="$1" mode="$2" tmp
  tmp="$(mktemp)"
  cat > "$tmp"
  if [[ -f "$dest" ]] && cmp -s "$tmp" "$dest"; then
    rm -f "$tmp"
    log "unchanged  $dest"
    return 0
  fi
  install -m "$mode" -o root -g root "$tmp" "$dest"
  rm -f "$tmp"
  CHANGED=1
  ok "wrote      $dest"
}

# ---------------------------------------------------------------------------
step "Preflight"
# ---------------------------------------------------------------------------
[[ ${EUID} -eq 0 ]] || die "must run as root"

if [[ -r /etc/os-release ]]; then
  . /etc/os-release
  log "host: ${PRETTY_NAME:-unknown}"
  [[ "${ID:-}" == "ubuntu" ]] || warn "not Ubuntu — package names may differ"
fi
log "public IP: ${PUBLIC_IP}"
log "ftp user:  ${FTP_USER}"
if [[ -n "${ALLOWED_IPS}" ]]; then
  ok "FTP restricted to: ${ALLOWED_IPS}"
else
  warn "FTP will be reachable from ANY address — see the security note above"
fi

# ---------------------------------------------------------------------------
step "Packages"
# ---------------------------------------------------------------------------
NEEDED=()
for pkg in vsftpd ufw; do
  dpkg -s "$pkg" >/dev/null 2>&1 || NEEDED+=("$pkg")
done
if ((${#NEEDED[@]})); then
  log "installing: ${NEEDED[*]}"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq "${NEEDED[@]}"
  ok "installed"
else
  log "vsftpd and ufw already present"
fi

# ---------------------------------------------------------------------------
step "FTP user"
# ---------------------------------------------------------------------------
# /usr/sbin/nologin gives the account no interactive shell at all. It must
# still appear in /etc/shells, because Ubuntu's PAM stack for vsftpd runs
# pam_shells, which refuses to authenticate a user whose shell is not listed.
# Omitting this is the classic cause of "530 Login incorrect" on an account
# whose password is perfectly correct.
if ! grep -qxF '/usr/sbin/nologin' /etc/shells; then
  echo '/usr/sbin/nologin' >> /etc/shells
  ok "added /usr/sbin/nologin to /etc/shells"
else
  log "/etc/shells already lists /usr/sbin/nologin"
fi

# The home directory tree is built explicitly further down, with ownership
# that vsftpd's chroot depends on. useradd must therefore NOT create it:
# --create-home would make the chroot root owned by the FTP user, which is
# precisely the layout vsftpd refuses to start on. The parent is created
# here so usermod has somewhere to point.
install -d -o root -g root -m 0755 "$(dirname "$FTP_HOME")"

if id -u "$FTP_USER" >/dev/null 2>&1; then
  log "user ${FTP_USER} exists"
  usermod --home "$FTP_HOME" --shell /usr/sbin/nologin "$FTP_USER"
else
  useradd --home-dir "$FTP_HOME" --shell /usr/sbin/nologin \
          --no-create-home --comment "Inter-Sprint FTP drop" "$FTP_USER"
  ok "created user ${FTP_USER}"
fi

# Password policy: generated once, then left alone. Re-running the script
# must not silently rotate a credential Inter-Sprint is already using.
if [[ -n "${INTERSPRINT_PASSWORD:-}" ]]; then
  FTP_PASSWORD="${INTERSPRINT_PASSWORD}"
  printf '%s:%s\n' "$FTP_USER" "$FTP_PASSWORD" | chpasswd
  ok "password set from INTERSPRINT_PASSWORD"
  WRITE_CREDS=1
elif [[ -s "$CREDENTIALS_FILE" ]]; then
  FTP_PASSWORD="$(awk -F': *' '/^password:/{print $2}' "$CREDENTIALS_FILE")"
  log "password unchanged (see ${CREDENTIALS_FILE})"
  WRITE_CREDS=0
else
  # 28 alphanumeric characters ≈ 166 bits. Alphanumeric on purpose: symbols
  # are where FTP clients and shell quoting go wrong, and length buys far
  # more than punctuation does.
  #
  # Note the shape: a BOUNDED read that ends on its own, then a substring.
  # The obvious `tr -dc ... < /dev/urandom | head -c 28` cannot be used here
  # — head closes the pipe, tr dies of SIGPIPE, and under `set -o pipefail`
  # the pipeline returns 141 and takes the whole script down with it.
  FTP_PASSWORD="$(LC_ALL=C tr -dc 'A-Za-z0-9' < <(head -c 4096 /dev/urandom))"
  FTP_PASSWORD="${FTP_PASSWORD:0:28}"
  [[ ${#FTP_PASSWORD} -eq 28 ]] || die "password generation produced ${#FTP_PASSWORD} characters"
  printf '%s:%s\n' "$FTP_USER" "$FTP_PASSWORD" | chpasswd
  ok "generated a new password"
  WRITE_CREDS=1
fi

if [[ "$WRITE_CREDS" == "1" ]]; then
  umask 077
  cat > "$CREDENTIALS_FILE" <<CREDS
GommaRush — Inter-Sprint FTP credentials
generated: $(date -Is)

host:     ${PUBLIC_IP}
port:     21
protocol: FTP (plain, no TLS)
mode:     passive (data ports ${PASV_MIN_PORT}-${PASV_MAX_PORT})
username: ${FTP_USER}
password: ${FTP_PASSWORD}
upload to: /incoming

This file is readable only by root. It is NOT in the git repository.
CREDS
  chmod 600 "$CREDENTIALS_FILE"
  ok "credentials written to ${CREDENTIALS_FILE} (mode 600)"
fi

# ---------------------------------------------------------------------------
step "Directories"
# ---------------------------------------------------------------------------
# The chroot root itself is owned by root and NOT writable by the FTP user.
# vsftpd refuses to chroot into a writable directory ("500 OOPS: vsftpd:
# refusing to run with writable root inside chroot()"), and the usual
# workaround — allow_writeable_chroot=YES — throws away the protection
# instead of satisfying it. Owning the root and writing only inside it is
# the correct shape, so allow_writeable_chroot stays off.
install -d -o root -g root -m 0755 "$FTP_HOME"

# Only `incoming` is writable by Inter-Sprint. The other three belong to our
# own pipeline: once a file has been picked up, the partner must not be able
# to alter or delete the record of what we processed.
install -d -o "$FTP_USER" -g "$FTP_USER" -m 0750 "$FTP_HOME/incoming"
for dir in processing processed failed; do
  install -d -o root -g "$FTP_USER" -m 0750 "$FTP_HOME/$dir"
done
ok "chroot ${FTP_HOME} (root-owned) with incoming/ processing/ processed/ failed/"
log "incoming is writable by ${FTP_USER}; the other three are read-only to it"

install -d -o root -g root -m 0755 /var/run/vsftpd/empty

# ---------------------------------------------------------------------------
step "vsftpd configuration"
# ---------------------------------------------------------------------------
install_file /etc/vsftpd.conf 0644 <<CONF
# Managed by infra/ftp/provision-intersprint-ftp.sh — edit there, not here.
# GommaRush Inter-Sprint FTP endpoint.

# --- listener -------------------------------------------------------------
listen=YES
listen_ipv6=NO
ftpd_banner=GommaRush file transfer

# --- who may log in -------------------------------------------------------
anonymous_enable=NO
local_enable=YES
# Only users named in the userlist may authenticate at all, which keeps every
# other system account off this service even if one grows a password.
userlist_enable=YES
userlist_file=/etc/vsftpd.userlist
userlist_deny=NO
pam_service_name=vsftpd

# --- confinement ----------------------------------------------------------
chroot_local_user=YES
allow_writeable_chroot=NO
secure_chroot_dir=/var/run/vsftpd/empty
# Ownership is not the partner's business.
hide_ids=YES

# --- writes ---------------------------------------------------------------
write_enable=YES
local_umask=022
dirmessage_enable=YES
use_localtime=YES

# --- data connections -----------------------------------------------------
connect_from_port_20=YES
pasv_enable=YES
pasv_min_port=${PASV_MIN_PORT}
pasv_max_port=${PASV_MAX_PORT}
# Stated explicitly so the PASV reply always advertises the public address,
# whatever the interface happens to be called.
pasv_address=${PUBLIC_IP}

# --- transport ------------------------------------------------------------
# Plain FTP, as specified. Nothing below is encrypted.
ssl_enable=NO

# --- logging --------------------------------------------------------------
xferlog_enable=YES
xferlog_std_format=NO
vsftpd_log_file=/var/log/vsftpd.log
# Both formats: the vsftpd log is readable, the wu-ftpd one is what most log
# analysers expect.
dual_log_enable=YES
xferlog_file=/var/log/xferlog
log_ftp_protocol=YES

# --- limits ---------------------------------------------------------------
idle_session_timeout=600
data_connection_timeout=300
max_clients=20
max_per_ip=5
CONF

install_file /etc/vsftpd.userlist 0644 <<LIST
${FTP_USER}
LIST

# ---------------------------------------------------------------------------
step "Deny SSH to the FTP account"
# ---------------------------------------------------------------------------
# Belt and braces: the nologin shell already prevents an interactive session,
# this stops sshd from even authenticating the account.
SSHD_DROPIN=/etc/ssh/sshd_config.d/99-gommarush-ftp.conf
if [[ ! -f /etc/ssh/sshd_config ]]; then
  # No sshd on this host. The nologin shell already denies a shell, so there
  # is nothing to reinforce and nothing to fail over.
  log "no /etc/ssh/sshd_config — skipping (nologin shell already denies access)"
elif grep -qE '^\s*Include\s+/etc/ssh/sshd_config\.d/' /etc/ssh/sshd_config 2>/dev/null; then
  install -d -m 0755 /etc/ssh/sshd_config.d
  before="$(cat "$SSHD_DROPIN" 2>/dev/null || true)"
  install_file "$SSHD_DROPIN" 0644 <<SSHD
# Managed by infra/ftp/provision-intersprint-ftp.sh
DenyUsers ${FTP_USER}
SSHD
  [[ "$before" != "$(cat "$SSHD_DROPIN")" ]] && RESTART_SSHD=1
else
  # Older sshd with no Include: manage a marked block in the main config.
  if ! grep -q '# BEGIN gommarush-ftp' /etc/ssh/sshd_config; then
    printf '\n# BEGIN gommarush-ftp\nDenyUsers %s\n# END gommarush-ftp\n' \
      "$FTP_USER" >> /etc/ssh/sshd_config
    RESTART_SSHD=1
    ok "appended DenyUsers block to /etc/ssh/sshd_config"
  else
    log "DenyUsers block already present"
  fi
fi

if [[ "$RESTART_SSHD" == "1" ]]; then
  if sshd -t; then
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
    ok "sshd configuration reloaded"
  else
    warn "sshd -t failed; leaving sshd untouched"
  fi
fi

# ---------------------------------------------------------------------------
step "Log rotation"
# ---------------------------------------------------------------------------
install_file /etc/logrotate.d/vsftpd-gommarush 0644 <<'ROTATE'
# Managed by infra/ftp/provision-intersprint-ftp.sh
/var/log/vsftpd.log /var/log/xferlog {
    weekly
    rotate 26
    missingok
    notifempty
    compress
    delaycompress
    create 0640 root adm
    sharedscripts
    postrotate
        systemctl kill -s HUP vsftpd.service 2>/dev/null || true
    endscript
}
ROTATE

touch /var/log/vsftpd.log /var/log/xferlog
chmod 0640 /var/log/vsftpd.log /var/log/xferlog

# ---------------------------------------------------------------------------
step "Firewall"
# ---------------------------------------------------------------------------
# SSH is opened FIRST and unconditionally. Enabling ufw without it is how a
# remote server becomes unreachable.
ufw allow "${SSH_PORT}/tcp" comment 'SSH' >/dev/null
ok "allow ${SSH_PORT}/tcp (SSH)"

if [[ -n "${ALLOWED_IPS}" ]]; then
  # Moving from open to restricted: drop any blanket rules first, or they
  # would keep the port open to everyone and make the allowlist decorative.
  ufw delete allow 21/tcp >/dev/null 2>&1 || true
  ufw delete allow "${PASV_MIN_PORT}:${PASV_MAX_PORT}/tcp" >/dev/null 2>&1 || true
  for ip in ${ALLOWED_IPS//,/ }; do
    ufw allow from "$ip" to any port 21 proto tcp comment 'Inter-Sprint FTP' >/dev/null
    ufw allow from "$ip" to any port "${PASV_MIN_PORT}:${PASV_MAX_PORT}" proto tcp \
      comment 'Inter-Sprint FTP passive' >/dev/null
    ok "allow FTP + passive from ${ip}"
  done
else
  ufw allow 21/tcp comment 'FTP control' >/dev/null
  ufw allow "${PASV_MIN_PORT}:${PASV_MAX_PORT}/tcp" comment 'FTP passive' >/dev/null
  ok "allow 21/tcp and ${PASV_MIN_PORT}-${PASV_MAX_PORT}/tcp (any source)"
fi

ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
if ufw status | head -1 | grep -q inactive; then
  ufw --force enable >/dev/null
  ok "ufw enabled"
else
  log "ufw already active"
fi

# ---------------------------------------------------------------------------
step "Service"
# ---------------------------------------------------------------------------
systemctl enable vsftpd >/dev/null 2>&1
ok "vsftpd enabled (starts automatically after reboot)"

if [[ "$CHANGED" == "1" ]] || ! systemctl is-active --quiet vsftpd; then
  systemctl restart vsftpd
  ok "vsftpd restarted"
else
  log "no configuration change — service left running"
fi

sleep 1
systemctl is-active --quiet vsftpd || {
  journalctl -u vsftpd -n 20 --no-pager || true
  die "vsftpd is not running"
}

# ---------------------------------------------------------------------------
step "Verification"
# ---------------------------------------------------------------------------
# A real login, not just "the port is open". Active mode (-P -) is used so the
# test does not bounce off pasv_address, which points at the public IP.
verify_login() {
  command -v curl >/dev/null 2>&1 || return 2
  printf 'user "%s:%s"\n' "$FTP_USER" "$FTP_PASSWORD" |
    curl -sS --max-time 20 -P - -K - "ftp://127.0.0.1/" -o /dev/null 2>/tmp/ftp-verify.err
}

if verify_login; then
  ok "logged in as ${FTP_USER} and listed the chroot"
elif [[ $? == 2 ]]; then
  warn "curl not installed — skipped the login test"
else
  # vsftpd's seccomp sandbox breaks on some kernels, always with this
  # signature. It is a known incompatibility rather than a misconfiguration,
  # so it is repaired here instead of leaving you at a console to diagnose it.
  if journalctl -u vsftpd -n 50 --no-pager 2>/dev/null | grep -qi 'seccomp\|priv_sock_get_cmd' ||
     grep -qi 'priv_sock\|refus' /tmp/ftp-verify.err 2>/dev/null; then
    warn "login failed in a way consistent with the seccomp sandbox — disabling it and retrying"
    if ! grep -q '^seccomp_sandbox=' /etc/vsftpd.conf; then
      printf '\n# Added automatically: the seccomp sandbox is incompatible with this kernel.\nseccomp_sandbox=NO\n' >> /etc/vsftpd.conf
    fi
    systemctl restart vsftpd
    sleep 1
    verify_login && ok "login succeeded after disabling seccomp_sandbox" \
                 || warn "login still failing — see: journalctl -u vsftpd -n 50"
  else
    warn "login test failed: $(head -2 /tmp/ftp-verify.err 2>/dev/null | tr '\n' ' ')"
    warn "check: journalctl -u vsftpd -n 50"
  fi
fi
rm -f /tmp/ftp-verify.err

printf '\n'
systemctl is-enabled vsftpd >/dev/null 2>&1 && ok "vsftpd enabled at boot" || warn "vsftpd NOT enabled at boot"
ss -lntp 2>/dev/null | grep -q ':21 ' && ok "listening on port 21" || warn "nothing listening on port 21"

# ---------------------------------------------------------------------------
printf '\n\033[1m==> Done\033[0m\n\n'
cat <<SUMMARY
  Host      ${PUBLIC_IP}
  Port      21 (plain FTP, passive ${PASV_MIN_PORT}-${PASV_MAX_PORT})
  User      ${FTP_USER}
  Password  cat ${CREDENTIALS_FILE}
  Upload to /incoming

  Logs      /var/log/vsftpd.log   (sessions and commands)
            /var/log/xferlog      (transfers, wu-ftpd format)
  Firewall  ufw status verbose
  Service   systemctl status vsftpd

SUMMARY

if [[ -z "${ALLOWED_IPS}" ]]; then
  cat <<'OPEN'
  Port 21 is currently open to the whole internet, and FTP sends the
  password in clear text. Once Inter-Sprint gives you their source
  addresses, re-run with:

      INTERSPRINT_ALLOWED_IPS="1.2.3.4 5.6.7.8" bash provision-intersprint-ftp.sh

OPEN
fi
