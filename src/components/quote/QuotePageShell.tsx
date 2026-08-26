"use client";

import { GlobalHeader } from "@/components/site/GlobalHeader";
import { QuoteRequestForm } from "@/components/quote/QuoteRequestForm";
import { useLocale } from "@/components/site/LocaleProvider";

/**
 * Client shell for the quote page — the title and intro need the active
 * locale, which lives in a client context. Kept separate from the route file
 * so the route itself stays a server component and can export metadata.
 */
export function QuotePageShell() {
  const { copy } = useLocale();

  return (
    <div className="flex min-h-screen flex-col bg-surface-soft">
      <GlobalHeader showBack />

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
          {copy.quoteTitle}
        </h1>
        <p className="mt-2 max-w-xl text-base leading-relaxed text-ink-soft">
          {copy.quoteIntro}
        </p>

        <div className="mt-8">
          <QuoteRequestForm />
        </div>
      </main>
    </div>
  );
}
