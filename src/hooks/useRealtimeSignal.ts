"use client";

import { useEffect, useRef } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Subscribes to the 'gorush-ops' Realtime Broadcast channel (see the
 * `gorush_broadcast_order_change`/`gorush_broadcast_vehicle_change`
 * triggers in supabase/migrations/20260824000000_phase1_stabilization.sql)
 * and calls `onSignal` whenever a mutation commits — the
 * "mutation -> realtime notification -> refetch canonical server data"
 * pattern from the Phase 1 stabilisation brief §14.
 *
 * Also calls `onSignal` on window focus, `online`, and tab becoming
 * visible again (recovery for a device that slept or lost connection),
 * and on a low-frequency fallback interval so the screen still converges
 * even if a Realtime message is ever dropped — WebSocket delivery is not
 * guaranteed, so this is a deliberate belt-and-braces choice, not a
 * leftover poll.
 *
 * Does not touch the DOM or fetch data itself: `onSignal` decides what
 * "relevant data changed" means for its own screen (e.g. re-running a
 * Server Component via router.refresh(), or skipping the refresh while
 * the user is mid-drag).
 */
const FALLBACK_POLL_MS = 60_000;
const MIN_GAP_MS = 1_000;

export function useRealtimeSignal(onSignal: () => void) {
  const onSignalRef = useRef(onSignal);
  onSignalRef.current = onSignal;

  useEffect(() => {
    const lastRef = { current: 0 };
    function fire() {
      const now = Date.now();
      if (now - lastRef.current < MIN_GAP_MS) return;
      lastRef.current = now;
      onSignalRef.current();
    }

    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      ?.channel("gorush-ops")
      .on("broadcast", { event: "change" }, () => fire())
      .subscribe();

    function onVisible() {
      if (document.visibilityState === "visible") fire();
    }

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") fire();
    }, FALLBACK_POLL_MS);

    window.addEventListener("focus", fire);
    window.addEventListener("online", fire);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", fire);
      window.removeEventListener("online", fire);
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) supabase?.removeChannel(channel);
    };
  }, []);
}
