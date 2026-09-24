"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CartIcon } from "@/components/customer/CartIcon";
import { BASKET_CHANGED_EVENT, basketQuantity } from "@/lib/customer/basket";
import { useTr } from "@/lib/i18n/tr";

/**
 * The basket link, with a cart icon and a live count.
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

  /**
   * A brief enlargement of the badge when the count GOES UP.
   *
   * The number changing is easy to miss at the far end of a header the
   * customer is not looking at. Growing it for a moment moves the eye there
   * once, which is the whole job; the toast beside the card carries the
   * detail.
   *
   * Only on an increase — shrinking the badge when a line is removed would
   * celebrate the wrong event.
   */
  const [bumped, setBumped] = useState(false);
  const previous = useRef<number | null>(null);

  useEffect(() => {
    const sync = () => {
      const next = basketQuantity();
      setCount(next);
      if (previous.current !== null && next > previous.current) {
        setBumped(true);
        window.setTimeout(() => setBumped(false), 420);
      }
      previous.current = next;
    };
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
    <Link href="/account/basket" className={`relative inline-flex items-center gap-1.5 ${className ?? ""}`}>
      <CartIcon className="h-[1.15rem] w-[1.15rem] shrink-0" />
      {tr("Carrello")}
      {count !== null && count > 0 && (
        <span
          aria-label={`${count} ${tr("articoli nel carrello")}`}
          className={`inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-accent px-1.5 py-0.5 text-xs font-bold text-white transition-transform duration-200 ease-out ${
            bumped ? "scale-125" : "scale-100"
          }`}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
