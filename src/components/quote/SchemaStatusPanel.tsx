import type { QuoteSchemaReport } from "@/lib/server/quote-schema-check";

/**
 * Renders the installation health check.
 *
 * Shown only when something is actually wrong: a green "all fine" panel on
 * every page load is noise that trains people to stop reading it.
 */
export function SchemaStatusPanel({ report }: { report: QuoteSchemaReport }) {
  if (report.ready) return null;

  return (
    <div className="mb-5 rounded-xl border border-state-danger/40 bg-state-danger-soft p-4">
      <p className="text-sm font-bold text-state-danger">
        Il modulo richieste non è ancora operativo.
      </p>
      <p className="mt-1 text-sm text-ink">
        I clienti che inviano una richiesta vedono un errore e la richiesta non viene salvata.
        Ecco che cosa manca:
      </p>

      <ul className="mt-3 space-y-1.5 text-sm">
        {report.checks.map((check) => (
          <li key={check.key} className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className={`mt-1.5 h-2 w-2 flex-none rounded-full ${
                check.state === "ok" ? "bg-state-success" : "bg-state-danger"
              }`}
            />
            <span className="min-w-0">
              <span className={check.state === "ok" ? "text-ink-soft" : "font-semibold text-ink"}>
                {check.label}
              </span>
              <span className="text-ink-soft">
                {check.state === "ok" ? " — presente" : check.state === "missing" ? " — mancante" : " — errore"}
              </span>
              {check.detail && (
                <span className="mt-0.5 block break-words font-mono text-xs text-ink-soft">
                  {check.detail}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {report.nextAction && (
        <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-sm font-semibold text-ink">
          {report.nextAction}
        </p>
      )}
    </div>
  );
}
