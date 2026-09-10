"use client";

import { useRouter } from "next/navigation";
import { useRealtimeSignal } from "@/hooks/useRealtimeSignal";

/**
 * Keeps the operational dashboard converged across phones, tablets and
 * office screens. Reacts to the 'gorush-ops' Realtime broadcast (see
 * useRealtimeSignal.ts) rather than polling blindly — a mutation commits,
 * the database trigger broadcasts a lightweight change signal, and every
 * open screen refetches the canonical server data. Focus/online/tab-
 * visible recovery and a 60s fallback poll (in case a message is ever
 * dropped) come from the same hook.
 *
 * router.refresh() only re-runs the server component tree, so client-side
 * state (selected date/search/open menus) survives every refresh.
 */
export function DashboardLiveRefresh() {
  const router = useRouter();
  useRealtimeSignal(() => router.refresh());
  return null;
}
