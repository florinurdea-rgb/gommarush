#!/usr/bin/env bash
#
# Verifies the invariant that makes a migration history trustworthy:
#
#     fresh empty database + supabase/migrations/*.sql = the intended schema
#
# It applies every repository migration, in filename order, to a THROWAWAY
# PostgreSQL database and reports what actually happens. Nothing here touches
# production or staging, and the script refuses to run against a remote host.
#
# Why this exists: on 2026-09-21 the invariant was found to be false, and the
# only way anyone could tell was by trying it. A claim about migrations is
# worth exactly as much as the last time someone ran them from empty, so this
# makes that cheap enough to repeat.
#
#   Usage:  bash scripts/verify-migration-baseline.sh [--keep]
#
#   Requires a local PostgreSQL. Start a disposable one with:
#     initdb -D /var/tmp/gr-pg -U postgres --auth=trust
#     pg_ctl -D /var/tmp/gr-pg -o '-p 5433 -k /var/tmp' -l /var/tmp/gr-pg/log start
#
#   Environment (all optional):
#     PGHOST  default /var/tmp     PGPORT default 5433
#     PGUSER  default postgres     TARGET_DB default gr_baseline_check

set -uo pipefail

PGHOST="${PGHOST:-/var/tmp}"
PGPORT="${PGPORT:-5433}"
PGUSER="${PGUSER:-postgres}"
TARGET_DB="${TARGET_DB:-gr_baseline_check}"
KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

# A local socket directory or localhost only. This script drops and recreates
# a database, which must never be aimed at a shared environment by accident.
case "$PGHOST" in
  /*|localhost|127.0.0.1) ;;
  *)
    echo "REFUSING: PGHOST='$PGHOST' is not a local socket or localhost." >&2
    echo "This script drops databases. It is for disposable instances only." >&2
    exit 2
    ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
psql_run() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$@"; }

echo "== target: $PGUSER@$PGHOST:$PGPORT/$TARGET_DB"
psql_run -d postgres -tAc "drop database if exists $TARGET_DB;" >/dev/null 2>&1
psql_run -d postgres -tAc "create database $TARGET_DB;" >/dev/null || {
  echo "Could not create $TARGET_DB — is a local PostgreSQL running?" >&2
  exit 2
}

# Supabase provides these before any migration runs. Recreating them locally
# isolates genuine migration defects from "this is not Supabase" noise.
psql_run -d "$TARGET_DB" -q >/dev/null 2>&1 <<'SQL'
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
create extension if not exists "uuid-ossp" schema extensions;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
SQL

echo "== applying $(ls "$MIGRATIONS"/*.sql | wc -l) migrations in filename order"
failed=0
declare -a FAILURES=()

for file in "$MIGRATIONS"/*.sql; do
  name="$(basename "$file")"
  # ON_ERROR_STOP so a migration is judged as a whole, the way it would run
  # against a real database, rather than limping past its first broken
  # statement and reporting a schema nobody would ever get.
  if output=$(psql_run -d "$TARGET_DB" -v ON_ERROR_STOP=1 -q -f "$file" 2>&1); then
    printf '  ok    %s\n' "$name"
  else
    printf '  FAIL  %s\n' "$name"
    first_error=$(printf '%s\n' "$output" | grep -m1 'ERROR:' || echo 'unknown error')
    printf '        %s\n' "$first_error"
    FAILURES+=("$name :: $first_error")
    failed=$((failed + 1))
  fi
done

echo
echo "== tables the repository actually created from empty"
psql_run -d "$TARGET_DB" -tAc \
  "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';"

echo "== tables referenced by migrations but never created by them"
# The specific defect found on 2026-09-21: the logistics migrations ALTER and
# reference public.orders, but no migration in the repository creates it.
for table in orders order_items customers suppliers inventory_units warehouse_zones; do
  exists=$(psql_run -d "$TARGET_DB" -tAc "select to_regclass('public.$table') is not null;")
  [ "$exists" = "t" ] || echo "  MISSING  public.$table"
done

echo
if [ "$failed" -eq 0 ]; then
  echo "RESULT: all migrations applied cleanly from empty."
else
  echo "RESULT: $failed migration(s) failed from empty."
  echo
  echo "The repository does NOT contain a complete schema history."
  echo "See docs/DATABASE_BASELINE.md for the reconciliation plan."
fi

if [ "$KEEP" -eq 1 ]; then
  echo "(kept database $TARGET_DB for inspection)"
else
  psql_run -d postgres -tAc "drop database if exists $TARGET_DB;" >/dev/null 2>&1
fi

exit $([ "$failed" -eq 0 ] && echo 0 || echo 1)
