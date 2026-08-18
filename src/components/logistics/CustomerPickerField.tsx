"use client";

import { useEffect, useRef, useState } from "react";
import type { CustomerRow } from "@/lib/types/logistics";

/**
 * Searchable customer combobox for manual order entry — the brief: a
 * dropdown of every customer, filter-as-you-type, and a pinned "+ Client
 * nou" choice that clears the form for a genuinely new one rather than
 * silently reusing whatever was typed before.
 *
 * The text input doubles as both the search box and (when nothing from the
 * list has been picked) the free-typed company name that gets saved — no
 * separate "search" field to keep in sync with the real value.
 */

const inputClass =
  "h-11 w-full rounded-lg border border-ink/15 px-3 text-sm text-ink outline-none focus:border-accent";

export function CustomerPickerField({
  value,
  onChangeText,
  onSelectCustomer,
  onSelectNew,
  disabled,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSelectCustomer: (customer: CustomerRow) => void;
  onSelectNew: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  function scheduleSearch(query: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/admin/customers?q=${encodeURIComponent(query)}`);
        const payload = (await response.json()) as { ok: boolean; customers?: CustomerRow[] };
        setResults(payload.ok ? (payload.customers ?? []) : []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        className={inputClass}
        value={value}
        disabled={disabled}
        placeholder="Caută sau alege un client…"
        autoComplete="off"
        onFocus={() => {
          setOpen(true);
          scheduleSearch(value);
        }}
        onChange={(event) => {
          const text = event.target.value;
          onChangeText(text);
          setOpen(true);
          scheduleSearch(text);
        }}
      />

      {open && !disabled && (
        <div
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full min-w-[240px] overflow-y-auto rounded-lg border border-ink/10 bg-white py-1 shadow-modal"
        >
          <button
            type="button"
            onClick={() => {
              onSelectNew();
              setOpen(false);
            }}
            className="block w-full border-b border-ink/10 px-3 py-2 text-left text-sm font-semibold text-accent hover:bg-accent-light"
          >
            + Client nou
          </button>
          {loading && <div className="px-3 py-2 text-xs text-ink-soft">Se caută…</div>}
          {!loading && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-ink-soft">Niciun client găsit.</div>
          )}
          {!loading &&
            results.map((customer) => (
              <button
                key={customer.id}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onSelectCustomer(customer);
                  setOpen(false);
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-soft"
              >
                <div className="font-medium text-ink">{customer.name}</div>
                {customer.vat_number && <div className="text-xs text-ink-soft">{customer.vat_number}</div>}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
