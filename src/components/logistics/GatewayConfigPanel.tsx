import type { GatewayConfigReport } from "@/lib/suppliers/gateway/config";

/**
 * Whether this deployment can perform the live availability check.
 *
 * WHY THIS SCREEN EXISTS. The customer order gate now fails closed on live
 * verification: if the gateway cannot be reached, no order is created. Whether
 * the credentials are present is therefore the difference between a portal
 * that takes orders and one that refuses every one of them — and until now the
 * only way to find out was to try to place an order.
 *
 * IT REPORTS PRESENCE, NEVER VALUES. `describeGatewayConfig` is built for
 * exactly this: it returns which variables are missing and the shape of the
 * rest, and no code path here can reach a customer number, a username or a
 * password. Rendering it is safe on an operator screen in a way that echoing
 * the environment would never be.
 *
 * `insecureTransport` is surfaced rather than buried. The manual documents
 * http:// only (security finding 1), so an operator looking at this screen
 * should see the condition stated, not have to know to ask.
 */
export function GatewayConfigPanel({
  report,
  tr,
}: {
  report: GatewayConfigReport;
  tr: (text: string) => string;
}) {
  const rows: Array<[string, boolean]> = [
    ["INTERSPRINT_GATEWAY_CUSTOMER_NUMBER", report.customerNumberPresent],
    ["INTERSPRINT_GATEWAY_USERNAME", report.usernamePresent],
    ["INTERSPRINT_GATEWAY_PASSWORD", report.passwordPresent],
  ];

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-bold text-ink">{tr("Verifica disponibilità in tempo reale")}</h2>
      <div
        className={`rounded-xl border p-4 text-sm ${
          report.configured ? "border-ink/10 bg-white" : "border-state-danger/40 bg-state-danger-soft"
        }`}
      >
        <p className="font-semibold text-ink">
          {report.configured
            ? tr("Configurata — gli ordini possono essere verificati.")
            : tr("NON configurata — nessun ordine cliente può essere completato.")}
        </p>

        <dl className="mt-3 grid gap-x-8 gap-y-1 font-mono text-xs sm:grid-cols-2">
          {rows.map(([name, present]) => (
            <div key={name} className="flex items-center justify-between gap-3">
              <dt className="truncate text-ink-soft">{name}</dt>
              <dd className={present ? "font-bold text-state-success" : "font-bold text-state-danger"}>
                {present ? "PRESENT" : "MISSING"}
              </dd>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3">
            <dt className="truncate text-ink-soft">INTERSPRINT_GATEWAY_ENV</dt>
            <dd className="font-bold text-ink">{report.environment.toUpperCase()}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="truncate text-ink-soft">INTERSPRINT_GATEWAY_TIMEOUT_MS</dt>
            <dd className="font-bold text-ink">{report.timeoutMs}</dd>
          </div>
        </dl>

        {/* Never the credentials, only the origin they would be sent to. */}
        <p className="mt-3 text-xs text-ink-soft">
          {tr("Endpoint")}: <span className="font-mono">{report.baseUrl}</span>
        </p>

        {report.insecureTransport && (
          <p className="mt-2 rounded-lg border border-state-warning/40 bg-state-warning-soft p-2 text-xs text-ink">
            {tr(
              "Trasporto in chiaro (http). Le credenziali viaggiano non cifrate: vedi docs/SECURITY_FINDINGS.md n. 1."
            )}
          </p>
        )}

        {report.environment !== "production" && report.configured && (
          <p className="mt-2 rounded-lg border border-state-warning/40 bg-state-warning-soft p-2 text-xs text-ink">
            {tr("Ambiente di test: le risposte non sono dati commerciali reali.")}
          </p>
        )}
      </div>
    </section>
  );
}
