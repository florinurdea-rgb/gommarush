import Link from "next/link";
import { StandBadge } from "@/components/logistics/StandBadge";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import { t } from "@/lib/i18n/logistics";
import type { StandOverview } from "@/lib/server/stands";

/**
 * The five temporary sorting stands and what is currently on each.
 *
 * These are stands, NOT warehouse zones — Phase 1 deliberately keeps the two
 * unrelated. A free stand is shown as free rather than hidden, because "which
 * stand can I use" is the question this board exists to answer.
 */
export function StandBoard({ stands }: { stands: StandOverview[] }) {
  return (
    <section aria-label="Stative" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {stands.map((stand) => {
        const occupied = Boolean(stand.orderId);
        const body = (
          <>
            <StandBadge standCode={stand.standCode} size="lg" />
            <div className="min-w-0 flex-1">
              {occupied ? (
                <>
                  <div className="font-mono text-sm font-bold text-accent">
                    {formatOrderNumber(stand.orderNumber)}
                  </div>
                  <div className="truncate text-sm font-semibold text-ink">
                    {stand.customerName ?? "—"}
                  </div>
                </>
              ) : (
                <div className="text-sm font-semibold text-state-success">
                  Stativ {stand.standCode} {t("standFree")}
                </div>
              )}
            </div>
          </>
        );

        const className =
          "flex items-center gap-3 rounded-xl border bg-white p-3 shadow-card transition-colors " +
          (occupied ? "border-ink/10 hover:bg-surface-soft" : "border-state-success/30");

        return occupied ? (
          <Link key={stand.standCode} href={`/admin/orders/${stand.orderId}`} className={className}>
            {body}
          </Link>
        ) : (
          <div key={stand.standCode} className={className}>
            {body}
          </div>
        );
      })}
    </section>
  );
}
