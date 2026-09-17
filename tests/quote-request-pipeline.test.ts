import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { mapResendEventType, verifyResendWebhook } from "@/lib/email/verify-webhook";
import { sanitizeCellText } from "@/lib/excel/sanitize";
import { safeFileName } from "@/lib/excel/file-name";
import { listQuoteRequestsQuerySchema } from "@/lib/validation/quote-request";

/**
 * The pipeline's failure modes.
 *
 * Every test here corresponds to a way the system can lose a request, leak
 * something, or lie about what happened — not to a happy path that the type
 * checker already guarantees.
 */

// ---------------------------------------------------------------------------
// Notification behaviour: DB succeeds, mail fails
// ---------------------------------------------------------------------------

const sendEmail = vi.fn();
const getRequest = vi.fn();
const record = vi.fn();
const logQuote = vi.fn();

vi.mock("@/lib/email/send-quote-request", () => ({
  sendQuoteRequestEmail: (...args: unknown[]) => sendEmail(...args),
}));

vi.mock("@/lib/server/quote-requests", () => ({
  getQuoteRequest: (...args: unknown[]) => getRequest(...args),
  recordNotificationOutcome: (...args: unknown[]) => record(...args),
  logQuoteEvent: (...args: unknown[]) => logQuote(...args),
}));

function fakeDetail(overrides: Record<string, unknown> = {}) {
  return {
    request: {
      id: "11111111-1111-4111-8111-111111111111",
      public_reference: "GR-260825-0007",
      company_name: "Gomme Rossi SRL",
      contact_email: "acquisti@gommerossi.it",
      notification_attempts: 0,
      last_notification_error: null,
      ...overrides,
    },
    items: [],
  };
}

