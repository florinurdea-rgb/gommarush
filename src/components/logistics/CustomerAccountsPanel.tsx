"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { useTr } from "@/lib/i18n/tr";

/**
 * Portal access for one customer company.
 *
 * HOW ACCESS IS GRANTED. The operator enters the login email; the server
 * creates an unactivated Supabase Auth identity, binds it to THIS customer
 * (`customer_accounts`), and returns a single-use activation link. The
 * operator sends the link through the channel they already use with the
 * customer (email, WhatsApp); the customer opens it and chooses their own
 * password. No password is typed, generated, shown or stored here.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *  - infer a customer from an email or a domain — the binding is explicit;
 *  - restrict a company to one login — an owner and a counter manager may
 *    both need access, and the schema allows it;
 *  - delete logins — deactivating revokes access at once, is reversible, and
 *    keeps the binding that explains who placed past orders.
 */

export interface CustomerAccountRow {
  id: string;
  auth_user_id: string;
  active: boolean;
  created_at: string;
  email: string | null;
  state: "active" | "invited" | "disabled";
  lastSignInAt: string | null;
}

const inputClass =
  "h-11 w-full rounded-lg border border-ink/15 px-3 text-base text-ink outline-none focus:border-accent sm:text-sm";
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft";

/** Operator-facing explanations for the codes the accounts route returns. */
const ERRORS: Record<string, string> = {
  VALIDATION_FAILED: "Inserisci un indirizzo email valido.",
  LOCATION_REQUIRED:
    "Aggiungi prima un luogo di consegna con indirizzo e città: senza, il cliente non può completare un ordine.",
  EMAIL_ALREADY_REGISTERED:
    "Questa email ha già un accesso GommaRush (cliente, staff o autista). Usa un'altra email per questo cliente.",
  CUSTOMER_NOT_FOUND: "Cliente non trovato o non attivo.",
  CUSTOMER_AUTH_CREATE_FAILED: "Creazione dell'accesso non riuscita. Riprova.",
  CUSTOMER_ACCOUNT_LINK_FAILED: "Collegamento dell'accesso al cliente non riuscito. Riprova.",
  CUSTOMER_ACCOUNT_NOT_FOUND: "Accesso non trovato o disattivato.",
  ACTIVATION_LINK_FAILED: "Generazione del link non riuscita. Riprova.",
  SCHEMA_NOT_READY: "Il modulo account clienti non è ancora attivato nel database.",
};

const STATE_LABEL: Record<CustomerAccountRow["state"], { label: string; className: string }> = {
  active: { label: "Attivo", className: "bg-state-success-soft text-state-success" },
  invited: { label: "In attesa di attivazione", className: "bg-state-warning-soft text-ink" },
  disabled: { label: "Disattivato", className: "bg-state-neutral-soft text-state-neutral" },
};

