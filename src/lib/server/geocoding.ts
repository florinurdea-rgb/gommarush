import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { logError } from "@/lib/logger";

export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * Address → coordinates for the vehicle board's "Mappa" feature, using the
 * free OpenStreetMap Nominatim API — no key, no billing. Results are cached
 * in the geocode_cache table so a repeat "Mappa" open never re-hits it, and
 * uncached lookups within one request are spaced ~1.1s apart in line with
 * Nominatim's usage policy (max 1 request/second, no bulk/parallel use).
 */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "GommaRush-Logistics-Admin/1.0 (+https://gommarush.com; route map for internal delivery planning)";

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFromNominatim(address: string): Promise<GeoPoint | null> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", address);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "ro,it" },
  });
  if (!response.ok) return null;

  const results = (await response.json()) as Array<{ lat: string; lon: string }>;
  const first = results[0];
  if (!first) return null;

  const lat = Number.parseFloat(first.lat);
  const lng = Number.parseFloat(first.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/**
 * Geocodes a batch of addresses, returning a map keyed by the ORIGINAL
 * (non-normalized) address string passed in — a stop whose address failed
 * to geocode maps to `null` rather than being omitted, so the caller can
 * still show it in a list.
 */
export async function geocodeAddresses(addresses: string[]): Promise<Map<string, GeoPoint | null>> {
  const supabase = createSupabaseAdminClient();
  const result = new Map<string, GeoPoint | null>();

  const uniqueAddresses = [...new Set(addresses.map((address) => address.trim()).filter(Boolean))];
  if (uniqueAddresses.length === 0) return result;

  const normalizedToOriginal = new Map<string, string>();
  for (const address of uniqueAddresses) normalizedToOriginal.set(normalizeAddress(address), address);
  const normalizedKeys = [...normalizedToOriginal.keys()];

  const { data: cached, error } = await supabase
    .from("geocode_cache")
    .select("address_key, latitude, longitude")
    .in("address_key", normalizedKeys);

  if (error && error.code !== "42P01") {
    // 42P01 = undefined_table — the geocode_cache migration hasn't run yet;
    // degrade to "geocode everything, cache nothing" rather than crashing.
    logError("geocode_cache_read_failed", error);
  }

  const cachedKeys = new Set<string>();
  for (const row of cached ?? []) {
    const original = normalizedToOriginal.get(row.address_key as string);
    if (!original) continue;
    result.set(original, { lat: row.latitude as number, lng: row.longitude as number });
    cachedKeys.add(row.address_key as string);
  }

  const toFetch = normalizedKeys.filter((key) => !cachedKeys.has(key));
  for (let index = 0; index < toFetch.length; index++) {
    const key = toFetch[index];
    const original = normalizedToOriginal.get(key)!;
    try {
      const point = await fetchFromNominatim(original);
      result.set(original, point);
      if (point) {
        const { error: upsertError } = await supabase
          .from("geocode_cache")
          .upsert({ address_key: key, address_text: original, latitude: point.lat, longitude: point.lng });
        if (upsertError && upsertError.code !== "42P01") logError("geocode_cache_write_failed", upsertError);
      }
    } catch (fetchError) {
      logError("geocode_lookup_failed", fetchError);
      result.set(original, null);
    }
    if (index < toFetch.length - 1) await delay(1100);
  }

  return result;
}
