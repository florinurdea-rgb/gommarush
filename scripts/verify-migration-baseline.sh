#!/usr/bin/env bash
#
# Verifies the invariant that makes a schema history trustworthy:
#
#     fresh empty database + supabase/baseline/*.sql = the intended schema
#
# Applies the canonical baseline, in filename order, to a THROWAWAY PostgreSQL
# database and checks the resulting object counts against the expected
# fingerprint. Nothing here touches production or staging, and the script
# refuses to run against a remote host.
#
# WHY THIS EXISTS
#
# On 2026-09-21 the previous invariant — that supabase/migrations/*.sql could
# build the schema — was found to be false, and the only way anyone could tell
# was by trying it. Eleven of twenty migrations failed from empty and 14 of 32
# tables had no DDL in version control at all, because they had been created
# directly against the database. See docs/SCHEMA_RECONCILIATION_REPORT.md.
#
# Run this in CI. A schema change that is not represented in the baseline (or
# in a migration on top of it) will fail here rather than silently recreating
# that situation.
#
#   Usage:  bash scripts/verify-migration-baseline.sh [--keep] [--legacy]
#
#     --keep    leave the database behind for inspection
#     --legacy  ALSO replay supabase/migrations/*.sql on top, to confirm the
#               historical migrations still apply against the baseline
#
# Requires a local PostgreSQL 17.x. Production runs 17.6; a different major
# version may deparse expressions differently and produce false differences.
#
#   Disposable instance without root or Docker:
#     npm install @embedded-postgres/linux-x64@17.6.0-beta.15
#     .../native/bin/initdb -D /var/tmp/pg17data -U postgres --auth=trust
#     .../native/bin/pg_ctl -D /var/tmp/pg17data -o '-p 5434 -k /var/tmp' start
#
#   Environment (all optional):
#     PGHOST  default /var/tmp     PGPORT default 5434
#     PGUSER  default postgres     TARGET_DB default gr_baseline_check

set -uo pipefail

PGHOST="${PGHOST:-/var/tmp}"
PGPORT="${PGPORT:-5434}"
PGUSER="${PGUSER:-postgres}"
TARGET_DB="${TARGET_DB:-gr_baseline_check}"
KEEP=0
LEGACY=0
for arg in "$@"; do
  [ "$arg" = "--keep" ] && KEEP=1
  [ "$arg" = "--legacy" ] && LEGACY=1
done

# Expected object counts, captured from production (sfvaqextratpnprcamwd,
# PostgreSQL 17.6) on 2026-09-21. Update these ONLY together with a migration
# that actually changes the schema.
EXPECT_TABLES=32
EXPECT_COLUMNS=541
EXPECT_PK=32
EXPECT_FK=51
EXPECT_CHECK=56
EXPECT_UNIQUE=12
EXPECT_INDEXES=141
EXPECT_FUNCTIONS=28
EXPECT_TRIGGERS=23
EXPECT_RLS=32

