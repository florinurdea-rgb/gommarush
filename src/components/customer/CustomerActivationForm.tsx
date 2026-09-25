"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import { MIN_CUSTOMER_PASSWORD_LENGTH, type ActivationType } from "@/lib/customer/activation";
import { useTr } from "@/lib/i18n/tr";

/**
 * The customer chooses their own password from the single-use link GommaRush
 * issued. Same field treatment as the sign-in form: 16px inputs (no iOS zoom),
 * visible focus, the error above the button.
 */
const ERRORS: Record<string, string> = {
  ACTIVATION_LINK_INVALID:
    "Il link non è valido o è scaduto. Chiedi a GommaRush un nuovo link di attivazione.",
  CUSTOMER_ACCOUNT_NOT_LINKED: "Account non abilitato al portale.",
  PASSWORD_REJECTED:
    "Password non accettata. Chiedi a GommaRush un nuovo link e scegli una password più lunga.",
  RATE_LIMITED: "Troppi tentativi. Riprova tra qualche minuto.",
};

export function CustomerActivationForm({ tokenHash, type }: { tokenHash: string; type: ActivationType }) {
  const tr = useTr();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_CUSTOMER_PASSWORD_LENGTH) {
      setError(tr("La password deve avere almeno 10 caratteri."));
      return;
    }
    if (password !== confirm) {
      setError(tr("Le due password non coincidono."));
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/account/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token_hash: tokenHash, type, password }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; code?: string };
      if (!r.ok || !j.ok) {
        setError(tr(ERRORS[j.code ?? ""] ?? "Attivazione non riuscita. Riprova."));
        return;
      }
      router.replace("/account/catalogue");
      router.refresh();
    } catch {
      setError(tr("Attivazione non riuscita. Riprova."));
    } finally {
      setBusy(false);
    }
  }

  const field =
    "h-12 w-full rounded-xl border border-ink/15 px-3 text-base text-ink outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30";
  const label = "mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft";

  return (
    <form onSubmit={submit} className="mt-5 space-y-3">
      <div>
        <label className={label} htmlFor="activation-password">
          {tr("Nuova password")}
        </label>
        <input
          id="activation-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_CUSTOMER_PASSWORD_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={field}
          aria-describedby="activation-password-hint"
        />
        <p id="activation-password-hint" className="mt-1 text-xs text-ink-soft">
          {tr("Almeno 10 caratteri.")}
        </p>
      </div>
      <div>
        <label className={label} htmlFor="activation-confirm">
          {tr("Conferma password")}
        </label>
        <input
          id="activation-confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={field}
        />
      </div>
      {error && (
        <p role="alert" className="rounded-xl border border-state-danger/30 bg-state-danger-soft p-3 text-sm text-state-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={busy} aria-busy={busy} className="w-full">
        {busy ? tr("Attivazione…") : tr("Attiva accesso")}
      </Button>
    </form>
  );
}
