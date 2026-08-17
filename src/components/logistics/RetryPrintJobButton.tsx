"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage, t } from "@/lib/i18n/logistics";

export function RetryPrintJobButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="inline-flex flex-col items-end">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const response = await fetch(`/api/admin/print-jobs/${jobId}`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action: "retry" }),
            });
            const payload = (await response.json()) as { ok: boolean; code?: string };
            if (!payload.ok) setError(errorMessage(payload.code));
            else router.refresh();
          } catch {
            setError(errorMessage("UNKNOWN"));
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-soft disabled:opacity-50"
      >
        {busy ? "…" : t("retry")}
      </button>
      {error && <span className="mt-1 text-xs text-state-danger">{error}</span>}
    </div>
  );
}
