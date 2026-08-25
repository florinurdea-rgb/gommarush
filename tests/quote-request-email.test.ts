import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuoteRequestDetail } from "@/lib/types/quote-request";

/**
 * The notification path.
 *
 * These exist because "the email didn't arrive" had no test coverage at all:
 * the module was only ever exercised in production, where its failures are
 * swallowed by design. Every assertion here is about a way the send can
 * silently not happen.
 */

const send = vi.fn();

vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

const MAIL_VARS = [
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "RESEND_FROM_EMAIL",
  "SALES_NOTIFICATION_EMAIL",
  "OFFER_NOTIFICATION_EMAIL",
  "NEXT_PUBLIC_APP_URL",
  "VERCEL_URL",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  send.mockReset();
  for (const key of MAIL_VARS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of MAIL_VARS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function detail(): QuoteRequestDetail {
  return {
    request: {
      id: "11111111-1111-4111-8111-111111111111",
      request_number: "GR-1000",
      company_name: "Gomme Rossi SRL",
      contact_email: "acquisti@gommerossi.it",
      whatsapp: null,
      language: "it",
      status: "new",
      notification_email_sent: false,
      notification_email_error: null,
      notification_email_sent_at: null,
      idempotency_key: "key-1",
      source: "web",
      created_at: "2026-08-25T09:00:00.000Z",
      updated_at: "2026-08-25T09:00:00.000Z",
    },
    items: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        quote_request_id: "11111111-1111-4111-8111-111111111111",
        product_type: "tyre",
        description: null,
        width: 205,
        profile: 55,
        rim: 16,
        load_speed_index: "91V",
        quantity: 4,
        preference_type: "best_price",
        preferred_brand: null,
        delivery_speed: "24h",
        sort_order: 0,
        created_at: "2026-08-25T09:00:00.000Z",
      },
    ],
  };
}

async function load() {
  return import("@/lib/email/send-quote-request");
}

describe("describeEmailConfig", () => {
  it("reports every missing variable when nothing is set", async () => {
    const { describeEmailConfig } = await load();
    const config = describeEmailConfig();

    expect(config.configured).toBe(false);
    expect(config.missing).toEqual([
      "RESEND_API_KEY",
      "RESEND_FROM_EMAIL",
      "OFFER_NOTIFICATION_EMAIL",
    ]);
  });

  it("resolves through the legacy variable names alone", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "GommaRush <offerte@gommarush.com>";
    process.env.OFFER_NOTIFICATION_EMAIL = "vendite@gommarush.com";

    const { describeEmailConfig } = await load();
    const config = describeEmailConfig();

    expect(config.configured).toBe(true);
    expect(config.fromVariable).toBe("RESEND_FROM_EMAIL");
    expect(config.toVariable).toBe("OFFER_NOTIFICATION_EMAIL");
  });

  it("prefers the newer override names when both are present", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "old@gommarush.com";
    process.env.EMAIL_FROM = "new@gommarush.com";
    process.env.OFFER_NOTIFICATION_EMAIL = "old-sales@gommarush.com";
    process.env.SALES_NOTIFICATION_EMAIL = "vendite@gommarush.com";

    const { describeEmailConfig } = await load();
    const config = describeEmailConfig();

    expect(config.from).toBe("new@gommarush.com");
    expect(config.to).toBe("vendite@gommarush.com");
  });

  /** A value pasted into a dashboard with a stray newline is a real outage. */
  it("trims surrounding whitespace and treats a blank value as unset", async () => {
    process.env.RESEND_API_KEY = "  re_test_key\n";
    process.env.RESEND_FROM_EMAIL = "   ";
    process.env.OFFER_NOTIFICATION_EMAIL = "vendite@gommarush.com";

    const { describeEmailConfig } = await load();
    const config = describeEmailConfig();

    expect(config.apiKeyPresent).toBe(true);
    expect(config.apiKeyLooksValid).toBe(true);
    expect(config.missing).toEqual(["RESEND_FROM_EMAIL"]);
  });

  it("flags a key that is set but is not shaped like a Resend key", async () => {
    process.env.RESEND_API_KEY = "sk-an-openai-key";
    process.env.RESEND_FROM_EMAIL = "offerte@gommarush.com";
    process.env.OFFER_NOTIFICATION_EMAIL = "vendite@gommarush.com";

    const { describeEmailConfig } = await load();
    const config = describeEmailConfig();

    expect(config.configured).toBe(true);
    expect(config.apiKeyLooksValid).toBe(false);
  });

  it("never returns the key itself", async () => {
    process.env.RESEND_API_KEY = "re_super_secret_value";
    process.env.RESEND_FROM_EMAIL = "offerte@gommarush.com";
    process.env.OFFER_NOTIFICATION_EMAIL = "vendite@gommarush.com";

    const { describeEmailConfig } = await load();
    expect(JSON.stringify(describeEmailConfig())).not.toContain("super_secret");
  });
});

describe("sendQuoteRequestEmail", () => {
  it("names the missing variables instead of a bare not-configured code", async () => {
    const { sendQuoteRequestEmail } = await load();
    const result = await sendQuoteRequestEmail(detail());

    expect(result.success).toBe(false);
    expect(result.success === false && result.error).toContain("RESEND_API_KEY");
    expect(send).not.toHaveBeenCalled();
  });

  it("sends with the configured sender, recipient and a reply-to of the customer", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "GommaRush <offerte@gommarush.com>";
    process.env.OFFER_NOTIFICATION_EMAIL = "vendite@gommarush.com";
    process.env.NEXT_PUBLIC_APP_URL = "https://gommarush.com/";
    send.mockResolvedValue({ data: { id: "msg_1" }, error: null });

    const { sendQuoteRequestEmail } = await load();
    const result = await sendQuoteRequestEmail(detail());

    expect(result).toEqual({ success: true, messageId: "msg_1" });
    expect(send).toHaveBeenCalledTimes(1);

    const payload = send.mock.calls[0][0];
    expect(payload.from).toBe("GommaRush <offerte@gommarush.com>");
    expect(payload.to).toBe("vendite@gommarush.com");
    // camelCase — the field name changed in resend v4, and getting it wrong
    // silently drops the reply-to rather than erroring.
    expect(payload.replyTo).toBe("acquisti@gommerossi.it");
    expect(payload.subject).toContain("GR-1000");
    expect(payload.subject).toContain("Gomme Rossi SRL");
    expect(payload.html).toContain("205/55 R16");
    expect(payload.text).toContain("205/55 R16");
    // Trailing slash stripped, so the CTA is not .com//admin/...
    expect(payload.html).toContain("https://gommarush.com/admin/richieste-offerta/");
  });

  it("returns Resend's own error name and message rather than throwing", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "offerte@gommarush.com";
    process.env.OFFER_NOTIFICATION_EMAIL = "vendite@gommarush.com";
    send.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "The gommarush.com domain is not verified." },
    });

    const { sendQuoteRequestEmail } = await load();
    const result = await sendQuoteRequestEmail(detail());

    expect(result.success).toBe(false);
    expect(result.success === false && result.error).toBe(
      "validation_error: The gommarush.com domain is not verified."
    );
  });

  it("captures a thrown transport error instead of propagating it", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "offerte@gommarush.com";
    process.env.OFFER_NOTIFICATION_EMAIL = "vendite@gommarush.com";
    send.mockRejectedValue(new Error("ECONNRESET"));

    const { sendQuoteRequestEmail } = await load();
    const result = await sendQuoteRequestEmail(detail());

    expect(result).toEqual({ success: false, error: "ECONNRESET" });
  });
});
