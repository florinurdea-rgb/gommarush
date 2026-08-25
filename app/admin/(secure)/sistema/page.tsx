import { PageHeading } from "@/components/logistics/AdminShell";
import { getSystemHealth, PERIOD_LABELS, type MetricPeriod } from "@/lib/server/quote-metrics";
import { describeEmailConfig } from "@/lib/email/send-quote-request";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = { title: "Sistema" };

const PERIODS: MetricPeriod[] = ["today", "7d", "30d"];

function percent(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function ms(value: number | null): string {
  return value === null ? "—" : `${value} ms`;
}

function Stat({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "good" | "bad";
  hint?: string;
}) {
  const toneClass =
    tone === "good" ? "text-state-success" : tone === "bad" ? "text-state-danger" : "text-ink";
  return (
    <div className="rounded-xl border border-ink/10 bg-white px-4 py-3">
      <div className={`text-xl font-black tabular-nums ${toneClass}`}>{value}</div>
      <div className="mt-0.5 text-xs font-medium uppercase tracking-wide text-ink-soft">
        {label}
      </div>
      {hint && <div className="mt-1 text-[11px] text-ink-soft/80">{hint}</div>}
    </div>
  );
}

/**
 * Operational health for the quote pipeline.
 *
 * Deliberately separate from the business dashboard: these numbers answer
 * "is the system working", not "how is sales doing", and mixing the two
 * makes both harder to read.
 *
 * Everything here is derived from quote_request_events and the request rows
 * themselves — there is no separate analytics store to drift out of sync
 * with reality.
 */
export default async function SystemPage({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  const period: MetricPeriod = PERIODS.includes(searchParams.period as MetricPeriod)
    ? (searchParams.period as MetricPeriod)
    : "7d";

  const [health, emailConfig] = await Promise.all([
    getSystemHealth(period),
    Promise.resolve(describeEmailConfig()),
  ]);

  const { submissions, notifications, timings } = health;

  return (
    <>
      <PageHeading
        title="Sistema"
        description="Salute operativa del flusso richieste di offerta."
      />

      <nav className="mb-5 flex flex-wrap gap-2" aria-label="Periodo">
        {PERIODS.map((value) => (
          <Link
            key={value}
            href={`?period=${value}`}
            aria-current={value === period ? "page" : undefined}
            className={`min-h-11 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              value === period
                ? "bg-accent-light text-accent-dark"
                : "border border-ink/15 text-ink-soft hover:border-accent hover:text-accent"
            }`}
          >
            {PERIOD_LABELS[value]}
          </Link>
        ))}
      </nav>

      {/* Configuration first: every other number below is meaningless if the
          deployment cannot send mail at all. */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold text-ink">Configurazione email</h2>
        <div
          className={`rounded-xl border p-4 text-sm ${
            emailConfig.configured
              ? "border-ink/10 bg-white"
              : "border-state-danger/40 bg-state-danger-soft"
          }`}
        >
          <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="w-28 flex-none text-ink-soft">Stato</dt>
              <dd className="font-semibold">
                {emailConfig.configured ? "Configurata" : "Non configurata"}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 flex-none text-ink-soft">Chiave API</dt>
              <dd className="font-semibold">
                {!emailConfig.apiKeyPresent
                  ? "assente"
                  : emailConfig.apiKeyLooksValid
                    ? "presente"
                    : "presente, formato inatteso"}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 flex-none text-ink-soft">Mittente</dt>
              <dd className="min-w-0 break-all font-semibold">{emailConfig.from ?? "—"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 flex-none text-ink-soft">Destinatario</dt>
              <dd className="min-w-0 break-all font-semibold">{emailConfig.to ?? "—"}</dd>
            </div>
          </dl>
          {emailConfig.missing.length > 0 && (
            <p className="mt-3 text-xs">
              Variabili mancanti:{" "}
              <span className="font-mono font-bold">{emailConfig.missing.join(", ")}</span>
            </p>
          )}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold text-ink">Affidabilità invii</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Tentativi" value={submissions.attempted} />
          <Stat label="Salvate" value={submissions.persisted} tone="good" />
          <Stat
            label="Salvataggi falliti"
            value={submissions.persistFailed}
            tone={submissions.persistFailed > 0 ? "bad" : "neutral"}
          />
          <Stat label="Validazioni fallite" value={submissions.validationFailed} />
          <Stat
            label="Duplicati evitati"
            value={submissions.duplicatesPrevented}
            hint="doppi invii bloccati"
          />
        </div>
        <p className="mt-2 text-sm text-ink-soft">
          Tasso di successo:{" "}
          <span className="font-bold tabular-nums text-ink">
            {percent(submissions.successRate)}
          </span>
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold text-ink">Notifiche email</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="In attesa" value={notifications.pending} />
          <Stat label="Inviate" value={notifications.sent} />
          <Stat label="Consegnate" value={notifications.delivered} tone="good" />
          <Stat
            label="Fallite"
            value={notifications.failed}
            tone={notifications.failed > 0 ? "bad" : "neutral"}
          />
          <Stat label="Tentativi totali" value={notifications.totalAttempts} />
        </div>
        <p className="mt-2 text-sm text-ink-soft">
          Tasso di consegna:{" "}
          <span className="font-bold tabular-nums text-ink">
            {percent(notifications.successRate)}
          </span>
          {notifications.delivered === 0 && notifications.sent > 0 && (
            <span className="ml-2 text-xs">
              (nessuna conferma di consegna — webhook Resend non configurato?)
            </span>
          )}
        </p>

        {notifications.recentErrors.length > 0 && (
          <ul className="mt-3 space-y-1">
            {notifications.recentErrors.map((entry) => (
              <li
                key={entry.error}
                className="flex items-center justify-between gap-3 rounded-lg bg-state-danger-soft px-3 py-2 text-xs"
              >
                <span className="min-w-0 break-all font-mono text-ink">{entry.error}</span>
                <span className="flex-none font-bold tabular-nums text-state-danger">
                  ×{entry.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold text-ink">Prestazioni</h2>
        <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-ink/10 bg-surface-soft text-xs uppercase tracking-wide text-ink-soft">
                <th scope="col" className="px-4 py-2 font-semibold">Fase</th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">p50</th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">p95</th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">Campioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {[
                { label: "Salvataggio richiesta", value: timings.persist },
                { label: "Invio email", value: timings.email },
                { label: "Totale richiesta", value: timings.total },
              ].map((row) => (
                <tr key={row.label}>
                  <td className="px-4 py-2 font-semibold text-ink">{row.label}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{ms(row.value.p50)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{ms(row.value.p95)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-soft">
                    {row.value.samples}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          I percentili compaiono solo con almeno 20 campioni nel periodo: una p95 calcolata su
          pochi invii è un numero che induce in errore.
        </p>
      </section>
    </>
  );
}
