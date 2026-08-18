"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps the operational dashboard converged across phones, tablets and office
 * screens without requiring Supabase Realtime/replication configuration.
 *
 * - visible dashboard: refresh every 5 seconds
 * - returning to a background tab: refresh immediately
 * - window regains focus: refresh immediately
 * - network comes back: refresh immediately
 *
 * router.refresh() only re-runs the server component tree, so client-side board
 * state such as the selected date/search remains mounted.
 */
const REFRESH_MS = 5_000;
const MIN_REFRESH_GAP_MS = 1_500;

export function DashboardLiveRefresh() {
  const router = useRouter();
  const lastRefreshRef = useRef(0);

  useEffect(() => {
    function refreshNow() {
      if (document.visibilityState !== "visible") return;

      const now = Date.now();
      if (now - lastRefreshRef.current < MIN_REFRESH_GAP_MS) return;
      lastRefreshRef.current = now;
      router.refresh();
    }

    const interval = window.setInterval(refreshNow, REFRESH_MS);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") refreshNow();
    }

    window.addEventListener("focus", refreshNow);
    window.addEventListener("online", refreshNow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshNow);
      window.removeEventListener("online", refreshNow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [router]);

  return null;
}
