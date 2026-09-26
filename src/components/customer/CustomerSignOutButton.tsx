"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTr } from "@/lib/i18n/tr";

/**
 * Sign out.
 *
 * Deliberately quiet: it sits beside the navigation in a header whose one
 * accent-coloured thing should be what the customer came to do, not the way
 * out. Same 40px height as the nav links so the header row stays on one line.
 */
export function CustomerSignOutButton() {
  const tr = useTr();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      className="inline-flex min-h-[40px] items-center rounded-lg border border-ink/15 px-3 text-[14px] font-semibold text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/account/logout", { method: "POST" });
          router.replace("/account/login");
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "…" : tr("Esci")}
    </button>
  );
}
