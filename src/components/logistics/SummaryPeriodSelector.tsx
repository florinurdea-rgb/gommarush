"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { PERIOD_OPTIONS } from "@/lib/logistics/summary-period";
import type { PeriodKey } from "@/lib/logistics/summary-period";

export function SummaryPeriodSelector({ activePeriod }: { activePeriod: PeriodKey }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setPeriod(period: PeriodKey) {
    const params = new URLSearchParams(searchParams?.toString());
    params.set("period", period);
    if (period !== "custom") {
      params.delete("start");
      params.delete("end");
    }
    router.push(`/admin/summary?${params.toString()}`);
  }

  function setCustomRange(field: "start" | "end", value: string) {
    const params = new URLSearchParams(searchParams?.toString());
    params.set("period", "custom");
    params.set(field, value);
    router.push(`/admin/summary?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={activePeriod}
        onChange={(event) => setPeriod(event.target.value as PeriodKey)}
        className="h-10 rounded-lg border border-ink/15 bg-white px-3 text-sm font-semibold text-ink"
      >
        {PERIOD_OPTIONS.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>

      {activePeriod === "custom" && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            defaultValue={searchParams?.get("start") ?? ""}
            onChange={(event) => setCustomRange("start", event.target.value)}
            className="h-10 rounded-lg border border-ink/15 bg-white px-2 text-sm text-ink"
          />
          <span className="text-sm text-ink-soft">–</span>
          <input
            type="date"
            defaultValue={searchParams?.get("end") ?? ""}
            onChange={(event) => setCustomRange("end", event.target.value)}
            className="h-10 rounded-lg border border-ink/15 bg-white px-2 text-sm text-ink"
          />
        </div>
      )}
    </div>
  );
}
