import { PageHeading } from "@/components/logistics/AdminShell";
import { SummaryPeriodSelector } from "@/components/logistics/SummaryPeriodSelector";
import { SummaryDashboard } from "@/components/logistics/SummaryDashboard";
import { getOperationalSummary } from "@/lib/server/summary";
import { resolvePeriod, PERIOD_OPTIONS } from "@/lib/logistics/summary-period";
import type { PeriodKey } from "@/lib/logistics/summary-period";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sumar" };

const VALID_PERIODS = new Set(PERIOD_OPTIONS.map((option) => option.key));

function formatDateRo(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

/**
 * "Sumar" — answers "ce s-a întâmplat în operațiune în perioada
 * selectată?". Every KPI/breakdown/insight comes from ONE shared query
 * (getOperationalSummary), not a separate fetch per card — see its own
 * doc comment for exactly which timestamp backs which number.
 */
export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; start?: string; end?: string }>;
}) {
  const params = await searchParams;
  const periodKey: PeriodKey = VALID_PERIODS.has(params.period as PeriodKey) ? (params.period as PeriodKey) : "7d";
  const range = resolvePeriod(periodKey, new Date(), { start: params.start, end: params.end });

  const summary = await getOperationalSummary(range.start, range.end);

  const periodLabel =
    range.start === range.end ? formatDateRo(range.start) : `${formatDateRo(range.start)} – ${formatDateRo(range.end)}`;

  return (
    <>
      <PageHeading title="Sumar" description={periodLabel} />

      <div className="mb-5">
        <SummaryPeriodSelector activePeriod={periodKey} />
      </div>

      <SummaryDashboard summary={summary} periodLabel={periodLabel} />
    </>
  );
}
