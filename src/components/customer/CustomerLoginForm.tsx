"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import { useTr } from "@/lib/i18n/tr";

/**
 * Customer sign-in.
 *
 * The copy, the endpoint and the two failure messages are unchanged; what is
 * new is the field treatment — 48px inputs, a visible focus ring, and an error
 * that sits above the button rather than between the fields.
 */
export function CustomerLoginForm() {
  const tr = useTr();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/account/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const p = (await r.json()) as { ok?: boolean; code?: string };
      if (!r.ok || !p.ok) {
        setError(
          tr(
            p.code === "CUSTOMER_ACCOUNT_NOT_LINKED"
              ? "Account non abilitato al portale."
              : "Email o password non validi."
          )
        );
        return;
      }
      router.replace("/account");
      router.refresh();
    } catch {
      setError(tr("Accesso non disponibile. Riprova."));
    } finally {
      setBusy(false);
    }
  }

  const field =
    "h-12 w-full rounded-xl border border-ink/15 px-3 text-[15px] text-ink outline-none transition-colors focus:border-accent";

  return (
    <form onSubmit={submit} className="mt-5 space-y-3">
      <div>
        <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft" htmlFor="customer-email">
          Email
        </label>
        <input
          id="customer-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={field}
        />
      </div>
      <div>
        <label
          className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft"
          htmlFor="customer-password"
        >
          Password
        </label>
        <input
          id="customer-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={field}
        />
      </div>
      {error && (
        <p role="alert" className="rounded-xl border border-state-danger/30 bg-state-danger-soft p-3 text-sm text-state-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={busy} className="w-full">
        {busy ? tr("Accesso…") : tr("Accedi")}
      </Button>
    </form>
  );
}
