"use client";
import Link from "next/link";
import { alternativesHref, type AlternativesTyre } from "@/lib/customer/alternatives";

/**
 * One basket line's availability, and what the customer can do about it.
 *
 * Shared by the basket and the checkout so the two screens cannot drift into
 * describing the same state differently — which is precisely the kind of
 * disagreement that makes a customer distrust both of them.
 *
 * Three states, three different offers of help:
 *
 *   available    a quiet confirmation, with what it was checked against.
 *   limited      the number that is actually there, and one click to accept it.
 *   unavailable  the plain word, and a way to find a replacement in this size.
 */

export type LineState = "available" | "limited" | "unavailable";
export type VerifiedSource = "live" | "feed" | "feed_after_live_failure";

export interface LineStatusProps {
  state: LineState;
  availableQuantity: number | null;
  unavailableReason: string | null;
  requestedQuantity: number;
  verifiedSource: VerifiedSource;
  verifiedAt: string | null;
  tyre: AlternativesTyre | null;
  /** Null on the checkout, where quantities are not editable. */
  onAcceptAvailable?: ((quantity: number) => void) | null;
  busy?: boolean;
  tr: (text: string) => string;
}

/**
 * When the figure behind this line was observed.
 *
 * Shown as a time, not as "fresh" or "recent": a tyre shop can judge whether
 * an hour-old stock figure is good enough for what it is about to promise its
 * own customer, and an adjective takes that judgement away from them.
 */
function observedLabel(
  source: VerifiedSource,
  at: string | null,
  tr: (t: string) => string
): string {
  const time = at
    ? new Date(at).toLocaleString("it-IT", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })
    : null;

  if (source === "live") {
    return time ? `${tr("Verificato ora con il fornitore")} · ${time}` : tr("Verificato ora con il fornitore");
  }
  if (source === "feed_after_live_failure") {
    return time
      ? `${tr("Fornitore non raggiungibile — dato del")} ${time}`
      : tr("Fornitore non raggiungibile — dato archiviato");
  }
  return time ? `${tr("Disponibilità rilevata alle")} ${time}` : tr("Disponibilità da rilevare");
}

export function LineAvailability({
  state,
  availableQuantity,
  unavailableReason,
  requestedQuantity,
  verifiedSource,
  verifiedAt,
  tyre,
  onAcceptAvailable,
  busy,
  tr,
}: LineStatusProps) {
  const href = alternativesHref(tyre);
  const observed = observedLabel(verifiedSource, verifiedAt, tr);

  if (state === "unavailable") {
    return (
      <div className="mt-3 rounded-xl border border-state-danger/30 bg-state-danger-soft p-3">
        <p className="text-sm font-bold text-state-danger">{tr("Non disponibile in stock")}</p>
        <p className="mt-1 text-xs text-ink">
          {unavailableReason === "unknown_product"
            ? tr("Questo articolo non è più a catalogo.")
            : tr("Questo pneumatico non è al momento acquistabile.")}
        </p>
        {/*
          The way out. Without it an unavailable line is a dead end and the
          customer's only move is to abandon the basket — which is the same
          outcome as not stocking the tyre at all.
        */}
        {href && (
          <Link
            href={href}
            className="mt-3 inline-flex min-h-[40px] items-center justify-center rounded-xl bg-ink px-4 text-sm font-bold text-white"
          >
            {tr("Vedi alternative")}
          </Link>
        )}
      </div>
    );
  }

  if (state === "limited") {
    const available = availableQuantity ?? 0;
    return (
      <div className="mt-3 rounded-xl border border-state-warning/40 bg-state-warning-soft p-3">
        <p className="text-sm font-bold text-ink">
          {tr("Disponibili solo")} {available} {tr("su")} {requestedQuantity}
        </p>
        <p className="mt-1 text-xs text-ink">{observed}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {/*
            One click to make the basket orderable again, rather than asking
            the customer to retype a number the screen already knows.
          */}
          {onAcceptAvailable && available > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAcceptAvailable(available)}
              className="inline-flex min-h-[40px] items-center justify-center rounded-xl bg-ink px-4 text-sm font-bold text-white disabled:opacity-50"
            >
              {tr("Porta a")} {available}
            </button>
          )}
          {href && (
            <Link
              href={href}
              className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-ink/20 px-4 text-sm font-bold text-ink"
            >
              {tr("Vedi alternative")}
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1 font-semibold text-state-success">
        <span aria-hidden="true">●</span>
        {tr("Disponibile")}
      </span>
      <span className="text-ink-soft">{observed}</span>
    </p>
  );
}
