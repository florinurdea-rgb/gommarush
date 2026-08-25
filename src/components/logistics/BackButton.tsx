"use client";

import { useRouter } from "next/navigation";

/**
 * "← Indietro" for secondary/drill-down admin pages (order detail, new order,
 * customer detail, …) — never on the five primary nav destinations in
 * AdminShell, which are where "back" would go anyway.
 *
 * router.back() rather than a fixed parent href: it genuinely returns to
 * wherever the admin actually came from (the dashboard, a search result,
 * another order), which is what "pagina precedentă" means — a hardcoded
 * link can only guess one specific parent.
 */
export function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink"
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
        <path d="M12.5 15L7 10l5.5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Indietro
    </button>
  );
}
