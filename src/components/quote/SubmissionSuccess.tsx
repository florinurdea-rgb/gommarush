"use client";

import Link from "next/link";
import { useLocale } from "@/components/site/LocaleProvider";

/**
 * The confirmation state.
 *
 * Careful wording: this says we RECEIVED the request. It never claims the
 * offer has been prepared, emailed, or sent on WhatsApp — none of which has
 * happened yet at this point.
 *
 * Only shows data from the submission that just happened in this browser
 * flow; there is no public route where a request id reveals customer data.
 */
export function SubmissionSuccess({
  reference,
  email,
  whatsapp,
  onNewRequest,
}: {
  reference: string;
  email: string;
  whatsapp: string | null;
  onNewRequest: () => void;
}) {
  const { copy } = useLocale();

  return (
    <div className="mx-auto max-w-lg py-6 text-center">
      <span
        aria-hidden="true"
        className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-state-success-soft text-state-success"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8">
          <path
            d="M6 12.5l4 4 8-8"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>

      <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
        {copy.successTitle}
      </h1>

      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        {copy.successBodyPrefix}
      </p>
      <p className="mt-1 break-all text-base font-bold text-ink">{email}</p>

      {whatsapp && (
        <p className="mt-3 text-sm text-ink-soft">
          {copy.successWhatsapp} <span className="font-semibold text-ink">{whatsapp}</span>
        </p>
      )}

      <div className="mt-6 inline-flex items-baseline gap-2 rounded-xl border border-ink/10 bg-surface-soft px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
          {copy.successReferenceLabel}
        </span>
        <span className="font-mono text-lg font-bold text-ink">{reference}</span>
      </div>

      <div className="mt-8 flex flex-col items-center gap-3">
        <Link
          href="/"
          className="inline-flex min-h-12 w-full max-w-xs items-center justify-center rounded-xl bg-accent px-6 text-base font-bold text-white transition-colors hover:bg-accent-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          {copy.backToHome}
        </Link>
        <button
          type="button"
          onClick={onNewRequest}
          className="min-h-11 text-sm font-semibold text-ink-soft underline-offset-2 transition-colors hover:text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {copy.successNewRequest}
        </button>
      </div>
    </div>
  );
}