export function CustomerAccountsPanel({
  customerId,
  deliverableLocationCount,
}: {
  customerId: string;
  /** Locations with a real street and city — the checkout requirement. */
  deliverableLocationCount: number;
}) {
  const tr = useTr();
  const [accounts, setAccounts] = useState<CustomerAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * Why the list could not be read, when it could not. Only a server-reported
   * SCHEMA_NOT_READY blames the schema; anything else shows its own code, so an
   * operator is never sent to re-run migrations that are already in place.
   */
  const [loadError, setLoadError] = useState<{ schemaMissing: boolean; code: string } | null>(null);

  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The link just issued, held in memory only until dismissed. */
  const [issued, setIssued] = useState<{ email: string; url: string; first: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/customers/${customerId}/accounts`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setLoadError({ schemaMissing: j.code === "SCHEMA_NOT_READY", code: j.code || `HTTP ${r.status}` });
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

  async function post(body: Record<string, unknown>, first: boolean) {
    setBusy(true);
    setError(null);
    setIssued(null);
    setCopied(false);
    try {
      const r = await fetch(`/api/admin/customers/${customerId}/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.code || `HTTP ${r.status}`);
      setIssued({ email: j.email, url: j.activationUrl, first });
      if (first) setEmail("");
      await load();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setError(tr(ERRORS[code] ?? "Operazione non riuscita.") + (ERRORS[code] ? "" : ` (${code})`));
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

  const activeCount = accounts.filter((a) => a.state === "active").length;
  const hasLocation = deliverableLocationCount > 0;
  const canGrant = email.includes("@") && hasLocation && !busy;

  return (
    <section id="accesso-area-clienti" className="scroll-mt-24 rounded-xl border-2 border-accent/30 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-ink">{tr("Accesso area clienti")}</h2>
        {!loading && !loadError && (
          <span
            className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold ${
              activeCount > 0 ? "bg-state-success-soft text-state-success" : "bg-state-neutral-soft text-state-neutral"
            }`}
          >
            {activeCount > 0 ? tr("Accesso ATTIVO") : tr("Accesso NON ATTIVO")}
          </span>
        )}
      </div>
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
                {accounts.map((account) => {
                  const state = STATE_LABEL[account.state];
                  return (
                    <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-ink">
                          {account.email ?? account.auth_user_id}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                          <span className={`inline-flex rounded-md px-2 py-0.5 font-bold ${state.className}`}>
                            {tr(state.label)}
                          </span>
                          <span>
                            {tr("Creato il")} {new Date(account.created_at).toLocaleDateString("it-IT")}
                          </span>
                          {account.lastSignInAt && (
                            <span>
                              · {tr("Ultimo accesso")} {new Date(account.lastSignInAt).toLocaleDateString("it-IT")}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {account.active && (
                          <Button
                            size="md"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => void post({ accountId: account.id, reissue: true }, false)}
                          >
                            {account.state === "invited" ? tr("Nuovo link di attivazione") : tr("Link per nuova password")}
                          </Button>
                        )}
                        <Button size="md" variant="secondary" disabled={busy} onClick={() => setActive(account.id, !account.active)}>
                          {account.active ? tr("Disattiva") : tr("Riattiva")}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {issued && (
            <div className="mt-4 rounded-xl border-2 border-state-success/40 bg-state-success-soft p-4">
              <p className="text-sm font-bold text-ink">
                {issued.first ? tr("Accesso creato per") : tr("Nuovo link per")} {issued.email}
              </p>
              <p className="mt-1 text-xs text-ink">
                {tr(
                  "Invia questo link al cliente: aprendolo sceglierà la sua password. Il link vale una sola volta e scade dopo un tempo limitato; se scade, generane uno nuovo."
                )}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="max-w-full select-all break-all rounded-lg border border-ink/15 bg-white px-3 py-2 font-mono text-xs">
                  {issued.url}
                </code>
                <Button
                  size="md"
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(issued.url);
                      setCopied(true);
                    } catch {
                      // Clipboard can be blocked; the block is select-all.
                      setCopied(false);
                    }
                  }}
                >
                  {copied ? tr("Copiato") : tr("Copia link")}
                </Button>
                <Button size="md" variant="ghost" onClick={() => setIssued(null)}>
                  {tr("Chiudi")}
                </Button>
              </div>
            </div>
          )}

          <div className="mt-5 border-t border-ink/10 pt-5">
            <h3 className="text-sm font-bold text-ink">{tr("Nuovo accesso")}</h3>
            {!hasLocation && (
              <p className="mt-2 rounded-lg bg-state-warning-soft p-3 text-sm text-ink">
                {tr(
                  "Aggiungi prima un luogo di consegna con indirizzo e città: senza, il cliente non può completare un ordine."
                )}
              </p>
            )}
            <div className="mt-3 max-w-md">
              <label className={labelClass} htmlFor="customer-account-email">
                {tr("Email di accesso del cliente")}
              </label>
              <input
                id="customer-account-email"
                type="email"
                inputMode="email"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                className={inputClass}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="mt-1 text-xs text-ink-soft">
                {tr("Riceverai un link di attivazione da inviare al cliente. Nessuna password passa dall'amministrazione.")}
              </p>
            </div>

            {error && (
              <p role="alert" className="mt-3 text-sm text-state-danger">
                {error}
              </p>
            )}

            <Button className="mt-4" disabled={!canGrant} onClick={() => void post({ email: email.trim().toLowerCase() }, true)}>
              {busy ? tr("Creazione…") : tr("Crea accesso e link di attivazione")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
