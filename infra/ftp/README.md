# Inter-Sprint FTP endpoint

Provisioning for the Hetzner Ubuntu server that receives Inter-Sprint's
files. One script, `provision-intersprint-ftp.sh`, configures the whole
thing and is safe to run repeatedly.

    Host   62.238.60.247
    Port   21 (plain FTP), passive data ports 40000–40020
    User   intersprint   (FTP only — no shell, no SSH)
    Drop   /incoming

---

## Read this first: what plain FTP means

This is a **plain FTP** endpoint, as specified. FTP has no transport
security. The username, the password and every byte of every file cross the
internet in clear text, readable and modifiable by anyone on the path.
Nothing in this configuration changes that — it is a property of the
protocol, not of the setup.

Everything the script does (no anonymous access, no shell, chroot, a single
permitted user, a narrow passive range, a restrictive firewall) limits what
someone can do **after** they hold the credentials. None of it stops the
credentials being captured in transit.

**The one mitigation that matters is not accepting FTP from the whole
internet.** Ask Inter-Sprint for their egress addresses and re-run:

    INTERSPRINT_ALLOWED_IPS="203.0.113.10 198.51.100.7" \
      bash provision-intersprint-ftp.sh

Port 21 and the passive range are then open only to them. Until that is
done, the endpoint is exposed to the entire internet with a cleartext
password.

If Inter-Sprint can speak **FTPS** (FTP over TLS) or **SFTP**, either removes
this problem outright and is worth one email to find out.

---

## Running it

As root on the server:

    curl -fsSL -o provision-intersprint-ftp.sh \
      https://raw.githubusercontent.com/florinurdea-rgb/gommarush/main/infra/ftp/provision-intersprint-ftp.sh
    bash provision-intersprint-ftp.sh
    cat /root/intersprint-ftp-credentials.txt

The password is generated on the server, written to a root-only file
(mode 600) and **never stored in this repository**.

### Options

| Variable | Effect |
|---|---|
| `INTERSPRINT_ALLOWED_IPS` | Space/comma-separated source addresses. Restricts port 21 and the passive range to them. |
| `INTERSPRINT_PASSWORD` | Sets/rotates the password explicitly. Without it, a password is generated once and then left alone. |
| `SSH_PORT` | If sshd does not listen on 22. Opened in the firewall before ufw is enabled. |
| `PUBLIC_IP` | Advertised in PASV replies. Defaults to `62.238.60.247`. |

### Idempotency

Re-running is a no-op when nothing has changed:

- config files are written only when their content differs
- vsftpd is restarted only when something changed
- packages are installed only when missing
- **the password is not rotated** — a re-run will not break a credential
  Inter-Sprint is already using

To rotate deliberately, pass `INTERSPRINT_PASSWORD=...`, or delete
`/root/intersprint-ftp-credentials.txt` and re-run to get a fresh one.

---

## Layout

    /srv/ftp/intersprint          root:root        0755   ← chroot root
      ├── incoming/               intersprint      0750   ← writable
      ├── processing/             root:intersprint 0750   ← read-only to FTP user
      ├── processed/              root:intersprint 0750   ← read-only to FTP user
      └── failed/                 root:intersprint 0750   ← read-only to FTP user

Inside the chroot Inter-Sprint sees these as `/incoming`, `/processing`,
`/processed` and `/failed`.

Two deliberate choices:

**The chroot root is owned by root and is not writable.** vsftpd refuses to
chroot into a writable directory. The common workaround,
`allow_writeable_chroot=YES`, discards the protection rather than satisfying
it; owning the root and writing only inside it is the correct shape, so that
setting stays off.

**Only `incoming` is writable by Inter-Sprint.** The other three belong to
our pipeline. Once a file has been collected, the partner should not be able
to alter or delete the record of what we processed.

---

## Account

- shell `/usr/sbin/nologin` — no interactive session
- `DenyUsers intersprint` in sshd — cannot authenticate over SSH at all
- listed in `/etc/vsftpd.userlist` with `userlist_deny=NO`, so it is the
  **only** account that may log in over FTP, even if another system account
  grows a password

`/usr/sbin/nologin` is added to `/etc/shells`. This is required, not
cosmetic: Ubuntu's PAM stack for vsftpd runs `pam_shells`, which refuses to
authenticate any user whose shell is not listed there. Omitting it is the
usual cause of `530 Login incorrect` on an account whose password is
perfectly correct.

---

## Firewall

`ufw`, default deny inbound, allow outbound:

| Port | Purpose |
|---|---|
| 22/tcp | SSH — opened **first**, before ufw is enabled |
| 21/tcp | FTP control |
| 40000–40020/tcp | FTP passive data |

Check with `ufw status verbose`.

Switching from open to allowlisted removes the blanket rules first —
otherwise they would keep the port open to everyone and make the allowlist
decorative.

---

## Logging

| File | Contents |
|---|---|
| `/var/log/vsftpd.log` | Sessions, logins, commands (`log_ftp_protocol=YES`) |
| `/var/log/xferlog` | Transfers, wu-ftpd format for log analysers |

Rotated weekly, 26 kept, compressed
(`/etc/logrotate.d/vsftpd-gommarush`).

    tail -f /var/log/vsftpd.log
    journalctl -u vsftpd -f

---

## Service

`systemctl enable vsftpd` — starts automatically after reboot. Verify with
`systemctl is-enabled vsftpd`.

---

## Troubleshooting

**`530 Login incorrect` with the right password**
`/usr/sbin/nologin` missing from `/etc/shells`, or the user missing from
`/etc/vsftpd.userlist`. The script fixes both; re-run it.

**`500 OOPS: vsftpd: refusing to run with writable root inside chroot()`**
Something made `/srv/ftp/intersprint` writable by its owner. Re-run the
script — it resets the ownership. Do not "fix" this with
`allow_writeable_chroot=YES`.

**Connects, then hangs on `LIST` or a transfer**
Passive data connection blocked. Check that 40000–40020 are open
(`ufw status`) and, if an allowlist is set, that the client is coming from
an address on it. Confirm the client is using passive mode.

**`500 OOPS: priv_sock_get_cmd` / immediate disconnect after login**
vsftpd's seccomp sandbox is incompatible with some kernels. The script
detects this signature during its own login test and applies
`seccomp_sandbox=NO` automatically.

**Verifying by hand from another machine**

    curl -v --user intersprint:PASSWORD ftp://62.238.60.247/
    curl -T test.txt --user intersprint:PASSWORD ftp://62.238.60.247/incoming/

---

## What is deliberately not here

The catalogue importer that consumes these files. The supplier adapter seam
lives in `src/lib/catalogue/` (see `isb-adapter.ts`); an Inter-Sprint adapter
plugs in beside it when the file format is known.
