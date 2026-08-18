"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import type { Map as LeafletMap } from "leaflet";

export interface DriverRouteStop {
  orderId: string;
  orderNumber: number;
  customerName: string | null;
  address: string;
  point: { lat: number; lng: number } | null;
}

/**
 * The driver-facing route map — same rendering as the admin's RouteStopsModal
 * (Hartă on a Livrări lane), but takes already-geocoded stops as a plain prop
 * instead of fetching /api/admin/route-map itself: this page has no admin
 * session, so the geocoding happens server-side in the page component
 * (geocodeAddresses(), same function the admin route uses) and is passed
 * down pre-resolved.
 */
export function DriverRouteMapModal({
  vehicleName,
  stops,
  depotLocation,
  onClose,
}: {
  vehicleName: string;
  stops: DriverRouteStop[];
  depotLocation: { lat: number; lng: number } | null;
  onClose: () => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const located = stops
      .map((stop, index) => ({ stop, index }))
      .filter((entry): entry is { stop: DriverRouteStop & { point: { lat: number; lng: number } }; index: number } =>
        entry.stop.point !== null
      );
    if (located.length === 0 && !depotLocation) return;

    let disposed = false;

    void import("leaflet").then((L) => {
      if (disposed || !mapContainerRef.current) return;

      const initialCenter = depotLocation ?? located[0].stop.point;
      const map = L.map(mapContainerRef.current).setView([initialCenter.lat, initialCenter.lng], 12);
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const routeLatLngs: [number, number][] = [];
      if (depotLocation) routeLatLngs.push([depotLocation.lat, depotLocation.lng]);
      routeLatLngs.push(...located.map((entry) => [entry.stop.point.lat, entry.stop.point.lng] as [number, number]));

      if (routeLatLngs.length > 1) {
        L.polyline(routeLatLngs, { color: "#2563eb", weight: 3, opacity: 0.7 }).addTo(map);
      }

      if (depotLocation) {
        const depotIcon = L.divIcon({
          className: "",
          html: `<div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:#111827;color:white;box-shadow:0 1px 4px rgba(0,0,0,0.4);">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
            </svg>
          </div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        L.marker([depotLocation.lat, depotLocation.lng], { icon: depotIcon })
          .addTo(map)
          .bindPopup("<strong>Plecare — Depozit GommaRush</strong>");
      }

      for (const entry of located) {
        const icon = L.divIcon({
          className: "",
          html: `<div style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:9999px;background:#2563eb;color:white;font-weight:700;font-size:12px;box-shadow:0 1px 4px rgba(0,0,0,0.4);">${
            entry.index + 1
          }</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
        L.marker([entry.stop.point.lat, entry.stop.point.lng], { icon }).addTo(map).bindPopup(
          `<strong>${entry.index + 1}. ${entry.stop.customerName ?? "—"}</strong><br/>${entry.stop.address}`
        );
      }

      if (routeLatLngs.length > 1) {
        map.fitBounds(routeLatLngs, { padding: [24, 24] });
      }
    });

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, depotLocation]);

  return (
    <Modal onClose={onClose} size="lg" label={`Traseu — ${vehicleName}`}>
      <ModalHeader title={`Traseu — ${vehicleName}`} onClose={onClose} />
      <div className="p-6">
        {stops.length === 0 && !depotLocation ? (
          <p className="py-6 text-center text-sm text-ink-soft">Nicio comandă azi pe această mașină.</p>
        ) : (
          <>
            <div ref={mapContainerRef} className="mb-4 h-72 w-full overflow-hidden rounded-xl border border-ink/10" />

            <ol className="space-y-2">
              {depotLocation && (
                <li className="flex gap-3 rounded-xl border border-ink/10 bg-surface-soft p-3">
                  <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-ink text-white">
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
                      <path d="M3 10.5 12 3l9 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path
                        d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-ink">Plecare — Depozit GommaRush</div>
                    <div className="mt-0.5 text-xs text-ink-soft">
                      {depotLocation.lat.toFixed(6)}, {depotLocation.lng.toFixed(6)}
                    </div>
                  </div>
                </li>
              )}

              {stops.map((stop, index) => (
                <li key={stop.orderId} className="flex gap-3 rounded-xl border border-ink/10 bg-white p-3">
                  <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-accent-light text-xs font-bold text-accent-dark">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-ink-soft">
                        {formatOrderNumber(stop.orderNumber)}
                      </span>
                      <span className="truncate text-sm font-bold text-ink">{stop.customerName ?? "—"}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-ink-soft">{stop.address}</div>
                    {stop.point === null && (
                      <div className="mt-0.5 text-xs font-semibold text-state-warning">
                        Adresa nu a putut fi localizată pe hartă.
                      </div>
                    )}
                  </div>
                </li>
              ))}
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
