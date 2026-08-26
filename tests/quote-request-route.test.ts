import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The submission endpoint's ordering guarantee.
 *
 * These are the §5 and §6 rules expressed as tests: a mail failure must
 * still be a success for the customer, and only a persistence failure may
 * ever be reported as one.
 */

const createQuoteRequest = vi.fn();
const getQuoteRequest = vi.fn();
const logQuoteEvent = vi.fn();
const notifyQuoteRequest = vi.fn();
const isRateLimited = vi.fn((_key: string) => false);

vi.mock("@/lib/server/quote-requests", () => ({
  createQuoteRequest: (...args: unknown[]) => createQuoteRequest(...args),
  getQuoteRequest: (id: string, options?: unknown) => getQuoteRequest(id, options),
  logQuoteEvent: (...args: unknown[]) => logQuoteEvent(...args),
}));

vi.mock("@/lib/server/quote-request-notify", () => ({
  notifyQuoteRequest: (...args: unknown[]) => notifyQuoteRequest(...args),
}));

vi.mock("@/lib/rate-limit", () => ({
  isRateLimited: (key: string) => isRateLimited(key),
  getClientIp: () => "203.0.113.7",
}));

const VALID_BODY = {
  companyName: "Gomme Rossi SRL",
  email: "acquisti@gommerossi.it",
  language: "it",
  idempotencyKey: "key-1",
  items: [
    {
      productType: "tyre",
      width: 205,
      profile: 55,
      rim: 16,
      quantity: 4,
      preferenceType: "best_price",
      deliverySpeed: "48h",
    },
  ],
};

function request(body: unknown): Request {
  return new Request("https://gommarush.com/api/quote-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function post(body: unknown) {
  const { POST } = await import("../app/api/quote-requests/route");
  // The handler only uses .text() and .headers, both of which Request has.
  const response = await POST(request(body) as never);
  return { status: response.status, json: await response.json() };
}

describe("POST /api/quote-requests", () => {
  beforeEach(() => {
    vi.resetModules();
    createQuoteRequest.mockReset();
    getQuoteRequest.mockReset();
    notifyQuoteRequest.mockReset();
    logQuoteEvent.mockReset();
    isRateLimited.mockReturnValue(false);

    createQuoteRequest.mockResolvedValue({
      requestId: "11111111-1111-4111-8111-111111111111",
      reference: "GR-260825-0042",
      itemCount: 1,
      replayed: false,
    });
    notifyQuoteRequest.mockResolvedValue({ sent: true, error: null, attempts: 1 });
  });

  it("persists then notifies, and returns the customer reference", async () => {
    const { status, json } = await post(VALID_BODY);

    expect(status).toBe(201);
    expect(json).toMatchObject({ success: true, reference: "GR-260825-0042", emailSent: true });
    // Ordering: the request existed before the notification was attempted.
    expect(createQuoteRequest.mock.invocationCallOrder[0]).toBeLessThan(
      notifyQuoteRequest.mock.invocationCallOrder[0]
    );
  });

  /** §5: the single most important rule in this system. */
  it("still succeeds for the customer when the e-mail fails", async () => {
    notifyQuoteRequest.mockResolvedValue({ sent: false, error: "ECONNRESET", attempts: 2 });

    const { status, json } = await post(VALID_BODY);

    expect(status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.reference).toBe("GR-260825-0042");
    // Reported honestly, but it does not gate success.
    expect(json.emailSent).toBe(false);
  });

  /** §6: the only case the customer may be told it failed. */
  it("reports failure only when the request could not be persisted", async () => {
    createQuoteRequest.mockRejectedValue(new Error("connection refused"));

    const { status, json } = await post(VALID_BODY);

    expect(status).toBe(500);
    expect(json).toMatchObject({ success: false, error: "SAVE_FAILED" });
    // No mail is attempted for a request that does not exist.
    expect(notifyQuoteRequest).not.toHaveBeenCalled();
  });

  it("never leaks the underlying database error to the customer", async () => {
    createQuoteRequest.mockRejectedValue(
      new Error('relation "public.quote_requests" does not exist at character 42')
    );

    const { json } = await post(VALID_BODY);

    expect(JSON.stringify(json)).not.toContain("quote_requests");
    expect(JSON.stringify(json)).not.toContain("character 42");
  });

  it("a replayed submission returns the original request without creating a second", async () => {
    createQuoteRequest.mockResolvedValue({
      requestId: "11111111-1111-4111-8111-111111111111",
      reference: "GR-260825-0042",
      itemCount: 1,
      replayed: true,
    });
    getQuoteRequest.mockResolvedValue({
      request: { notification_status: "sent" },
      items: [],
    });

    const { status, json } = await post(VALID_BODY);

    expect(status).toBe(200);
    expect(json).toMatchObject({ success: true, reference: "GR-260825-0042", emailSent: true });
    expect(createQuoteRequest).toHaveBeenCalledTimes(1);
    // Already sent, so no second notification goes out.
    expect(notifyQuoteRequest).not.toHaveBeenCalled();
  });

  /**
   * The bug this replaces: the replay branch used to hardcode emailSent
   * true, so a customer resubmitting after a mail outage got a cheerful
   * success while sales was never told.
   */
  it("a replay whose notification never went out re-attempts it and reports the truth", async () => {
    createQuoteRequest.mockResolvedValue({
      requestId: "11111111-1111-4111-8111-111111111111",
      reference: "GR-260825-0042",
      itemCount: 1,
      replayed: true,
    });
    getQuoteRequest.mockResolvedValue({
      request: { notification_status: "failed" },
      items: [],
    });
    notifyQuoteRequest.mockResolvedValue({ sent: false, error: "still down", attempts: 3 });

    const { json } = await post(VALID_BODY);

    expect(notifyQuoteRequest).toHaveBeenCalledTimes(1);
    expect(json.emailSent).toBe(false);
    expect(json.success).toBe(true);
  });

  it("rejects an invalid payload with field paths and no stored row", async () => {
    const { status, json } = await post({ ...VALID_BODY, email: "not-an-email" });

    expect(status).toBe(400);
    expect(json).toMatchObject({ success: false, error: "VALIDATION_FAILED" });
    expect(json.fieldErrors).toContain("email");
    expect(createQuoteRequest).not.toHaveBeenCalled();
  });

  it("rejects a request with no items", async () => {
    const { status } = await post({ ...VALID_BODY, items: [] });
    expect(status).toBe(400);
    expect(createQuoteRequest).not.toHaveBeenCalled();
  });

  it("rejects an oversized payload before parsing it", async () => {
    const { status } = await post({ ...VALID_BODY, companyName: "x".repeat(50_000) });
    expect(status).toBe(413);
    expect(createQuoteRequest).not.toHaveBeenCalled();
  });

  it("rate-limits without persisting", async () => {
    isRateLimited.mockReturnValue(true);
    const { status, json } = await post(VALID_BODY);

    expect(status).toBe(429);
    expect(json).toMatchObject({ success: false, error: "RATE_LIMITED" });
    expect(createQuoteRequest).not.toHaveBeenCalled();
  });

  /** A bot filling the hidden field learns nothing and stores nothing. */
  it("silently absorbs a honeypot submission", async () => {
    const { status, json } = await post({ ...VALID_BODY, website: "http://spam.example" });

    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(createQuoteRequest).not.toHaveBeenCalled();
  });
});
