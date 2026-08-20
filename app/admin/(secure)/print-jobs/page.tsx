import { listPrintJobs } from "@/lib/server/print-jobs";
import { PageHeading } from "@/components/logistics/AdminShell";
import { PrintJobStatusBadge } from "@/components/logistics/StatusBadge";
import { RetryPrintJobButton } from "@/components/logistics/RetryPrintJobButton";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import { t } from "@/lib/i18n/logistics";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coadă de printare" };

/**
 * The label print queue.
 *
 * The web app never prints: it queues rows here and the GoRush Print Agent on
 * the Windows machine claims them. If the agent or printer is offline, jobs
 * simply stay `pending` — nothing is lost, and this screen is where an Admin
 * confirms that and retries anything that failed.
 */
export default async function PrintJobsPage() {
  const jobs = await listPrintJobs({ limit: 100 });
  const pending = jobs.filter((job) => job.status === "pending").length;
  const failed = jobs.filter((job) => job.status === "failed").length;

  return (
    <>
      <PageHeading
        title={t("printQueue")}
        description={`${pending} în așteptare · ${failed} eșuate`}
      />

      <div className="mb-5 rounded-xl border border-ink/10 bg-white p-4 text-sm text-ink-soft">
        Aplicația web nu printează direct. Sarcinile sunt preluate de{" "}
        <strong className="text-ink">GoRush Print Agent</strong> de pe calculatorul
        Windows conectat la imprimantă. Dacă agentul este oprit, etichetele rămân
        în coadă și nu se pierd.
      </div>

      {jobs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink/20 bg-white px-6 py-12 text-center text-ink-soft">
          Nicio sarcină de printare.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white shadow-card">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-ink/10 bg-surface-soft text-xs uppercase tracking-wide text-ink-soft">
                <th scope="col" className="px-4 py-3 font-semibold">{t("status")}</th>
                <th scope="col" className="px-4 py-3 font-semibold">{t("orderNumber")}</th>
                <th scope="col" className="px-4 py-3 font-semibold">Produs</th>
                <th scope="col" className="px-4 py-3 font-semibold">Încercări</th>
                <th scope="col" className="px-4 py-3 font-semibold">Creat</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">{t("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {jobs.map((job) => (
                <tr key={job.id} className="hover:bg-surface-soft/60">
                  <td className="px-4 py-3">
                    <PrintJobStatusBadge status={job.status} size="sm" />
                    {job.error_message && (
                      <div className="mt-1 max-w-xs truncate text-xs text-state-danger" title={job.error_message}>
                        {job.error_message}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {formatOrderNumber(job.label_data?.order_number ?? null)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-ink">{job.label_data?.product ?? "—"}</div>
                    <div className="text-xs text-ink-soft">{job.label_data?.customer ?? ""}</div>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{job.attempts}</td>
                  <td className="px-4 py-3 text-xs text-ink-soft">
                    {new Date(job.created_at).toLocaleString("ro-RO")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {job.status !== "printed" && <RetryPrintJobButton jobId={job.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