# A local socket directory or localhost only. This script drops and recreates a
# database, which must never be aimed at a shared environment by accident.
case "$PGHOST" in
  /*|localhost|127.0.0.1) ;;
  *)
    echo "REFUSING: PGHOST='$PGHOST' is not a local socket or localhost." >&2
    echo "This script drops databases. It is for disposable instances only." >&2
    exit 2
    ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE="$ROOT/supabase/baseline"
POST="$ROOT/supabase/post-baseline"
psql_run() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$@"; }

server_version="$(psql_run -d postgres -tAc "show server_version;" 2>/dev/null)"
if [ -z "$server_version" ]; then
  echo "Could not reach PostgreSQL at $PGUSER@$PGHOST:$PGPORT" >&2
  exit 2
fi
case "$server_version" in
  17.*) ;;
  *) echo "WARNING: server is $server_version, production is 17.6." >&2
     echo "         Object counts still apply; expression rendering may differ." >&2 ;;
esac

echo "== target: $PGUSER@$PGHOST:$PGPORT/$TARGET_DB (PostgreSQL $server_version)"
psql_run -d postgres -tAc "drop database if exists $TARGET_DB;" >/dev/null 2>&1
psql_run -d postgres -tAc "create database $TARGET_DB;" >/dev/null || exit 2

# Supabase puts `extensions` on the database search_path and installs pgcrypto
# there. Reproducing that locally isolates genuine defects from "this is not
# Supabase" noise — several functions call gen_random_bytes unqualified.
psql_run -d postgres -tAc "alter database $TARGET_DB set search_path = public, extensions;" >/dev/null
psql_run -d "$TARGET_DB" -q >/dev/null 2>&1 <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
-- Supabase Storage is platform-provided and outside the public-schema
-- baseline. Stubbed only so a legacy migration that references a bucket runs.
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean default false);
SQL

echo "== applying canonical baseline"
failed=0
for file in "$BASELINE"/*.sql; do
  name="$(basename "$file")"
  if output=$(psql_run -d "$TARGET_DB" -v ON_ERROR_STOP=1 -q -f "$file" 2>&1); then
    printf '  ok    %s\n' "$name"
  else
    printf '  FAIL  %s\n' "$name"
    printf '        %s\n' "$(printf '%s\n' "$output" | grep -m1 'ERROR:' || echo 'unknown error')"
    failed=$((failed + 1))
  fi
done

# Post-baseline migrations are NOT part of the production fingerprint — they
# are what comes next. They are applied after the counts are checked, so the
# baseline is verified against production as it actually is.
POST_FILES=$(ls "$POST"/*.sql 2>/dev/null || true)

if [ "$LEGACY" -eq 1 ]; then
  echo "== replaying historical migrations on top of the baseline"
  for file in "$ROOT"/supabase/migrations/*.sql; do
    name="$(basename "$file")"
    if output=$(psql_run -d "$TARGET_DB" -v ON_ERROR_STOP=1 -q -f "$file" 2>&1); then
      printf '  ok    %s\n' "$name"
    else
      printf '  FAIL  %s\n' "$name"
      printf '        %s\n' "$(printf '%s\n' "$output" | grep -m1 'ERROR:' || echo '?')"
      failed=$((failed + 1))
    fi
  done
fi

echo
echo "== object counts"
check_count() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    printf '  ok    %-12s %s\n' "$label" "$actual"
  else
    printf '  FAIL  %-12s %s (expected %s)\n' "$label" "$actual" "$expected"
    failed=$((failed + 1))
  fi
}

q() { psql_run -d "$TARGET_DB" -tAc "$1"; }

check_count tables    "$EXPECT_TABLES"    "$(q "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';")"
check_count columns   "$EXPECT_COLUMNS"   "$(q "select count(*) from information_schema.columns c join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE' where c.table_schema='public';")"
check_count pkeys     "$EXPECT_PK"        "$(q "select count(*) from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and c.contype='p';")"
check_count fkeys     "$EXPECT_FK"        "$(q "select count(*) from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and c.contype='f';")"
check_count checks    "$EXPECT_CHECK"     "$(q "select count(*) from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and c.contype='c';")"
check_count uniques   "$EXPECT_UNIQUE"    "$(q "select count(*) from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and c.contype='u';")"
check_count indexes   "$EXPECT_INDEXES"   "$(q "select count(*) from pg_indexes where schemaname='public';")"
check_count functions "$EXPECT_FUNCTIONS" "$(q "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';")"
check_count triggers  "$EXPECT_TRIGGERS"  "$(q "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal;")"
check_count rls       "$EXPECT_RLS"       "$(q "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity;")"

# RLS with zero policies is deliberate: the anon key can reach nothing and all
# access goes through server-side code. A policy appearing here would silently
# open a table that is currently closed, so it is failed rather than reported.
policies="$(q "select count(*) from pg_policies where schemaname='public';")"
check_count policies 0 "$policies"

# The fail-closed guarantee, asserted rather than assumed: an observation that
# does not say whether it is real or test data must be rejected by the database.
if [ -n "$POST_FILES" ]; then
  echo
  echo "== applying post-baseline migrations (not yet in production)"
  for file in $POST_FILES; do
    name="$(basename "$file")"
    if output=$(psql_run -d "$TARGET_DB" -v ON_ERROR_STOP=1 -q -f "$file" 2>&1); then
      printf '  ok    %s\n' "$name"
    else
      printf '  FAIL  %s\n' "$name"
      printf '        %s\n' "$(printf '%s\n' "$output" | grep -m1 'ERROR:' || echo '?')"
      failed=$((failed + 1))
    fi
  done
fi

echo
echo "== fail-closed classification (from the post-baseline migration)"
if q "select 1 from information_schema.columns where table_name='supplier_listing_prices' and column_name='data_classification';" | grep -q 1; then
  nullable="$(q "select is_nullable from information_schema.columns where table_name='supplier_listing_prices' and column_name='data_classification';")"
  hasdefault="$(q "select coalesce(column_default,'NONE') from information_schema.columns where table_name='supplier_listing_prices' and column_name='data_classification';")"
  if [ "$nullable" = "NO" ] && [ "$hasdefault" = "NONE" ]; then
    printf '  ok    data_classification is NOT NULL with no default\n'
  else
    printf '  FAIL  data_classification nullable=%s default=%s (must be NO/NONE)\n' "$nullable" "$hasdefault"
    failed=$((failed + 1))
  fi
else
  printf '  FAIL  supplier_listing_prices.data_classification is missing\n'
  failed=$((failed + 1))
fi

echo
if [ "$failed" -eq 0 ]; then
  echo "RESULT: the baseline reproduces the intended schema from empty."
else
  echo "RESULT: $failed check(s) failed."
  echo
  echo "If you changed the schema deliberately, add a migration and update the"
  echo "EXPECT_* counts at the top of this script in the same commit."
fi

if [ "$KEEP" -eq 1 ]; then
  echo "(kept database $TARGET_DB)"
else
  psql_run -d postgres -tAc "drop database if exists $TARGET_DB;" >/dev/null 2>&1
fi

[ "$failed" -eq 0 ]
