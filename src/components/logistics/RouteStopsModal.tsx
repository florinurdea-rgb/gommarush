"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import type { OrderListRow } from "@/lib/server/orders";
import type { Map as LeafletMap } from "leaflet";

/**
 * "Hartă" — the stop points for one vehicle's route, in delivery order.
 *
 * Geocoding is OpenStreetMap Nominatim (free, no API key) via
 * /api/admin/route-map, DB-cached server-side (geocode_cache) so re-opening
 * the same route doesn't re-geocode. A stop that fails to geocode still
 * shows in the list below the map, just without a marker — never silently
 * dropped.
 */
export function RouteStopsModal({
  vehicleName,
  orders,
  onClose,
}: {
  vehicleName: string;
  orders: OrderListRow[];
  onClose: () => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [points, setPoints] = useState<Map<string, { lat: number; lng: number } | null> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const stops = orders
    .map((order) => ({
      order,
      address: [order.customer_address, order.customer_city].filter(Boolean).join(", "),
    }))
    .filter((stop) => stop.address.length > 0);

  useEffect(() => {
    let cancelled = false;
    if (stops.length === 0) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    fetch("/api/admin/route-map", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stops: stops.map((stop) => ({ orderId: stop.order.id, address: stop.address })),
      }),
    })
      .then((response) => response.json())
      .then((payload: { ok: boolean; points?: { orderId: string; lat: number | null; lng: number | null }[] }) => {
        if (cancelled) return;
        if (!payload.ok || !payload.points) {
          setError("Nu s-au putut localiza adresele.");
          return;
        }
        const map = new Map<string, { lat: number; lng: number } | null>();
        for (const point of payload.points) {
          map.set(point.orderId, point.lat !== null && point.lng !== null ? { lat: point.lat, lng: point.lng } : null);
        }
        setPoints(map);
      })
      .catch(() => {
        if (!cancelled) setError("Eroare de rețea la localizarea adreselor.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleName]);

  useEffect(() => {
    if (!points || !mapContainerRef.current) return;

    const located = stops
      .map((stop, index) => ({ stop, index, point: points.get(stop.order.id) ?? null }))
      .filter((entry): entry is { stop: (typeof stops)[number]; index: number; point: { lat: number; lng: number } } =>
        entry.point !== null
      );
    if (located.length === 0) return;

    let disposed = false;

    void import("leaflet").then((L) => {
      if (disposed || !mapContainerRef.current) return;

      const map = L.map(mapContainerRef.current).setView([located[0].point.lat, located[0].point.lng], 12);
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const latLngs = located.map((entry) => [entry.point.lat, entry.point.lng] as [number, number]);
      L.polyline(latLngs, { color: "#2563eb", weight: 3, opacity: 0.7 }).addTo(map);

      for (const entry of located) {
        const icon = L.divIcon({
          className: "",
          html: `<div style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:9999px;background:#2563eb;color:white;font-weight:700;font-size:12px;box-shadow:0 1px 4px rgba(0,0,0,0.4);">${
            entry.index + 1
          }</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
        L.marker([entry.point.lat, entry.point.lng], { icon }).addTo(map).bindPopup(
          `<strong>${entry.index + 1}. ${entry.stop.order.customer_name ?? "—"}</strong><br/>${entry.stop.address}`
        );
      }

      map.fitBounds(latLngs, { padding: [24, 24] });
    });

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  return (
    <Modal onClose={onClose} size="lg" label={`Puncte de oprire — ${vehicleName}`}>
      <ModalHeader title={`Puncte de oprire — ${vehicleName}`} onClose={onClose} />
      <div className="p-6">
        {orders.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-soft">Nicio comandă pe această mașină.</p>
        ) : (
          <>
            {loading && <p className="mb-3 text-sm text-ink-soft">Se localizează adresele…</p>}
            {error && (
              <p role="alert" className="mb-3 rounded-lg bg-state-danger-soft px-3 py-2 text-sm text-state-danger">
                {error}
              </p>
            )}

            {!loading && points && (
              <div ref={mapContainerRef} className="mb-4 h-72 w-full overflow-hidden rounded-xl border border-ink/10" />
            )}

            <ol className="space-y-2">
              {stops.map((stop, index) => {
                const point = points?.get(stop.order.id);
                const geocodeFailed = points !== null && points !== undefined && point === null;
                return (
                  <li key={stop.order.id} className="flex gap-3 rounded-xl border border-ink/10 bg-white p-3">
                    <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-accent-light text-xs font-bold text-accent-dark">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-ink-soft">
                          {formatOrderNumber(stop.order.order_number)}
                        </span>
                        <span className="truncate text-sm font-bold text-ink">{stop.order.customer_name ?? "—"}</span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-ink-soft">{stop.address}</div>
                      {geocodeFailed && (
                        <div className="mt-0.5 text-xs font-semibold text-state-warning">
                          Adresa nu a putut fi localizată pe hartă.
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>

            <p className="mt-4 text-[11px] text-ink-soft">
              Hărți © colaboratorii{" "}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">
                OpenStreetMap
              </a>
              . Ordinea reflectă ordinea de livrare curentă, nu o rută optimizată.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
