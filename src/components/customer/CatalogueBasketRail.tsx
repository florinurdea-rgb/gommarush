"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CommerceCartIcon } from "@/components/customer/CommerceIcons";
import { QuantityStepper } from "@/components/customer/QuantityStepper";
import {
  BASKET_CHANGED_EVENT,
  readBasket,
  writeBasket,
  type StoredBasketLine,
} from "@/lib/customer/basket";
import { useTr } from "@/lib/i18n/tr";

/**
 * The persistent basket beside the catalogue, from `lg`.
 *
 * WHY. A shop adding several sizes wants to see what is already in the basket
 * without leaving the results. This rail shows it and updates the moment a
 * line is added, changed or removed.
 *
 * ONE STORE. It reads and writes the same browser basket as every other
 * screen (src/lib/customer/basket.ts) and reacts to its change event, so the
 * catalogue, this rail, the header count and the basket page never disagree.
 *
 * DISPLAY DATA COMES FROM THE SERVER. The store holds product id, condition
 * and quantity only. Brand, model, size and the GommaRush unit price are read
 * from the basket preview route — which re-prices from CATALOGUE data and
 * makes NO supplier call (owner decision, 2026-09-26: the live check runs
 * only at final order confirmation). Nothing here shows a supplier, a cost, a
 * verification state or a total: the catalogue shows no monetary basket
 * total by decision, because it would be read as a quote.
 */

type LineDetail = {
  brand: string | null;
  modelPattern: string | null;
  sizeDisplay: string | null;
  unitTyreNetCents: number | null;
};

const lineKey = (line: { productId: string; oldDot: boolean }) =>
  `${line.productId}:${line.oldDot ? "1" : "0"}`;

const money = (c: number | null) =>
  c === null ? "—" : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(c / 100);

/** How long the rail waits for quantity edits to settle before re-reading details. */
const DETAILS_DEBOUNCE_MS = 250;

export function CatalogueBasketRail() {
  const tr = useTr();
  const [lines, setLines] = useState<StoredBasketLine[]>([]);
  const [details, setDetails] = useState<Record<string, LineDetail>>({});
  const request = useRef(0);

  // Follow the store: this tab's own writes, other tabs, and a tab regaining focus.
  useEffect(() => {
    const sync = () => setLines(readBasket());
    sync();
    window.addEventListener(BASKET_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(BASKET_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  // Names and unit prices for the lines, from the catalogue-only preview.
  const signature = lines.map((l) => `${lineKey(l)}x${l.quantity}`).join(",");
  useEffect(() => {
    if (!lines.length) return;
    const ticket = ++request.current;
    const timer = window.setTimeout(async () => {
      try {
        const r = await fetch("/api/account/basket/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lines }),
        });
        const j = await r.json();
        // A superseded response must not overwrite a newer one.
        if (ticket !== request.current || !r.ok) return;
        const next: Record<string, LineDetail> = {};
        for (const line of j.basket?.lines ?? []) {
          next[lineKey(line)] = {
            brand: line.tyre?.brand ?? null,
            modelPattern: line.tyre?.modelPattern ?? null,
            sizeDisplay: line.tyre?.sizeDisplay ?? null,
            unitTyreNetCents: line.unitTyreNetCents ?? null,
          };
        }
        setDetails(next);
      } catch {
        // The rail is a convenience; the lines and quantities still show.
      }
    }, DETAILS_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // `signature` captures every change to `lines` that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  function setQuantity(target: StoredBasketLine, quantity: number) {
    const next = readBasket()
      .map((x) => (lineKey(x) === lineKey(target) ? { ...x, quantity } : x))
      .filter((x) => x.quantity > 0);
    writeBasket(next);
  }

  const count = lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <aside aria-label={tr("Carrello")} className="hidden lg:sticky lg:top-[81px] lg:block">
      <div className="flex max-h-[calc(100vh-97px)] flex-col rounded-2xl border border-ink/10 bg-white">
        <div className="flex items-center justify-between gap-2 border-b border-ink/10 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-extrabold text-ink">
            <CommerceCartIcon className="h-[18px] w-[18px] text-ink-soft" />
            {tr("Carrello")}
          </h2>
          <span aria-live="polite" className="text-xs font-bold text-ink-soft">
            {count > 0 ? `${count} ${count === 1 ? tr("pneumatico") : tr("pneumatici")}` : ""}
          </span>
        </div>

        {lines.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-soft">{tr("Il carrello è vuoto.")}</p>
        ) : (
          <ul className="min-h-0 flex-1 divide-y divide-ink/10 overflow-y-auto px-4">
            {lines.map((line) => {
              const key = lineKey(line);
              const d = details[key];
              const name = [d?.brand, d?.modelPattern].filter(Boolean).join(" ");
              return (
                <li key={key} className="py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[10.5px] font-bold uppercase tracking-[0.08em] text-ink-soft">
                        {d ? d.brand || tr("Marca non indicata") : "…"}
                      </div>
                      {d?.modelPattern && (
                        <div className="truncate text-sm font-extrabold leading-tight text-ink">{d.modelPattern}</div>
                      )}
                      <div className="text-[13px] font-bold tabular-nums text-ink">{d?.sizeDisplay ?? ""}</div>
                    </div>
                    <div className="flex-none text-right text-xs font-semibold tabular-nums text-ink-soft">
                      {d ? `${money(d.unitTyreNetCents)} ${tr("netto / pz")}` : ""}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-1">
                    <QuantityStepper
                      value={line.quantity}
                      label={`${tr("Quantità")} ${name} ${d?.sizeDisplay ?? ""}`.trim()}
                      onChange={(q) => setQuantity(line, q)}
                    />
                    <button
                      type="button"
                      className="min-h-[44px] px-2 text-xs font-semibold text-ink-soft underline underline-offset-2 hover:text-ink"
                      onClick={() => setQuantity(line, 0)}
                    >
                      {tr("Rimuovi")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="border-t border-ink/10 p-3">
          <Link
            href="/account/basket"
            className="flex min-h-[44px] items-center justify-center rounded-xl bg-accent px-4 text-sm font-bold text-white hover:bg-accent-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            {tr("Vai al carrello")}
          </Link>
        </div>
      </div>
    </aside>
  );
}
