"use client";
import Link from "next/link";
import {
  CommerceCheckIcon,
  CommerceWarningIcon,
} from "@/components/customer/CommerceIcons";
import { alternativesHref, type AlternativesTyre } from "@/lib/customer/alternatives";

/**
 * One line's fulfilment state, and what the customer can do about it.
 *
 * Shared by the basket and the checkout so the two screens cannot drift into
 * describing the same state differently — which is precisely the kind of
 * disagreement that makes a customer distrust both of them.
 *
 * THE CUSTOMER BUYS FROM GOMMARUSH. Every word here is about whether
 * GommaRush can fulfil what was asked for. Nothing names a source, a lane, a
 * feed or a check — those exist behind this component and must not surface
 * through it.
 *
 * NO VERIFICATION UI. Owner decision, 2026-09-26: the live supplier check
 * runs only at final order confirmation, so nothing here shows a verification
 * source, a timestamp, a retry or an in-progress check. The state drawn is the
 * one the server derived from current catalogue data; the order gate makes
 * the authoritative check, and a failed check there is reported by the
 * checkout — never as out of stock.
 */

export type LineState = "available" | "limited" | "unavailable";

export interface LineStatusProps {
  state: LineState;
  availableQuantity: number | null;
  unavailableReason: string | null;
  requestedQuantity: number;
  tyre: AlternativesTyre | null;
  /** Null on the checkout, where the basket is not composed. */
  onAcceptAvailable?: ((quantity: number) => void) | null;
  busy?: boolean;
  tr: (text: string) => string;
}

const PANEL = "mt-3 rounded-xl border p-3";

export function LineAvailability({
  state,
  availableQuantity,
  unavailableReason,
  requestedQuantity,
  tyre,
  onAcceptAvailable,
  busy,
  tr,
}: LineStatusProps) {
  const href = alternativesHref(tyre);

  if (state === "unavailable") {
    return (
      <div className={`${PANEL} border-state-danger/30 bg-state-danger-soft`}>
        <p className="flex items-center gap-1.5 text-sm font-bold text-state-danger">
          <CommerceWarningIcon className="h-4 w-4 flex-none" />
          {tr("Non disponibile")}
        </p>
        <p className="mt-1 text-xs text-ink">
          {unavailableReason === "unknown_product"
            ? tr("Questo articolo non è più a catalogo.")
            : tr("Questo pneumatico non è al momento acquistabile.")}
        </p>
        {/*
          The way out. Without it an unavailable line is a dead end and the
          customer's only move is to abandon the basket — which is the same
          outcome as not stocking the tyre at all. The line itself stays: it is
          never removed for them.
        */}
        {href && (
          <Link
            href={href}
            className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-ink px-4 text-sm font-bold text-white"
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
      <div className={`${PANEL} border-state-warning/40 bg-state-warning-soft`}>
        <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
          <CommerceWarningIcon className="h-4 w-4 flex-none text-state-warning" />
          {tr("Disponibili solo")} {available} {tr("su")} {requestedQuantity}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {/*
            One press to make the line orderable again, rather than asking the
            customer to retype a number the screen already knows. It is offered,
            never applied for them: silently reducing what somebody asked for is
            how an order arrives short without anyone deciding it should.
          */}
          {onAcceptAvailable && available > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAcceptAvailable(available)}
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-ink px-4 text-sm font-bold text-white disabled:opacity-50"
            >
              {tr("Porta a")} {available}
            </button>
          )}
          {href && (
            <Link
              href={href}
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-ink/20 bg-white px-4 text-sm font-bold text-ink"
            >
              {tr("Vedi alternative")}
            </Link>
          )}
        </div>
      </div>
    );
  }

  /*
    Available. A quiet confirmation — one line, no panel. The eye should be
    drawn to the lines that need something, and a green box on every row makes
    the one red box harder to find rather than easier.
  */
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className="inline-flex items-center gap-1 font-bold text-state-success">
        <CommerceCheckIcon className="h-3.5 w-3.5" />
        {tr("Disponibile")}
      </span>
    </p>
  );
}
