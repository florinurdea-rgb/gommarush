"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage, t } from "@/lib/i18n/logistics";

/**
 * Driver login via Supabase Auth — the real authentication that replaced
 * Phase 1's "pick who you are" picker. See app/api/driver/login/route.ts
 * and src/lib/auth/driver-session.ts.
 */
export function DriverLoginForm() {
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
      const response = await fetch("/api/driver/login", {
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

      router.replace("/driver");
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
        <label htmlFor="driver-email" className="mb-1 block text-sm font-semibold text-white/80">
          {t("email")}
        </label>
        <input
          id="driver-email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-14 w-full rounded-xl border border-white/20 bg-white/10 px-4 text-lg text-white outline-none focus:border-white/60"
        />
      </div>

      <div>
        <label htmlFor="driver-password" className="mb-1 block text-sm font-semibold text-white/80">
          {t("password")}
        </label>
        <input
          id="driver-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-14 w-full rounded-xl border border-white/20 bg-white/10 px-4 text-lg text-white outline-none focus:border-white/60"
        />
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-state-danger p-3 text-sm font-semibold">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="min-h-16 w-full rounded-xl bg-accent text-xl font-extrabold text-white disabled:opacity-40"
      >
        {busy ? t("loading") : t("signIn")}
      </button>
    </form>
  );
}
