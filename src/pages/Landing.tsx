import { Logo } from "../components/Logo";
import { LinkButton } from "../components/LinkButton";
import { HeroBackground } from "../components/HeroBackground";

const TRUST_POINTS = [
  { label: "Consegna rapida" },
  { label: "Prezzi competitivi" },
  { label: "Assistenza diretta" },
];

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="mx-auto w-full max-w-content px-4 pt-5 sm:px-6">
        <Logo />
      </header>

      <main className="relative flex flex-1 flex-col justify-center overflow-hidden">
        <HeroBackground />

        <div className="relative mx-auto flex w-full max-w-content flex-col items-start px-4 py-16 sm:px-6 sm:py-24">
          <h1 className="max-w-2xl text-[28px] font-extrabold leading-[1.15] tracking-tight text-ink sm:text-5xl lg:text-6xl">
            GoRush, il tuo fornitore
            <br />
            affidabile di pneumatici
          </h1>

          <h2 className="mt-6 max-w-md text-lg leading-relaxed text-ink-soft sm:max-w-lg sm:text-xl">
            Ricevi un&rsquo;offerta vantaggiosa e, quando serve, la consegna in
            24&ndash;48 ore. Serviamo aziende entro 50&nbsp;km da Verona.
          </h2>

          <div className="mt-9">
            <LinkButton
              href="/get-offer/"
              size="lg"
              className="shadow-card focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              Richiedi un&rsquo;offerta
            </LinkButton>
          </div>

          <p className="mt-6 text-sm text-ink-soft">
            Offerte rapide &bull; Consegna locale &bull; Supporto diretto
          </p>

          <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            {TRUST_POINTS.map((point) => (
              <li key={point.label} className="flex items-center gap-2 text-sm text-ink-soft">
                <svg aria-hidden="true" className="h-4 w-4 flex-none text-accent" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M4 10.5l3.5 3.5L16 5.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {point.label}
              </li>
            ))}
          </ul>
        </div>
      </main>

      <footer className="w-full border-t border-ink/10 bg-surface-soft">
        <div className="mx-auto w-full max-w-content px-4 py-5 text-center text-sm text-ink-soft sm:px-6 sm:text-left">
          &copy; 2026 GoRush Verona. Tutti i diritti riservati.
        </div>
      </footer>
    </div>
  );
}
