import { classifyLine, isPhysicalLine } from "@/lib/logistics/ddt-classification";
import type { ClassifiedLineType } from "@/lib/logistics/ddt-classification";
import type { ClassifiedQuantityLine } from "@/lib/logistics/ddt-calculations";

/**
 * Bridges a raw extracted line (quantity possibly unreadable) into the
 * calculators. Spec §19/§39 test E: "Nu ghici 1" — a physical line with an
 * unreadable quantity is never silently counted as one unit. It's excluded
 * from the totals entirely and surfaced separately so the caller can force
 * NEEDS_REVIEW instead of shipping a wrong tyre_count.
 */

type LegacyItemType = "tyre" | "tube" | "wheel" | "accessory" | "other" | "service" | "fee";

export interface RawExtractedLine {
  rawDescription: string;
  itemTypeHint?: LegacyItemType | null;
  /** null when the source couldn't read a quantity for this line. */
  quantity: number | null;
}

export interface UnreadableQuantityLine {
  rawDescription: string;
  lineType: ClassifiedLineType;
}

export interface ProcessedLines {
  countableLines: ClassifiedQuantityLine[];
  /** Physical lines with no readable quantity — non-empty means the order must be NEEDS_REVIEW. */
  unreadableQuantityLines: UnreadableQuantityLine[];
}

export function processLines(lines: RawExtractedLine[]): ProcessedLines {
  const countableLines: ClassifiedQuantityLine[] = [];
  const unreadableQuantityLines: UnreadableQuantityLine[] = [];

  for (const line of lines) {
    const lineType = classifyLine({ rawDescription: line.rawDescription, itemTypeHint: line.itemTypeHint });

    if (line.quantity === null) {
      if (isPhysicalLine(lineType)) {
        unreadableQuantityLines.push({ rawDescription: line.rawDescription, lineType });
      }
      continue;
    }

    countableLines.push({ lineType, quantity: line.quantity });
  }

  return { countableLines, unreadableQuantityLines };
}
