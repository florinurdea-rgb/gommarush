import { describe, expect, it } from "vitest";
import {
  QUOTE_GROUPS,
  QUOTE_GROUP_LABELS,
  QUOTE_GROUP_STATUSES,
  QUOTE_REQUEST_STATUSES,
  groupOfStatus,
  isQuoteGroup,
  type QuoteRequestStatus,
} from "@/lib/types/quote-request";
import { listQuoteRequestsQuerySchema } from "@/lib/validation/quote-request";

/**
 * The tabs are derived from status, never stored beside it. These tests are
 * what guarantees that: a status can only ever be in exactly one tab, and
 * changing a status is therefore the whole of "moving between tabs".
 */

describe("quote request groups", () => {
  it("assigns every lifecycle status to exactly one tab", () => {
    for (const status of QUOTE_REQUEST_STATUSES) {
      const matches = QUOTE_GROUPS.filter((group) =>
        (QUOTE_GROUP_STATUSES[group] as readonly string[]).includes(status)
      );
      expect(matches, `"${status}" should be in exactly one tab`).toHaveLength(1);
    }
  });

  it("covers the full lifecycle — no status is missing from every tab", () => {
    const covered = QUOTE_GROUPS.flatMap((group) => [...QUOTE_GROUP_STATUSES[group]]);
    expect([...covered].sort()).toEqual([...QUOTE_REQUEST_STATUSES].sort());
  });

  /** The behaviour the user asked for, stated directly. */
  it("moves a request between tabs when its status changes", () => {
    expect(groupOfStatus("submitted")).toBe("to_answer");
    expect(groupOfStatus("quote_ready")).toBe("to_answer");
    // Marking the offer as sent moves it out of the work tab.
    expect(groupOfStatus("sent")).toBe("offer_sent");
    // And an outcome moves it to the closed tab.
    expect(groupOfStatus("accepted")).toBe("closed");
    expect(groupOfStatus("rejected")).toBe("closed");
  });

  it("treats expired and archived as outcomes, not open work", () => {
    expect(groupOfStatus("expired")).toBe("closed");
    expect(groupOfStatus("archived")).toBe("closed");
  });

  it("never returns an unlabelled tab", () => {
    for (const status of QUOTE_REQUEST_STATUSES) {
      expect(QUOTE_GROUP_LABELS[groupOfStatus(status)]).toBeTruthy();
    }
  });

  /** A hand-edited ?tab= must not reach the query builder. */
  it("recognises only real tab values", () => {
    expect(isQuoteGroup("to_answer")).toBe(true);
    expect(isQuoteGroup("closed")).toBe(true);
    expect(isQuoteGroup("everything")).toBe(false);
    expect(isQuoteGroup(null)).toBe(false);
  });

  it("rejects an invalid tab in the query string", () => {
    expect(listQuoteRequestsQuerySchema.safeParse({ tab: "to_answer" }).success).toBe(true);
    expect(listQuoteRequestsQuerySchema.safeParse({ tab: "bin" }).success).toBe(false);
  });

  /**
   * The nav badge counts open work. It must agree with the first tab, or
   * the badge says 7 and the tab shows 5.
   */
  it("keeps the nav badge and the first tab in agreement", async () => {
    const { OPEN_QUOTE_STATUSES } = await import("@/lib/types/quote-request");
    expect([...OPEN_QUOTE_STATUSES].sort()).toEqual(
      [...QUOTE_GROUP_STATUSES.to_answer].sort() as QuoteRequestStatus[]
    );
  });
});
