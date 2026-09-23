"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BASKET_CHANGED_EVENT, basketQuantity } from "@/lib/customer/basket";
import { useTr } from "@/lib/i18n/tr";

/**
 * The basket link, with a live count.
 *
 * WHY THE COUNT EXISTS. Adding a tyre writes to localStorage and nothing on
 * screen changed — no badge, no toast, no number anywhere. A working click and
 * a broken one looked identical, and the feature was reported as "I can't add
 * items to basket" when the items were in fact being added.
 *
 * `writeBasket` already dispatched a change event; nothing listened to it.
 * This does, so the count moves the instant a tyre is added. `storage` is
 * listened to as well, because that one fires in OTHER tabs — a customer with
 * the catalogue open twice would otherwise see two different baskets.
 *
 * The count renders only after mount. The basket lives in the browser, so the
 * server cannot know it, and rendering a 0 on the server that immediately
 * becomes 3 would be a hydration mismatch.
 */
export function CustomerBasketLink({ className }: { className?: string }) {
  const tr = useTr();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const sync = () => setCount(basketQuantity());
    sync();

    window.addEventListener(BASKET_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    // Coming back to a tab that changed while hidden.
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(BASKET_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  return (
    <Link href="/account/basket" className={`relative inline-flex items-center gap-2 ${className ?? ""}`}>
      {tr("Carrello")}
      {count !== null && count > 0 && (
        <span
          aria-label={`${count} ${tr("articoli nel carrello")}`}
          className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-accent px-1.5 py-0.5 text-xs font-bold text-white"
        >
          {count}
        </span>
      )}
    </Link>
  );
}
