import {
  NOTIFICATION_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
  type NotificationStatus,
  type QuoteRequestStatus,
} from "@/lib/types/quote-request";

/**
 * Status indicators for the quote pipeline.
 *
 * Restrained on purpose: nine lifecycle states rendered in nine different
 * colours would make the list harder to read, not easier. Only the two
 * states that need a human to act (a new request, a failed notification)
 * carry colour; everything in flight is neutral, and the two end states are
 * quietly distinguished. Shape and weight do the rest.
 */

const STATUS_CLASS: Record<QuoteRequestStatus, string> = {
  submitted: "bg-state-warning-soft text-ink ring-1 ring-inset ring-state-warning/30",
  reviewing: "bg-surface-soft text-ink-soft ring-1 ring-inset ring-ink/10",
  quote_preparing: "bg-surface-soft text-ink-soft ring-1 ring-inset ring-ink/10",
  quote_ready: "bg-accent-light text-accent-dark ring-1 ring-inset ring-accent/20",
  sent: "bg-accent-light text-accent-dark ring-1 ring-inset ring-accent/20",
  accepted: "bg-state-success-soft text-state-success ring-1 ring-inset ring-state-success/25",
  rejected: "bg-surface-soft text-ink-soft ring-1 ring-inset ring-ink/10",
  expired: "bg-surface-soft text-ink-soft ring-1 ring-inset ring-ink/10",
  archived: "bg-surface-soft text-ink-soft/70 ring-1 ring-inset ring-ink/5",
};

export function QuoteRequestStatusBadge({
  status,
  size = "sm",
}: {
  status: QuoteRequestStatus;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={`inline-flex flex-none items-center rounded-full font-semibold ${
        size === "md" ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs"
      } ${STATUS_CLASS[status]}`}
    >
      {QUOTE_STATUS_LABELS[status]}
    </span>
  );
}

const NOTIFICATION_CLASS: Record<NotificationStatus, string> = {
  pending: "bg-surface-soft text-ink-soft ring-1 ring-inset ring-ink/10",
  sending: "bg-surface-soft text-ink-soft ring-1 ring-inset ring-ink/10",
  sent: "bg-surface-soft text-ink-soft ring-1 ring-inset ring-ink/10",
  delivered: "bg-state-success-soft text-state-success ring-1 ring-inset ring-state-success/25",
  failed: "bg-state-danger-soft text-state-danger ring-1 ring-inset ring-state-danger/30",
};

/**
 * The notification's own state, kept visually quieter than the business
 * status — it is operational detail, not the thing the sales team is
 * tracking. Only `failed` is loud, because only `failed` needs action.
 */
export function NotificationStatusBadge({
  status,
  title,
}: {
  status: NotificationStatus;
  title?: string | null;
}) {
  return (
    <span
      title={title ?? undefined}
      className={`inline-flex flex-none items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${NOTIFICATION_CLASS[status]}`}
    >
      {NOTIFICATION_STATUS_LABELS[status]}
    </span>
  );
}
