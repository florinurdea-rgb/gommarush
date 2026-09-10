"use client";

import { useLocale } from "@/components/site/LocaleProvider";
import { summariseDraft, type DraftItem } from "@/components/quote/item-model";

/**
 * A committed item, collapsed to one line:
 *   205/55 R16 91V
 *   4 pz · Miglior prezzo · 48 ore
 */
export function QuoteItemSummary({
  item,
  onEdit,
  onRemove,
}: {
  item: DraftItem;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { copy } = useLocale();

  const preference =
    item.preferenceType === "specific_brand" && item.preferredBrand.trim()
      ? item.preferredBrand.trim()
      : copy.bestPrice;
  const delivery = item.deliverySpeed === "48h" ? copy.within48h : copy.within7d;

  return (
    <li className="flex items-start justify-between gap-3 rounded-2xl border border-ink/10 bg-white p-4">
      <div className="min-w-0">
        <div className="truncate text-base font-bold text-ink">{summariseDraft(item)}</div>
        <div className="mt-0.5 text-sm text-ink-soft">
          {item.quantity} {copy.pieces} · {preference} · {delivery}
        </div>
      </div>
      <div className="flex flex-none gap-1">
        <button
          type="button"
          onClick={onEdit}
          className="min-h-11 rounded-lg px-3 text-sm font-semibold text-accent transition-colors hover:bg-accent-light focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {copy.edit}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="min-h-11 rounded-lg px-3 text-sm font-semibold text-ink-soft transition-colors hover:bg-state-danger-soft hover:text-state-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-state-danger"
        >
          {copy.remove}
        </button>
      </div>
    </li>
  );
}
