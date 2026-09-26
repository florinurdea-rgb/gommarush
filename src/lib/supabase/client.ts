"use client";

import { createBrowserClient } from "@supabase/ssr";
import { resolveSupabasePublicConfig } from "@/lib/supabase/config";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client — publishable/anon key only, RLS-governed, no
 * secret. Used exclusively for Realtime Broadcast subscriptions (see
 * useRealtimeSignal.ts): the payload carried on that channel is a
 * non-sensitive change signal only (table/id/status — never a customer
 * name, address, or payment amount), so this client never reads or
 * writes a table directly. All real data still goes through the
 * authenticated Next.js server, which re-checks the session on every
 * request — this client cannot bypass that.
 */
let cached: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (cached) return cached;
  const config = resolveSupabasePublicConfig();
  if (!config) return null;
  cached = createBrowserClient(config.url, config.key);
  return cached;
}
