#!/usr/bin/env bash
#
# Inter-Sprint feed ingestion worker.
#
# Runs ON the FTP VM, from cron. Reads /srv/ftp/intersprint/incoming directly
# from the local filesystem — no FTP client, no credentials, no network hop to
# fetch a file that is already on this disk.
#
# It deliberately knows NOTHING about tyres. It moves bytes and files; every
# decision about what those bytes mean happens on the application server, in
# code that is tested. The only judgements made here are the two that can only
# be made locally: is this file finished being written, and has this exact
# content already been accepted.
#
# Dependency-free on purpose: bash, curl, sha256sum, gzip, stat, flock. All
# present on a stock Ubuntu. Installing Node and an npm tree on a box that is
# exposed to the internet on port 21 would add a large supply chain for no gain.
#
#   Secrets: read from a root/worker-only env file. NEVER in this script.
#   Exit codes: 0 nothing to do or all handled; 1 configuration error;
#               2 one or more files failed (details in the log).

set -Eeuo pipefail

CONFIG_FILE="${INTERSPRINT_WORKER_CONFIG:-/etc/gommarush/intersprint-worker.env}"

if [[ -r "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$CONFIG_FILE"; set +a
fi

FEED_ROOT="${FEED_ROOT:-/srv/ftp/intersprint}"
INCOMING="$FEED_ROOT/incoming"
PROCESSING="$FEED_ROOT/processing"
PROCESSED="$FEED_ROOT/processed"
FAILED="$FEED_ROOT/failed"

INGEST_URL="${INGEST_URL:-}"
COMMIT_URL="${COMMIT_URL:-}"
FEED_WORKER_TOKEN="${FEED_WORKER_TOKEN:-}"

# How long a file must stop changing before we believe the upload finished.
# vsftpd's STOR is NOT atomic: the supplier's file appears at its final name
# immediately and grows. Parsing mid-upload would hand the server a truncated
# price list that hashes fine and looks complete.
STABLE_SECONDS="${STABLE_SECONDS:-90}"

# Bound on the commit loop, so a stuck run cannot spin for ever.
MAX_COMMIT_CALLS="${MAX_COMMIT_CALLS:-60}"

CURL_TIMEOUT="${CURL_TIMEOUT:-180}"

log() { printf '%s intersprint-worker: %s\n' "$(date --iso-8601=seconds)" "$*" >&2; }
die() { log "FATAL: $*"; exit 1; }

[[ -n "$INGEST_URL" ]] || die "INGEST_URL is not set (see $CONFIG_FILE)"
[[ -n "$COMMIT_URL" ]] || die "COMMIT_URL is not set (see $CONFIG_FILE)"
[[ -n "$FEED_WORKER_TOKEN" ]] || die "FEED_WORKER_TOKEN is not set (see $CONFIG_FILE)"
[[ -d "$INCOMING" ]] || die "$INCOMING does not exist"

for dir in "$PROCESSING" "$PROCESSED" "$FAILED"; do
  [[ -d "$dir" ]] || die "$dir does not exist; run install.sh"
done

# The token is passed to curl through a file descriptor rather than the
# command line: anything in argv is visible to every user via /proc.
auth_header_file="$(mktemp)"
chmod 600 "$auth_header_file"
printf 'Authorization: Bearer %s\n' "$FEED_WORKER_TOKEN" > "$auth_header_file"
trap 'rm -f "$auth_header_file"' EXIT

exit_code=0

# Seconds since a file was last modified.
age_of() {
  local file="$1" mtime now
  mtime="$(stat -c %Y "$file")"
  now="$(date +%s)"
  echo $(( now - mtime ))
}

process_one() {
  local source="$1"
  local name; name="$(basename "$source")"

  # --- 1. stability --------------------------------------------------------
  local age; age="$(age_of "$source")"
  if (( age < STABLE_SECONDS )); then
    log "skip $name: only ${age}s old, waiting for ${STABLE_SECONDS}s of quiet"
    return 0
  fi

  local size_before; size_before="$(stat -c %s "$source")"
  if (( size_before == 0 )); then
    log "skip $name: zero bytes"
    return 0
  fi

  # --- 2. claim ------------------------------------------------------------
  # A rename within the same filesystem is atomic, so two runners cannot both
  # claim one file: exactly one mv succeeds. This also takes the file out of
  # the supplier's writable directory before we read it.
  local claimed="$PROCESSING/$name"
  if ! mv -n "$source" "$claimed" 2>/dev/null || [[ ! -f "$claimed" ]]; then
    log "skip $name: could not claim it (another run, or it vanished)"
    return 0
  fi

  # Re-check after the claim. If the size moved between the two stats the
  # supplier was still writing, so put it back and try again next tick.
  local size_after; size_after="$(stat -c %s "$claimed")"
  if (( size_after != size_before )); then
    log "skip $name: size changed during claim ($size_before -> $size_after), returning it"
    mv -n "$claimed" "$source" || log "WARNING: could not return $name to incoming"
    return 0
  fi

  local checksum; checksum="$(sha256sum "$claimed" | cut -d' ' -f1)"
  log "processing $name ($size_after bytes, sha256 ${checksum:0:12})"

  # --- 3. submit -----------------------------------------------------------
  local body response http_code
  body="$(mktemp)"; response="$(mktemp)"
  # shellcheck disable=SC2064
  trap "rm -f '$body' '$response'" RETURN

  gzip -c "$claimed" > "$body"

  http_code="$(curl -sS --max-time "$CURL_TIMEOUT" -o "$response" -w '%{http_code}' \
    -X POST "$INGEST_URL" \
    -H @"$auth_header_file" \
    -H 'Content-Type: text/csv' \
    -H 'Content-Encoding: gzip' \
    -H "x-feed-filename: $name" \
    -H "x-feed-checksum: $checksum" \
    --data-binary "@$body" || echo "000")"

  if [[ "$http_code" != "200" ]]; then
    log "FAILED $name: ingest returned HTTP $http_code: $(head -c 400 "$response")"
    mv -n "$claimed" "$FAILED/$(archive_name "$name" "$checksum")" || true
    return 1
  fi

  # --- 4. drive the commit to completion -----------------------------------
  # The server applies in bounded batches so each request fits the serverless
  # limit. The file stays in processing/ until the run is genuinely finished:
  # archiving a half-applied feed is the one outcome that must not happen.
  local run_id finished calls=0
  run_id="$(json_field "$response" runId)"
  finished="$(json_field "$response" finished)"

  if [[ "$(json_field "$response" duplicateOfRunId)" != "null" && -n "$(json_field "$response" duplicateOfRunId)" ]]; then
    log "$name: identical content already committed (run $(json_field "$response" duplicateOfRunId)); archiving"
    mv -n "$claimed" "$PROCESSED/$(archive_name "$name" "$checksum")" || true
    return 0
  fi

  while [[ "$finished" != "true" ]]; do
    if (( ++calls > MAX_COMMIT_CALLS )); then
      log "FAILED $name: commit did not finish after $MAX_COMMIT_CALLS calls (run $run_id)"
      mv -n "$claimed" "$FAILED/$(archive_name "$name" "$checksum")" || true
      return 1
    fi

    http_code="$(curl -sS --max-time "$CURL_TIMEOUT" -o "$response" -w '%{http_code}' \
      -X POST "$COMMIT_URL" \
      -H @"$auth_header_file" \
      -H 'Content-Type: application/json' \
      --data "{\"runId\":\"$run_id\"}" || echo "000")"

    if [[ "$http_code" != "200" ]]; then
      log "FAILED $name: commit returned HTTP $http_code: $(head -c 400 "$response")"
      mv -n "$claimed" "$FAILED/$(archive_name "$name" "$checksum")" || true
      return 1
    fi
    finished="$(json_field "$response" finished)"
  done

  # --- 5. archive, only now ------------------------------------------------
  mv -n "$claimed" "$PROCESSED/$(archive_name "$name" "$checksum")" || \
    log "WARNING: $name imported but could not be archived"
  log "OK $name: run $run_id committed"
  return 0
}

# A unique archive name. The supplier reuses two filenames several times a day,
# so a plain mv into processed/ would overwrite the record of earlier feeds.
archive_name() {
  local name="$1" checksum="$2"
  printf '%s.%s.%s' "${name%.*}" "$(date -u +%Y%m%dT%H%M%SZ)" "${checksum:0:12}.${name##*.}"
}

# Minimal JSON scalar reader. The responses are small and generated by our own
# endpoint, so this avoids putting jq (or Node) on the box for four fields.
json_field() {
  sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^,\"}]*\)\"\{0,1\}.*/\1/p" "$1" | head -1
}

main() {
  shopt -s nullglob
  local found=0
  for file in "$INCOMING"/*; do
    [[ -f "$file" ]] || continue
    found=1
    process_one "$file" || exit_code=2
  done
  (( found )) || log "nothing in $INCOMING"
  exit "$exit_code"
}

main "$@"