describe("notifyQuoteRequest", () => {
  beforeEach(() => {
    sendEmail.mockReset();
    getRequest.mockReset();
    record.mockReset();
    logQuote.mockReset();
    record.mockResolvedValue({ attempts: 1 });
  });

  it("never throws when the mail provider fails — the request stays saved", async () => {
    getRequest.mockResolvedValue(fakeDetail());
    sendEmail.mockResolvedValue({ success: false, error: "ECONNRESET" });

    const { notifyQuoteRequest } = await import("@/lib/server/quote-request-notify");
    const result = await notifyQuoteRequest("11111111-1111-4111-8111-111111111111");

    expect(result.sent).toBe(false);
    expect(result.error).toBe("ECONNRESET");
    // The failure is persisted, which is what the admin screen renders.
    expect(record).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({ status: "failed", error: "ECONNRESET" })
    );
  });

  it("retries a transient failure once, then gives up — bounded, not a loop", async () => {
    getRequest.mockResolvedValue(fakeDetail());
    sendEmail.mockResolvedValue({ success: false, error: "ECONNRESET" });

    const { notifyQuoteRequest } = await import("@/lib/server/quote-request-notify");
    await notifyQuoteRequest("11111111-1111-4111-8111-111111111111");

    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("does not retry a misconfiguration — retrying cannot change the outcome", async () => {
    getRequest.mockResolvedValue(fakeDetail());
    sendEmail.mockResolvedValue({
      success: false,
      error: "validation_error: The gommarush.com domain is not verified.",
    });

    const { notifyQuoteRequest } = await import("@/lib/server/quote-request-notify");
    await notifyQuoteRequest("11111111-1111-4111-8111-111111111111");

    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("stops attempting automatically once the ceiling is reached", async () => {
    getRequest.mockResolvedValue(fakeDetail({ notification_attempts: 6 }));

    const { notifyQuoteRequest } = await import("@/lib/server/quote-request-notify");
    const result = await notifyQuoteRequest("11111111-1111-4111-8111-111111111111");

    expect(result.throttled).toBe(true);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("an explicit admin retry still proceeds past the automatic ceiling", async () => {
    getRequest.mockResolvedValue(fakeDetail({ notification_attempts: 20 }));
    sendEmail.mockResolvedValue({ success: true, messageId: "msg_9" });

    const { notifyQuoteRequest } = await import("@/lib/server/quote-request-notify");
    const result = await notifyQuoteRequest("11111111-1111-4111-8111-111111111111", {
      manual: true,
      actor: "florin@example.com",
    });

    expect(result.sent).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  /**
   * The retry path must only ever touch notification columns. If it could
   * reach a create call, an admin pressing "retry" twice would duplicate the
   * customer's request.
   */
  it("a retry never creates a request — it only records against the existing id", async () => {
    getRequest.mockResolvedValue(fakeDetail());
    sendEmail.mockResolvedValue({ success: true, messageId: "msg_1" });

    const module = await import("@/lib/server/quote-request-notify");
    await module.notifyQuoteRequest("11111111-1111-4111-8111-111111111111", { manual: true });
    await module.notifyQuoteRequest("11111111-1111-4111-8111-111111111111", { manual: true });

    // Every write is scoped to the id we were given, twice over.
    for (const call of record.mock.calls) {
      expect(call[0]).toBe("11111111-1111-4111-8111-111111111111");
    }
    // And the module genuinely has no way to create one: the source imports
    // only the notification-side helpers.
    const source = await readFile(
      new URL("../src/lib/server/quote-request-notify.ts", import.meta.url),
      "utf8"
    );
    expect(source).not.toContain("createQuoteRequest");
  });

  it("reports a missing row instead of throwing", async () => {
    getRequest.mockResolvedValue(null);

    const { notifyQuoteRequest } = await import("@/lib/server/quote-request-notify");
    const result = await notifyQuoteRequest("11111111-1111-4111-8111-111111111111");

    expect(result).toMatchObject({ sent: false, error: "REQUEST_NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------
// Webhook authenticity and idempotency
// ---------------------------------------------------------------------------

describe("verifyResendWebhook", () => {
  const secret = "whsec_dGVzdC1zZWNyZXQtdmFsdWUtZm9yLXNpZ25pbmc=";
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "msg_1" } });
  const id = "msg_2VeaGSpEbwCLpMNTMOTBHQ";
  const now = 1_800_000_000;

  function sign(rawBody: string, timestamp: number): string {
    const key = Buffer.from(secret.slice(6), "base64");
    return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64")}`;
  }

  it("accepts a correctly signed request", () => {
    const result = verifyResendWebhook({
      rawBody: body,
      secret,
      headers: { id, timestamp: String(now), signature: sign(body, now) },
      nowSeconds: now,
    });
    expect(result).toEqual({ valid: true, eventId: id });
  });

  it("rejects a tampered body", () => {
    const result = verifyResendWebhook({
      rawBody: body.replace("delivered", "bounced"),
      secret,
      headers: { id, timestamp: String(now), signature: sign(body, now) },
      nowSeconds: now,
    });
    expect(result).toMatchObject({ valid: false, reason: "SIGNATURE_MISMATCH" });
  });

  it("rejects an unsigned request", () => {
    const result = verifyResendWebhook({
      rawBody: body,
      secret,
      headers: { id, timestamp: String(now), signature: null },
      nowSeconds: now,
    });
    expect(result).toMatchObject({ valid: false, reason: "MISSING_SIGNATURE_HEADERS" });
  });

  /** A captured-and-replayed request must not stay valid indefinitely. */
  it("rejects a signature that is outside the timestamp tolerance", () => {
    const old = now - 3600;
    const result = verifyResendWebhook({
      rawBody: body,
      secret,
      headers: { id, timestamp: String(old), signature: sign(body, old) },
      nowSeconds: now,
    });
    expect(result).toMatchObject({ valid: false, reason: "TIMESTAMP_OUT_OF_TOLERANCE" });
  });

  it("refuses to validate anything when no secret is configured", () => {
    const result = verifyResendWebhook({
      rawBody: body,
      secret: undefined,
      headers: { id, timestamp: String(now), signature: sign(body, now) },
      nowSeconds: now,
    });
    expect(result).toMatchObject({ valid: false, reason: "WEBHOOK_SECRET_NOT_CONFIGURED" });
  });

  it("accepts any one of several signatures during a secret rotation", () => {
    const rotated = `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${sign(body, now)}`;
    const result = verifyResendWebhook({
      rawBody: body,
      secret,
      headers: { id, timestamp: String(now), signature: rotated },
      nowSeconds: now,
    });
    expect(result).toMatchObject({ valid: true });
  });
});

describe("mapResendEventType", () => {
  /** The whole point of the webhook: accepted is not delivered. */
  it("keeps 'sent' and 'delivered' distinct", () => {
    expect(mapResendEventType("email.sent")).toEqual({ status: "sent" });
    expect(mapResendEventType("email.delivered")).toEqual({ status: "delivered" });
  });

  it("treats a bounce and a complaint as failures", () => {
    expect(mapResendEventType("email.bounced")?.status).toBe("failed");
    expect(mapResendEventType("email.complained")?.status).toBe("failed");
  });

  it("ignores event types it does not model rather than guessing", () => {
    expect(mapResendEventType("email.delivery_delayed")).toBeNull();
    expect(mapResendEventType("something.new")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Excel safety
// ---------------------------------------------------------------------------

describe("sanitizeCellText", () => {
  it("neutralises every formula-triggering prefix", () => {
    for (const payload of [
      '=HYPERLINK("http://evil","click")',
      "+1+1",
      "-1+1",
      "@SUM(A1)",
      "\tSUM(A1)",
    ]) {
      expect(sanitizeCellText(payload).startsWith("'")).toBe(true);
    }
  });

  it("leaves ordinary text — including company names — untouched", () => {
    for (const value of ["Gomme Rossi SRL", "205/55 R16", "Città d'Arte", "", "Michelin"]) {
      expect(sanitizeCellText(value)).toBe(value);
    }
  });
});

describe("safeFileName", () => {
  it("includes the reference and folds accents", () => {
    const name = safeFileName("Città Gomme S.r.l.", "2026-08-25T09:00:00.000Z", "GR-260825-0042");
    expect(name).toBe("Offerta_Citta_Gomme_S_r_l_2026-08-25_GR-260825-0042.xlsx");
  });

  it("strips anything that could break a Content-Disposition header", () => {
    const name = safeFileName('Ev"il', "2026-08-25T09:00:00.000Z", 'GR-1"; rm -rf /');
    expect(name).not.toContain('"');
    expect(name).not.toContain(";");
  });

  it("still produces a usable name with no reference", () => {
    expect(safeFileName("Gomme Rossi", "2026-08-25T00:00:00.000Z")).toBe(
      "Offerta_Gomme_Rossi_2026-08-25.xlsx"
    );
  });
});

// ---------------------------------------------------------------------------
// Admin list query parsing — a hand-editable URL
// ---------------------------------------------------------------------------

describe("listQuoteRequestsQuerySchema", () => {
  it("clamps an absurd page size rather than attempting it", () => {
    const result = listQuoteRequestsQuerySchema.safeParse({ perPage: "1000000" });
    expect(result.success).toBe(false);
  });

  it("coerces numeric strings from the query string", () => {
    const result = listQuoteRequestsQuerySchema.safeParse({ page: "3", perPage: "50" });
    expect(result.success && result.data.page).toBe(3);
    expect(result.success && result.data.perPage).toBe(50);
  });

  it("rejects a status that is not in the lifecycle", () => {
    expect(listQuoteRequestsQuerySchema.safeParse({ status: "new" }).success).toBe(false);
    expect(listQuoteRequestsQuerySchema.safeParse({ status: "reviewing" }).success).toBe(true);
  });

  it("bounds the search term", () => {
    expect(listQuoteRequestsQuerySchema.safeParse({ q: "x".repeat(500) }).success).toBe(false);
  });
});

afterEach(() => {
  vi.resetModules();
});
