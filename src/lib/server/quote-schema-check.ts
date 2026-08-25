import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";

/**
 * Installation health check for the quote-request pipeline.
 *
 * This exists because the two ways submission can fail — the server has no
 * Supabase credentials, or the schema was never migrated — produce the
 * SAME thing for the customer ("Non siamo riusciti a inviare la
 * richiesta") and, until now, produced nothing at all for the operator.
 * Worse, the admin list itself queries the missing tables, so the one
 * screen that could have explained the problem was the screen that broke.
 *
 * Every probe here is read-only and NEVER THROWS. It has to keep working
 * precisely when everything else does not.
 */

export type CheckState = "ok" | "missing" | "error";

export interface SchemaCheck {
  key: string;
  label: string;
  state: CheckState;
  /** Operator-facing detail. Never rendered to a customer. */
  detail?: string;
}

export interface QuoteSchemaReport {
  /** True only when submission can actually succeed. */
  ready: boolean;
  credentialsConfigured: boolean;
  /** Which migration file to run, when one is needed. */
  nextAction: string | null;
  checks: SchemaCheck[];
}

/** PostgREST/Postgres codes that mean "this object does not exist". */
const MISSING_CODES = new Set([
  "42P01", // undefined_table
  "42703", // undefined_column
  "42883", // undefined_function
  "PGRST202", // PostgREST: function not found in schema cache
  "PGRST205", // PostgREST: table not found in schema cache
]);

export function classifyProbeError(
  error: { code?: string; message?: string } | null
): SchemaCheck["state"] {
  if (!error) return "ok";
  if (error.code && MISSING_CODES.has(error.code)) return "missing";
  // A message-level fallback: PostgREST does not always populate `code`.
  const message = (error.message ?? "").toLowerCase();
  if (
    message.includes("does not exist") ||
    message.includes("could not find the table") ||
    message.includes("could not find the function") ||
    message.includes("schema cache")
  ) {
    return "missing";
  }
  return "error";
}

export async function checkQuoteSchema(): Promise<QuoteSchemaReport> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const credentialsConfigured = Boolean(url && key);

  const checks: SchemaCheck[] = [
    {
      key: "credentials",
      label: "Credenziali Supabase sul server",
      state: credentialsConfigured ? "ok" : "missing",
      detail: credentialsConfigured
        ? undefined
        : [
            !url ? "NEXT_PUBLIC_SUPABASE_URL" : null,
            !key ? "SUPABASE_SERVICE_ROLE_KEY" : null,
          ]
            .filter(Boolean)
            .join(", "),
    },
  ];

  // Without credentials no probe can say anything, and reporting nine
  // "missing" objects would send the operator to the SQL editor for a
  // problem that lives in Vercel.
  if (!credentialsConfigured) {
    return {
      ready: false,
      credentialsConfigured: false,
      nextAction:
        "Aggiungi le variabili mancanti su Vercel (Settings → Environment Variables) e rideploya.",
      checks,
    };
  }

  const supabase = createSupabaseAdminClient();

  async function probeColumn(key: string, label: string, table: string, column: string) {
    try {
      const { error } = await supabase.from(table).select(column).limit(1);
      checks.push({ key, label, state: classifyProbeError(error), detail: error?.message });
    } catch (error) {
      checks.push({
        key,
        label,
        state: "error",
        detail: error instanceof Error ? error.message : "errore sconosciuto",
      });
    }
  }

  await probeColumn("table_requests", "Tabella quote_requests", "quote_requests", "id");
  await probeColumn("table_items", "Tabella quote_request_items", "quote_request_items", "id");
  // Distinguishes "migration 1 only" from "both migrations": this column
  // arrives with the second file.
  await probeColumn(
    "column_reference",
    "Colonna public_reference (2ª migrazione)",
    "quote_requests",
    "public_reference"
  );
  await probeColumn(
    "table_events",
    "Tabella quote_request_events (2ª migrazione)",
    "quote_request_events",
    "id"
  );

  // Probing the create function without creating anything: a null payload
  // makes it raise MISSING_PAYLOAD, which only a function that EXISTS can
  // do. Nothing is written either way.
  try {
    const { error } = await supabase.rpc("gorush_create_quote_request", { payload: null });
    const raisedByOurFunction = (error?.message ?? "").includes("MISSING_PAYLOAD");
    checks.push({
      key: "rpc_create",
      label: "Funzione gorush_create_quote_request",
      state: raisedByOurFunction ? "ok" : classifyProbeError(error ?? null),
      detail: raisedByOurFunction ? undefined : error?.message,
    });
  } catch (error) {
    checks.push({
      key: "rpc_create",
      label: "Funzione gorush_create_quote_request",
      state: "error",
      detail: error instanceof Error ? error.message : "errore sconosciuto",
    });
  }

  const missing = new Set(checks.filter((c) => c.state !== "ok").map((c) => c.key));

  return {
    ready: missing.size === 0,
    credentialsConfigured,
    nextAction: decideNextAction(missing),
    checks,
  };
}

/**
 * Which migration to run, given what is missing. Split out because getting
 * this wrong sends someone to re-run a file they have already applied.
 */
export function decideNextAction(missing: Set<string>): string | null {
  if (missing.has("table_requests") || missing.has("table_items") || missing.has("rpc_create")) {
    return "Esegui supabase/migrations/20260826000000_quote_requests.sql, poi 20260827000000_quote_requests_production.sql, nell'editor SQL di Supabase.";
  }
  if (missing.has("column_reference") || missing.has("table_events")) {
    return "La prima migrazione è applicata, la seconda no. Esegui supabase/migrations/20260827000000_quote_requests_production.sql nell'editor SQL di Supabase.";
  }
  return null;
}
