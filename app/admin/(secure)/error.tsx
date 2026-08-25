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
      <h1 className="text-xl font-extrabold text-ink">Si è verificato un errore nel caricamento della pagina</h1>
      <p className="mt-2 max-w-md text-sm text-ink-soft">
        Se hai appena aggiunto una funzione nuova (es. la gestione veicoli), molto probabilmente una migrazione del
        migrazione del database non è ancora stata eseguita su Supabase. Controlla i log di Vercel per i dettagli.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-xs text-ink-soft">Digest: {error.digest}</p>
      )}
      <Button onClick={reset} className="mt-5">
        Riprova
      </Button>
    </div>
  );
}
