import { describe, expect, it } from "vitest";
import { classifyProbeError, decideNextAction } from "@/lib/server/quote-schema-check";

/**
 * The installation check has to be right precisely when nothing else works,
 * so its two pieces of judgement are tested directly: is this error "the
 * object is missing" or "something else went wrong", and which migration
 * does that imply.
 */

describe("classifyProbeError", () => {
  it("treats no error as present", () => {
    expect(classifyProbeError(null)).toBe("ok");
  });

  /** The codes Postgres and PostgREST actually return for a missing object. */
  it.each([
    ["42P01", "undefined_table"],
    ["42703", "undefined_column"],
    ["42883", "undefined_function"],
    ["PGRST202", "function not found in schema cache"],
    ["PGRST205", "table not found in schema cache"],
  ])("classifies %s as missing", (code, message) => {
    expect(classifyProbeError({ code, message })).toBe("missing");
  });

  /** PostgREST does not always populate `code`; the message must still work. */
  it("falls back to the message when no code is present", () => {
    expect(
      classifyProbeError({
        message: `Could not find the table 'public.quote_requests' in the schema cache`,
      })
    ).toBe("missing");
    expect(
      classifyProbeError({ message: 'relation "public.quote_requests" does not exist' })
    ).toBe("missing");
  });

  /**
   * A permission or network failure is NOT a missing table. Reporting it as
   * one would send someone to re-run a migration that is already applied.
   */
  it("does not mistake other failures for a missing object", () => {
    expect(classifyProbeError({ code: "42501", message: "permission denied" })).toBe("error");
    expect(classifyProbeError({ message: "fetch failed" })).toBe("error");
    expect(classifyProbeError({ code: "PGRST301", message: "JWT expired" })).toBe("error");
  });
});

describe("decideNextAction", () => {
  it("sends you to both files when the base tables are absent", () => {
    const action = decideNextAction(new Set(["table_requests", "table_items", "rpc_create"]));
    expect(action).toContain("20260826000000");
    expect(action).toContain("20260827000000");
  });

  it("sends you to the second file only when the first is already applied", () => {
    const action = decideNextAction(new Set(["column_reference", "table_events"]));
    expect(action).toContain("20260827000000");
    expect(action).not.toContain("20260826000000");
  });

  it("asks for nothing when everything is present", () => {
    expect(decideNextAction(new Set())).toBeNull();
  });
});
