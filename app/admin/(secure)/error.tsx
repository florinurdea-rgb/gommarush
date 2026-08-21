"use client";

import { useEffect } from "react";
import { Button } from "@/components/Button";

/**
 * Route-segment error boundary for every /admin page behind the session
 * guard. Without this, a server-side exception anywhere in here (a missing
 * DB column, a bad query, …) renders Next.js's bare "Application error: a
 * server-side exception has occurred" — no context, not even in Romanian.
 * This at least names the likely cause class and gives a retry, and the
 * digest lets it be matched to the real error in Vercel's logs.
 */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("admin_page_error", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-xl font-extrabold text-ink">A apărut o eroare la încărcarea paginii</h1>
      <p className="mt-2 max-w-md text-sm text-ink-soft">
        Dacă tocmai ai adăugat o funcție nouă (ex. tabloul de mașini), cel mai probabil o migrare de
        bază de date nu a fost încă rulată în Supabase. Verifică logurile din Vercel pentru detalii.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-xs text-ink-soft">Digest: {error.digest}</p>
      )}
      <Button onClick={reset} className="mt-5">
        Încearcă din nou
      </Button>
    </div>
  );
}
