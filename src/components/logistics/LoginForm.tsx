"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import { errorMessage, t } from "@/lib/i18n/logistics";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json()) as { ok: boolean; code?: string; details?: string[] };

      if (!payload.ok) {
        if (payload.code === "RATE_LIMITED" && payload.details?.[0]) {
          const seconds = Number(payload.details[0]);
          setError(
            Number.isFinite(seconds)
              ? `${errorMessage(payload.code)} (~${Math.ceil(seconds / 60)} min)`
              : errorMessage(payload.code)
          );
        } else {
          setError(errorMessage(payload.code));
        }
        return;
      }

      // replace(), not push(): the login page must not sit in history behind
      // the dashboard.
      router.replace("/admin");
      router.refresh();
    } catch {
      setError(errorMessage("UNKNOWN"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-semibold text-ink">
          {t("email")}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-12 w-full rounded-xl border border-ink/15 px-3 text-base text-ink outline-none focus:border-accent"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-semibold text-ink">
          {t("password")}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-12 w-full rounded-xl border border-ink/15 px-3 text-base text-ink outline-none focus:border-accent"
        />
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-state-danger-soft p-3 text-sm font-medium text-state-danger">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" disabled={busy} className="w-full">
        {busy ? t("loading") : t("signIn")}
      </Button>
    </form>
  );
}
