# Inter-Sprint ingestion worker

Runs on the FTP VM (`ubuntu-2gb-hel1-1`). Picks up feeds Inter-Sprint uploads
to `/srv/ftp/intersprint/incoming` and hands them to the GommaRush application
for parsing and persistence.

## Why it is a shell script

The worker needs bash, curl, sha256sum, gzip and flock. All are on a stock
Ubuntu, so **no runtime is installed on this box at all** — no Node, no npm
tree, no supply chain. That is deliberate: this VM is reachable from the
internet on port 21, and it should hold as little as possible.

It also knows nothing about tyres. It moves bytes and files; every decision
about what those bytes mean happens in the application, in tested code.

## Why it does not use the FTP client from M9

The worker runs **on the FTP server**, so it reads the spool directory from the
local filesystem. No FTP credentials, no network hop, no passive-mode
negotiation to fetch a file that is already on this disk. `FtpFeedTransport`
remains in the repository for a pull-based deployment; this deployment does not
need it.

## Architecture, and why

```
Inter-Sprint ──plain FTP──> VM /incoming ──HTTPS──> app /api/feed/intersprint/*
                                                          │
                                                          └──> Supabase
```

Two options were weighed:

**A. Worker writes to Supabase directly.** Rejected. It would put the
service-role key — which bypasses RLS on customers, orders and the whole
logistics system — on the box that is exposed on port 21. The blast radius of
one compromised VM would be the entire database.

**B. Worker calls a protected application endpoint.** Chosen. The VM holds one
single-purpose bearer token that can submit a supplier feed and nothing else.
The service-role key never leaves the application environment, and ingestion
reuses `analyzeCatalogueImport` / `commitCatalogueImport` — the same path the
admin upload screen uses, so there is exactly one catalogue pipeline.

The feed is gzipped before upload (roughly tenfold on this data), which keeps a
3 MB feed well inside the serverless body limit.

## The two local decisions

Everything else is the server's call. These two can only be made here:

**Is the file finished?** `vsftpd`'s `STOR` is not atomic — the supplier's file
appears at its final name and then grows. The worker requires the file to have
been unmodified for `STABLE_SECONDS` (default 90), then re-checks the size
after claiming it and puts it back if it moved. Parsing mid-upload would submit
a truncated price list that hashes perfectly well and looks complete.

**Has this content already been accepted?** The worker checksums the file and
sends the digest; the server re-hashes what it received and refuses a mismatch.
Authoritative de-duplication stays in the database, where a unique index on
`(supplier_id, adapter, file_checksum)` for committed runs makes double
application impossible.

## Lifecycle

```
incoming/ ──claim (atomic mv)──> processing/ ──commit finished──> processed/
                                             ──anything else───> failed/
```

A file is archived **only after the commit reports finished**. While the server
is still applying batches the file stays in `processing/`, so a crash leaves it
recoverable rather than marked done. Failed files are kept for investigation,
never deleted. Archive names carry a timestamp and checksum prefix because the
supplier reuses the same two filenames several times a day.

## Schedule, locking, retries

- **Every 10 minutes**, via `/etc/cron.d/gommarush-intersprint-worker`.
  Deliveries have been observed around 06:27, 10:27, 12:2x and 14:27, but an
  observed pattern is not a promise, so the worker polls rather than matching
  those times.
- **`flock -n`** serialises runs. A second invocation exits immediately instead
  of racing the first. The atomic `mv` into `processing/` is a second,
  independent guard.
- **Retries** are implicit: a file that is not yet stable is simply left for the
  next tick. A file that failed is moved to `failed/` and not retried
  automatically — a repeated failure usually needs a human, and retrying a
  broken feed every ten minutes hides that.
- **Exit codes:** 0 nothing to do or all handled, 1 configuration error, 2 at
  least one file failed.

## Install

```bash
sudo ./install.sh
```

Idempotent. Creates the `gr-ingest` system user (no shell, no home), fixes
directory ownership, installs the worker, the config template, log rotation and
the cron entry.

Then, by hand:

1. Edit `/etc/gommarush/intersprint-worker.env` — `INGEST_URL`, `COMMIT_URL`,
   `FEED_WORKER_TOKEN`. Generate the token with `openssl rand -hex 32`.
2. Set the **same** `FEED_WORKER_TOKEN` in the application environment, plus
   `INTERSPRINT_SUPPLIER_ID`.
3. Dry run: `sudo -u gr-ingest /usr/local/lib/gommarush/intersprint-ingest-feed.sh`
4. Watch: `tail -f /var/log/gommarush/intersprint-worker.log`

**No secret is written by `install.sh` and none belongs in this repository.**

## Permissions

| Path | Owner | Mode | Why |
| --- | --- | --- | --- |
| `incoming/` | `intersprint:gr-ingest` | 0770 | supplier writes; worker must move files out |
| `processing/`, `processed/`, `failed/` | `gr-ingest:gr-ingest` | 0750 | the FTP user cannot read our archive at all |
| `/etc/gommarush/intersprint-worker.env` | `root:gr-ingest` | 0640 | worker reads the token; nobody else can |
| worker script | `root:gr-ingest` | 0750 | worker executes, cannot modify |

The `intersprint` FTP account stays chrooted and gains nothing. The worker runs
as `gr-ingest`, never as root, and has no database credentials — only the feed
token.

The token is passed to `curl` through a header **file**, not the command line:
anything in `argv` is world-readable via `/proc`.
