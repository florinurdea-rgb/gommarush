/** Period presets for the "Sumar" dashboard, resolved against a given "today". */

export type PeriodKey = "today" | "yesterday" | "7d" | "30d" | "this_month" | "last_month" | "custom";

export const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Oggi" },
  { key: "yesterday", label: "Ieri" },
  { key: "7d", label: "Ultimele 7 zile" },
  { key: "30d", label: "Ultimele 30 zile" },
  { key: "this_month", label: "Luna aceasta" },
  { key: "last_month", label: "Mese scorso" },
  { key: "custom", label: "Periodo personalizzato" },
];

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export interface DateRange {
  start: string;
  end: string;
}

/**
 * Resolves a period key to a concrete [start, end] date range (inclusive,
 * both ISO yyyy-mm-dd). `custom` requires explicit start/end and falls
 * back to the last 7 days if either is missing or malformed.
 */
export function resolvePeriod(key: PeriodKey, today: Date, custom?: { start?: string; end?: string }): DateRange {
  const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

  switch (key) {
    case "today":
      return { start: toIso(today), end: toIso(today) };
    case "yesterday": {
      const yesterday = addDays(today, -1);
      return { start: toIso(yesterday), end: toIso(yesterday) };
    }
    case "7d":
      return { start: toIso(addDays(today, -6)), end: toIso(today) };
    case "30d":
      return { start: toIso(addDays(today, -29)), end: toIso(today) };
    case "this_month": {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: toIso(first), end: toIso(today) };
    }
    case "last_month": {
      const firstOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const lastOfPrevMonth = addDays(firstOfThisMonth, -1);
      const firstOfPrevMonth = new Date(lastOfPrevMonth.getFullYear(), lastOfPrevMonth.getMonth(), 1);
      return { start: toIso(firstOfPrevMonth), end: toIso(lastOfPrevMonth) };
    }
    case "custom": {
      const start = custom?.start && isoDatePattern.test(custom.start) ? custom.start : toIso(addDays(today, -6));
      const end = custom?.end && isoDatePattern.test(custom.end) ? custom.end : toIso(today);
      return start <= end ? { start, end } : { start: end, end: start };
    }
    default:
      return { start: toIso(addDays(today, -6)), end: toIso(today) };
  }
}
