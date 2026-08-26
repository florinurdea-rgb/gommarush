import "server-only";

/**
 * True when a Supabase/PostgREST error means "this column or table isn't
 * visible to the database layer right now" — either the genuine Postgres
 * undefined_column/undefined_table SQLSTATE (42703/42P01), or PostgREST's
 * own PGRST204/PGRST205 ("Could not find the X column/table ... in the
 * schema cache").
 *
 * The PGRST20x case is the one that bit us in production: it fires even
 * when the column genuinely EXISTS in Postgres but PostgREST's cached
 * schema hasn't picked up the DDL change yet — a well-known Supabase
 * gotcha after running a migration by hand in the SQL editor (fixed by
 * reloading the schema cache, but the app shouldn't hard-fail while that's
 * stale). Checking only the raw Postgres code (42703) misses this entirely,
 * since PostgREST rejects the request before Postgres ever sees it.
 *
 * Both cases get the same treatment here: degrade gracefully (drop the
 * column from the query/update) instead of throwing, because from the
 * caller's perspective the effect — "this column isn't usable right now"
 * — is identical either way.
 */
export function isMissingSchemaError(
  error: { code?: string | null; message?: string | null } | null | undefined
): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "42P01") return true;
  if (error.code === "PGRST204" || error.code === "PGRST205") return true;
  if (error.message?.toLowerCase().includes("schema cache")) return true;
  return false;
}
