// The browser-side basket.
//
// It stores THREE FACTS per line and nothing else: which canonical product,
// which stock condition, how many. No price, no supplier, no availability —
// every one of those is re-resolved server-side on each preview and checkout,
// so nothing here is authoritative about money.
//
// It is also the only place in the portal that writes to localStorage, which
// is not always available: Safari private browsing, blocked site data and
// storage quotas all make `setItem` throw. A throw here used to escape into an
// onClick handler, so "Aggiungi" did nothing and said nothing. Writes now
// report success, and callers tell the customer when one fails.

export interface StoredBasketLine {
  productId: string;
  oldDot: boolean;
  quantity: number;
}

const KEY = "gommarush_customer_basket_v1";

/** Fired after a successful write, so open views can update their count. */
export const BASKET_CHANGED_EVENT = "gommarush:basket";

const MAX_QUANTITY = 100;

export function readBasket(): StoredBasketLine[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter(
          (x) =>
            x &&
            typeof x.productId === "string" &&
            typeof x.oldDot === "boolean" &&
            Number.isInteger(x.quantity) &&
            x.quantity > 0
        )
      : [];
  } catch {
    return [];
  }
}

/**
 * Persists the basket.
 *
 * Returns false when storage refused the write, so the caller can say so
 * rather than leaving the customer clicking a button that appears dead.
 * The change event is dispatched only on a real write.
 */
export function writeBasket(lines: StoredBasketLine[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(BASKET_CHANGED_EVENT));
  return true;
}

export function addBasketLine(productId: string, oldDot: boolean, quantity = 1): boolean {
  const lines = readBasket();
  const found = lines.find((x) => x.productId === productId && x.oldDot === oldDot);
  if (found) found.quantity = Math.min(MAX_QUANTITY, found.quantity + quantity);
  else lines.push({ productId, oldDot, quantity });
  return writeBasket(lines);
}

/** Total tyres in the basket — what the nav badge counts. */
export function basketQuantity(lines: StoredBasketLine[] = readBasket()): number {
  return lines.reduce((total, line) => total + line.quantity, 0);
}
