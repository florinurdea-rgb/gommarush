"use client";

import { useState } from "react";
import { Button } from "@/components/Button";

export function BootstrapForm() {
  const [secret, setSecret] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/bootstrap-user", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret, email, password }),
      });
      const payload = (await response.json()) as { ok: boolean; code?: string; action?: string };

      if (!payload.ok) {
        setMessage({ kind: "error", text: `Errore: ${payload.code ?? "sconosciuto"}` });
        return;
      }

      setMessage({
        kind: "success",
        text:
          payload.action === "password_reset"
            ? "Password reimpostata. Ora puoi accedere con la nuova password."
            : "Account creato. Ora puoi accedere.",
      });
    } catch {
      setMessage({ kind: "error", text: "Errore di rete — riprova." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <div>
        <label htmlFor="secret" className="mb-1 block text-sm font-semibold text-ink">
          Cheie service_role
        </label>
        <input
          id="secret"
          type="password"
          autoComplete="off"
          required
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          className="h-12 w-full rounded-xl border border-ink/15 px-3 text-base text-ink outline-none focus:border-accent"
        />
      </div>

      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-semibold text-ink">
          Email admin
        </label>
        <input
          id="email"
          type="email"
          autoComplete="off"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-12 w-full rounded-xl border border-ink/15 px-3 text-base text-ink outline-none focus:border-accent"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-semibold text-ink">
          Password (min. 6 caratteri)
        </label>
        <input
          id="password"
          type="password"
          autoComplete="off"
          required
          minLength={6}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-12 w-full rounded-xl border border-ink/15 px-3 text-base text-ink outline-none focus:border-accent"
        />
      </div>

      {message && (
        <p
          role="alert"
          className={`rounded-lg p-3 text-sm font-medium ${
            message.kind === "error"
              ? "bg-state-danger-soft text-state-danger"
              : "bg-state-success-soft text-state-success"
          }`}
        >
          {message.text}
        </p>
      )}

      <Button type="submit" size="lg" disabled={busy} className="w-full">
        {busy ? "Elaborazione…" : "Crea / reimposta l'account"}
      </Button>
    </form>
  );
}
