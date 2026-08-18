"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";

/**
 * Explicitly requested: seeds a handful of clearly-labeled demo orders
 * (see src/lib/server/demo-seed.ts) into the live database, to try out
 * /driver/route and the Livrări board with something on screen. This is a
 * deliberate, one-off, admin-triggered exception to this app's normal
 * "never fabricate operational data" rule — remove this button (and call
 * DELETE on the resulting orders, all tagged "DEMO —" in delivery_notes)
 * once it's no longer needed.
 */
export function DemoSeedButton() {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function seed() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/demo-seed", { method: "POST" });
      const payload = (await response.json()) as { ok: boolean; created?: number; code?: string };
      if (payload.ok) {
        showToast(`${payload.created ?? 0} comenzi demo create.`, "success");
        router.refresh();
      } else {
        showToast(`Nu am putut crea comenzile demo. (${payload.code ?? "eroare"})`, "error");
      }
    } catch {
      showToast("Eroare de rețea.", "error");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex h-9 items-center gap-1.5 rounded-lg border border-state-warning/40 bg-state-warning-soft px-2 text-xs font-semibold text-state-warning">
        Comenzi de test în producție?
        <button
          type="button"
          disabled={busy}
          onClick={() => void seed()}
          className="rounded-md bg-state-warning px-2 py-1 text-white disabled:opacity-50"
        >
          {busy ? "…" : "Da"}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="rounded-md px-2 py-1">
          Nu
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="flex h-9 items-center rounded-lg border border-dashed border-ink/20 bg-white px-3 text-xs font-semibold text-ink-soft hover:bg-surface-soft"
    >
      + Comenzi demo
    </button>
  );
}
