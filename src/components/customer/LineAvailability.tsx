"use client";
import Link from "next/link";
import {
  CommerceCheckIcon,
  CommerceRefreshIcon,
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
 * A VERIFICATION FAILURE IS NOT OUT OF STOCK, and the two must never look
 * alike. Out of stock is red and blocks the order; "temporarily unable to
 * confirm" is amber, carries the time of the figure being used, and does not
 * block anything.
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
  /** Null on the checkout, where the basket is not composed. */
  onAcceptAvailable?: ((quantity: number) => void) | null;
  busy?: boolean;
  /** True while a line-level validation is in flight. */
  validating?: boolean;
  tr: (text: string) => string;
}

/**
 * When the figure behind this line was established.
 *
 * A time, not an adjective. A tyre shop can judge for itself whether an
 * hour-old figure is good enough for what it is about to promise its own
 * customer; "recente" takes that judgement away from them.
 */
function observedLabel(
  source: VerifiedSource,
  at: string | null,
  tr: (t: string) => string
): string {
  const time = at
    ? new Date(at).toLocaleString("it-IT", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
      })
    : null;

  if (source === "live") {
    return time ? `${tr("Verificato ora")} · ${time}` : tr("Verificato ora");
  }
  if (source === "feed_after_live_failure") {
    return time ? `${tr("Verifica non riuscita — dato del")} ${time}` : tr("Verifica non riuscita");
  }
  return time ? `${tr("Disponibilità rilevata alle")} ${time}` : tr("Disponibilità da rilevare");
}

const PANEL = "mt-3 rounded-xl border p-3";

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
  validating,
  tr,
}: LineStatusProps) {
  const href = alternativesHref(tyre);
  const observed = observedLabel(verifiedSource, verifiedAt, tr);

  /*
    Verification in progress. Its own state rather than a spinner over the
    line: the figure on screen is still the last good one, and blanking it
    while a quantity is re-checked makes a two-second round trip look like a
    tyre that vanished.
  */
  if (validating) {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
        <CommerceRefreshIcon className="h-3.5 w-3.5 animate-spin" />
        {tr("Verifica in corso…")}
      </p>
    );
  }

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
        <p className="mt-1 text-xs text-ink">{observed}</p>
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
      <span className="text-ink-soft">{observed}</span>
    </p>
  );
}
