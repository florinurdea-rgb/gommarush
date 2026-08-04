"use client";

import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { LinkButton } from "@/components/LinkButton";
import {
  readAndClearOfferConfirmation,
  type StoredOfferConfirmation,
} from "@/lib/offer-confirmation-storage";
import { DELIVERY_LABELS, SEASON_LABELS } from "@/lib/types/ui";

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface-soft">
      <header className="border-b border-ink/10 bg-white">
        <div className="mx-auto w-full max-w-content px-4 py-4 sm:px-6">
          <Logo />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-content flex-1 flex-col px-4 py-10 sm:px-6 sm:py-14">
        {children}
      </main>
    </div>
  );
}

export default function RequestConfirmationPage() {
  // undefined = haven't checked sessionStorage yet, null = checked and empty
  const [confirmation, setConfirmation] = useState<StoredOfferConfirmation | null | undefined>(
    undefined
  );

  useEffect(() => {
    setConfirmation(readAndClearOfferConfirmation());
  }, []);

  if (confirmation === undefined) {
    return <PageShell>{null}</PageShell>;
  }

  if (confirmation === null) {
    return (
      <PageShell>
        <div className="mx-auto max-w-md text-center">
          <h1 className="text-2xl font-extrabold text-ink">Nessuna richiesta recente trovata.</h1>
          <p className="mt-3 text-base text-ink-soft">
            Non abbiamo trovato i dettagli di una richiesta inviata di recente in questa sessione.
          </p>
          <div className="mt-8">
            <LinkButton href="/get-offer" size="lg">
              Richiedi un&rsquo;offerta
            </LinkButton>
          </div>
        </div>
      </PageShell>
    );
  }

  const { requestNumber, summary } = confirmation;

  return (
    <PageShell>
      <div className="mx-auto w-full max-w-lg">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-accent-light text-accent">
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-5 w-5">
              <path
                d="M4 10.5l3.5 3.5L16 5.5"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <h1 className="text-2xl font-extrabold text-ink sm:text-3xl">Richiesta di offerta inviata</h1>
        </div>

        <p className="mt-4 text-base text-ink-soft">
          La tua richiesta &egrave; stata inviata correttamente. Ti ricontatteremo al pi&ugrave;
          presto.
        </p>
        <p className="mt-1.5 text-base text-ink-soft">
          Ti ricontatteremo al pi&ugrave; presto con disponibilit&agrave;, prezzi e tempi di
          consegna.
        </p>

        <div className="mt-6 inline-flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-4 py-2.5">
          <span className="text-sm text-ink-soft">Numero richiesta</span>
          <span className="font-mono text-sm font-bold text-ink">{requestNumber}</span>
        </div>

        <div className="mt-8 rounded-2xl border border-ink/10 bg-white p-5 shadow-card sm:p-6">
          <dl className="flex flex-col gap-4">
            {summary.companyName ? (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  Azienda
                </dt>
                <dd className="mt-0.5 text-base font-semibold text-ink">{summary.companyName}</dd>
              </div>
            ) : null}

            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Contatto
              </dt>
              <dd className="mt-0.5 text-base font-semibold text-ink">{summary.contact}</dd>
            </div>

            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Consegna preferita
              </dt>
              <dd className="mt-0.5 text-base font-semibold text-ink">
                {DELIVERY_LABELS[summary.deliveryPreference]}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Pneumatici richiesti
              </dt>
              <dd className="mt-2 flex flex-col gap-3">
                {summary.tyres.map((tyre) => (
                  <div key={tyre.id} className="rounded-xl border border-ink/10 bg-surface-soft p-3">
                    <p className="text-sm font-bold text-ink">
                      {tyre.width}/{tyre.profile} R{tyre.rim}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-soft">
                      {SEASON_LABELS[tyre.season]} &middot; Quantit&agrave;: {tyre.quantity}
                    </p>
                    {tyre.notes ? (
                      <p className="mt-0.5 text-sm text-ink-soft">Preferenza: {tyre.notes}</p>
                    ) : null}
                  </div>
                ))}
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <LinkButton href="/" size="lg" className="sm:flex-1">
            Torna alla home
          </LinkButton>
          <LinkButton href="/get-offer" variant="secondary" size="lg" className="sm:flex-1">
            Invia un&rsquo;altra richiesta
          </LinkButton>
        </div>
      </div>
    </PageShell>
  );
}
