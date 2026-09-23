"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { useTr } from "@/lib/i18n/tr";

/**
 * Portal logins for one customer company.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *
 *  - It never shows an existing password. None is stored in a readable form
 *    and none is echoed back; a panel that can display a credential is a panel
 *    that will eventually display it to the wrong person.
 *  - It sends no invitation email. Email delivery is not configured for this
 *    purpose and inventing an invite flow would mean inventing its wording,
 *    its expiry and its trust model. The operator passes the temporary
 *    password on through whatever channel they already use.
 *  - It does not restrict a company to one login. The schema permits several
 *    on purpose — a tyre shop may have an owner and a counter manager — and
 *    narrowing that here would be a business rule nobody approved.
 *
 * Deactivating is preferred over deleting: it revokes access immediately,
 * it is reversible, and the company's past orders keep the binding that
 * explains who placed them.
 */

export interface CustomerAccountRow {
  id: string;
  auth_user_id: string;
  active: boolean;
  created_at: string;
  email: string | null;
}

const inputClass =
  "h-11 w-full rounded-lg border border-ink/15 px-3 text-sm text-ink outline-none focus:border-accent";
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft";

const MIN_PASSWORD_LENGTH = 12;

/** A suggestion the operator can accept or overwrite. Never auto-submitted. */
function suggestPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!?@#";
  const bytes = new Uint32Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function CustomerAccountsPanel({ customerId }: { customerId: string }) {
  const tr = useTr();
  const [accounts, setAccounts] = useState<CustomerAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * Why the list could not be read, when it could not.
   *
   * This used to be a single `unavailable` boolean that rendered "the module
   * is not activated in the database" for ANY failure. Once the migrations
   * were applied that message became actively misleading: a permissions
   * problem, a network blip or a 500 all claimed the schema was missing, and
   * an operator following that advice would go and re-run migrations that
   * were already in place. The real code is shown instead.
   */
  const [loadError, setLoadError] = useState<{ schemaMissing: boolean; code: string } | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The credentials just created, shown ONCE.
   *
   * There is no password reset in the portal yet, so a temporary password that
   * the operator did not copy before the field cleared would strand the
   * customer — the only recovery would be deleting the account and making
   * another. Holding it in component state until the operator dismisses it is
   * the smallest honest fix: it never leaves the browser, it is never stored,
   * and reloading the page loses it, which is the correct behaviour for a
   * credential.
   */
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/customers/${customerId}/accounts`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setLoadError({
          // 0005 not applied is the one cause with a specific remedy, and the
          // route reports it distinctly. Everything else keeps its own code.
          schemaMissing: j.code === "SCHEMA_NOT_READY",
          code: j.code || `HTTP ${r.status}`,
        });
        setAccounts([]);
        return;
      }
      setAccounts(j.accounts ?? []);
      setLoadError(null);
    } catch (e) {
      setLoadError({ schemaMissing: false, code: e instanceof Error ? e.message : "NETWORK_ERROR" });
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const r = await fetch(`/api/admin/customers/${customerId}/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.details?.[0] || j.code);
      setCreated({ email: j.email ?? email.trim().toLowerCase(), password });
      setCopied(false);
      setEmail("");
      setPassword("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : tr("Creazione non riuscita."));
    } finally {
      setBusy(false);
    }
  }

  async function setActive(accountId: string, active: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/customers/${customerId}/accounts`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId, active }),
      });
      if (!r.ok) throw new Error((await r.json()).code);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : tr("Aggiornamento non riuscito."));
    } finally {
      setBusy(false);
    }
  }

  const canCreate = email.includes("@") && password.length >= MIN_PASSWORD_LENGTH && !busy;

  return (
    <section
      id="accesso-area-clienti"
      className="scroll-mt-24 rounded-xl border-2 border-accent/30 bg-white p-5"
    >
      <h2 className="text-sm font-extrabold uppercase tracking-wide text-ink">
        {tr("Accesso area clienti")}
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        {tr(
          "L'accesso al portale viene creato manualmente. Non esiste registrazione pubblica e nessun cliente viene riconosciuto dall'indirizzo email."
        )}
      </p>

      {loadError ? (
        <div className="mt-4 rounded-lg bg-state-danger-soft p-3">
          <p className="text-sm font-semibold text-state-danger">
            {loadError.schemaMissing
              ? tr("Il modulo account clienti non è ancora attivato nel database.")
              : tr("Impossibile leggere gli accessi di questo cliente.")}
          </p>
          <p className="mt-1 text-xs text-state-danger">{loadError.code}</p>
          <Button className="mt-3" size="md" variant="secondary" onClick={() => void load()}>
            {tr("Riprova")}
          </Button>
        </div>
      ) : (
        <>
          <div className="mt-4">
            {loading ? (
              <p className="text-sm text-ink-soft">{tr("Caricamento…")}</p>
            ) : accounts.length === 0 ? (
              <p className="text-sm text-ink-soft">{tr("Nessun accesso configurato.")}</p>
            ) : (
              <ul className="divide-y divide-ink/10">
                {accounts.map((account) => (
                  <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink">
                        {account.email ?? account.auth_user_id}
                      </div>
                      <div className="text-xs text-ink-soft">
                        {account.active ? tr("Attivo") : tr("Disattivato")} ·{" "}
                        {tr("Creato il")} {new Date(account.created_at).toLocaleDateString("it-IT")}
                      </div>
                    </div>
                    <Button
                      size="md"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setActive(account.id, !account.active)}
                    >
                      {account.active ? tr("Disattiva") : tr("Riattiva")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-5 border-t border-ink/10 pt-5">
            <h3 className="text-sm font-bold text-ink">{tr("Nuovo accesso")}</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="customer-account-email">
                  {tr("Email")}
                </label>
                <input
                  id="customer-account-email"
                  type="email"
                  autoComplete="off"
                  className={inputClass}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="customer-account-password">
                  {tr("Password temporanea")}
                </label>
                <div className="flex gap-2">
                  <input
                    id="customer-account-password"
                    type="text"
                    autoComplete="off"
                    className={inputClass}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <Button size="md" variant="secondary" onClick={() => setPassword(suggestPassword())}>
                    {tr("Genera")}
                  </Button>
                </div>
                <p className="mt-1 text-xs text-ink-soft">
                  {tr("Almeno 12 caratteri. Comunicala al cliente: non sarà più visibile qui.")}
                </p>
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-state-danger">{error}</p>}
            {created && (
              <div className="mt-4 rounded-xl border-2 border-state-success/40 bg-state-success-soft p-4">
                <p className="text-sm font-bold text-ink">
                  {tr("Accesso creato per")} {created.email}
                </p>
                <p className="mt-1 text-xs text-ink">
                  {tr("Copia ora la password temporanea: non sarà più visibile dopo aver chiuso questo messaggio.")}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <code className="select-all rounded-lg border border-ink/15 bg-white px-3 py-2 font-mono text-sm">
                    {created.password}
                  </code>
                  <Button
                    size="md"
                    variant="secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(created.password);
                        setCopied(true);
                      } catch {
                        // Clipboard can be blocked; the code block is
                        // select-all so it stays copyable by hand.
                        setCopied(false);
                      }
                    }}
                  >
                    {copied ? tr("Copiata") : tr("Copia")}
                  </Button>
                  <Button size="md" variant="ghost" onClick={() => setCreated(null)}>
                    {tr("Ho copiato la password")}
                  </Button>
                </div>
              </div>
            )}

            <Button className="mt-4" disabled={!canCreate} onClick={create}>
              {busy ? tr("Creazione…") : tr("Crea accesso")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
