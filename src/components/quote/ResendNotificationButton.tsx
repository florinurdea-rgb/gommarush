"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Retries the internal sales notification for one request.
 *
 * The retry is what makes the persist-before-notify design complete: the
 * request survived the mail failure, and once the configuration is fixed the
 * notification can still go out without asking the customer to resubmit.
 *
 * On failure it shows the provider's own reason rather than "riprova" — that
 * string ("domain is not verified", "API key is invalid") is the difference
 * between a five-minute fix and an afternoon of guessing.
 */
export function ResendNotificationButton({
  requestId,
  subdued = false,
}: {
  requestId: string;
  /** Quieter styling for the operational section, where nothing is wrong. */
  subdued?: boolean;
}) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: boolean; error: string | null } | null>(null);

  async function resend() {
    if (sending) return;
    setSending(true);
    setResult(null);

    try {
      const response = await fetch(`/api/admin/quote-requests/${requestId}/resend-email`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        ok: boolean;
        sent?: boolean;
        error?: string | null;
        attempts?: number | null;
        code?: string;
      };

      if (!payload.ok) {
        setResult({ sent: false, error: payload.code ?? "Richiesta non riuscita" });
        return;
      }

      setResult({ sent: Boolean(payload.sent), error: payload.error ?? null });
      // Refresh so the banner and the "Email KO" badge reflect the new state.
      if (payload.sent) router.refresh();
    } catch {
      setResult({ sent: false, error: "Rete non raggiungibile" });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => void resend()}
        disabled={sending}
        className={
          subdued
            ? "inline-flex min-h-11 items-center justify-center rounded-lg border border-ink/15 bg-white px-4 text-sm font-semibold text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            : "inline-flex min-h-11 items-center justify-center rounded-lg border border-state-danger/40 bg-white px-5 text-sm font-bold text-state-danger transition-colors hover:bg-state-danger hover:text-white disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-state-danger focus-visible:ring-offset-2"
        }
      >
        {sending ? "Invio in corso…" : "Reinvia notifica email"}
      </button>

      {result && (
        <p
          role="status"
          className={`mt-2 text-sm font-semibold ${
            result.sent ? "text-state-success" : "text-state-danger"
          }`}
        >
          {result.sent ? "Email inviata." : `Invio non riuscito: ${result.error ?? "motivo sconosciuto"}`}
        </p>
      )}
    </div>
  );
}
