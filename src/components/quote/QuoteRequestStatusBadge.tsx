import type { QuoteRequestStatus } from "@/lib/types/quote-request";

/**
 * Status chip for the admin surface. Italian labels — the admin dashboard's
 * operational language, matching the rest of the internal UI.
 */

const META: Record<QuoteRequestStatus, { label: string; className: string }> = {
  new: { label: "Nuova", className: "bg-state-warning-soft text-state-warning" },
  in_progress: { label: "In lavorazione", className: "bg-state-progress-soft text-state-progress" },
  offer_sent: { label: "Offerta inviata", className: "bg-state-success-soft text-state-success" },
};

export function quoteStatusLabel(status: QuoteRequestStatus): string {
  return META[status]?.label ?? status;
}

export function QuoteRequestStatusBadge({
  status,
  size = "sm",
}: {
  status: QuoteRequestStatus;
  size?: "sm" | "md";
}) {
  const meta = META[status] ?? { label: status, className: "bg-state-neutral-soft text-state-neutral" };

  return (
    <span
      className={`inline-flex items-center rounded-md font-bold ${meta.className} ${
        size === "md" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-xs"
      }`}
    >
      {meta.label}
    </span>
  );
}
