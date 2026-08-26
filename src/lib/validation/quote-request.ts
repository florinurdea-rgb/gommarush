import { z } from "zod";

/**
 * Server-side validation for the quote-request flow. The client validates
 * the same rules for immediate feedback, but this is the boundary that
 * actually matters — anything reaching the route handler is untrusted.
 *
 * The cross-field rules (a tyre needs dimensions, an 'other' needs a
 * description, a named-brand preference needs a brand) are enforced here
 * AND as CHECK constraints in the migration, so a bug in one layer cannot
 * quietly write a malformed row.
 */

const productTypeSchema = z.enum(["tyre", "other"]);
const preferenceTypeSchema = z.enum(["best_price", "specific_brand"]);
const deliverySpeedSchema = z.enum(["24h", "7d"]);
const seasonSchema = z.enum(["summer", "winter", "all_season"]);
const languageSchema = z.enum(["it", "en"]);

/** Trims, then turns an empty string into null — the DB stores null, not "". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullish()
    .transform((value) => value ?? null);

const quoteItemSchema = z
  .object({
    productType: productTypeSchema,
    description: optionalText(300),
    // Bounds match the migration's CHECK constraints exactly.
    width: z.number().int().min(100).max(500).nullish(),
    profile: z.number().int().min(20).max(100).nullish(),
    rim: z.number().int().min(10).max(30).nullish(),
    loadSpeedIndex: optionalText(20),
    season: seasonSchema.nullish(),
    quantity: z.number().int().min(1).max(1000),
    preferenceType: preferenceTypeSchema.nullish(),
    preferredBrand: optionalText(150),
    deliverySpeed: deliverySpeedSchema,
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.productType === "tyre") {
      for (const field of ["width", "profile", "rim"] as const) {
        if (item[field] == null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is required for a tyre`,
          });
        }
      }
    }

    if (item.productType === "other" && !item.description) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["description"],
        message: "description is required for a non-tyre product",
      });
    }

    if (item.preferenceType === "specific_brand" && !item.preferredBrand) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preferredBrand"],
        message: "preferredBrand is required when a specific brand is requested",
      });
    }
  });

/**
 * A loose international check: a leading +, then 7-15 digits once spaces,
 * dashes, dots and parentheses are stripped. Deliberately permissive — the
 * cost of rejecting a valid foreign number is a lost lead, while the cost of
 * accepting a slightly odd one is nil (nothing dials it automatically).
 */
const whatsappSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s().-]/g, ""))
  .refine((value) => value.length === 0 || /^\+?\d{7,15}$/.test(value), {
    message: "Invalid phone number",
  })
  .transform((value) => (value.length === 0 ? null : value))
  .nullish()
  .transform((value) => value ?? null);

export const createQuoteRequestSchema = z
  .object({
    companyName: z.string().trim().min(1).max(200),
    email: z.string().trim().toLowerCase().email().max(200),
    whatsapp: whatsappSchema,
    // Bounded well below the 40 KB body cap so one field cannot dominate it.
    notes: optionalText(2000),
    language: languageSchema.default("it"),
    items: z.array(quoteItemSchema).min(1).max(50),
    idempotencyKey: z.string().trim().min(1).max(100),
    // Honeypot: genuine users never see it. Optional so it can be omitted,
    // but must be empty when present.
    website: z.string().max(200).optional(),
  })
  .strict();

export type CreateQuoteRequestInput = z.infer<typeof createQuoteRequestSchema>;

export const updateQuoteStatusSchema = z
  .object({
    status: z.enum([
      "submitted",
      "reviewing",
      "quote_preparing",
      "quote_ready",
      "sent",
      "accepted",
      "rejected",
      "expired",
      "archived",
    ]),
  })
  .strict();

/**
 * Admin list query parameters. Everything is optional and everything is
 * bounded — this is a URL an admin can hand-edit, so `limit=1000000` must
 * clamp rather than attempt to load the table into memory.
 */
export const listQuoteRequestsQuerySchema = z
  .object({
    /** Which tab is open. Derived from status, never stored. */
    tab: z.enum(["to_answer", "offer_sent", "closed"]).nullish(),
    status: z.enum([
      "submitted",
      "reviewing",
      "quote_preparing",
      "quote_ready",
      "sent",
      "accepted",
      "rejected",
      "expired",
      "archived",
    ]).nullish(),
    notification: z.enum(["pending", "sending", "sent", "delivered", "failed"]).nullish(),
    delivery: z.enum(["24h", "7d"]).nullish(),
    /** Free text matched against reference, company and e-mail. */
    q: z.string().trim().max(120).nullish(),
    /** ISO dates (inclusive) bounding created_at. */
    from: z.string().trim().max(10).nullish(),
    to: z.string().trim().max(10).nullish(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    perPage: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .partial({ page: true, perPage: true });

/**
 * Normalises a validated item into the snake_case shape the RPC expects,
 * dropping any value that doesn't belong to its product type. This is what
 * stops a brand typed under "Marca specifica" from being submitted after the
 * user switched back to "Miglior prezzo".
 */
export function toRpcItem(item: z.infer<typeof quoteItemSchema>) {
  const isTyre = item.productType === "tyre";
  const usesBrand = item.preferenceType === "specific_brand";

  return {
    product_type: item.productType,
    description: isTyre ? null : item.description,
    width: isTyre ? item.width ?? null : null,
    profile: isTyre ? item.profile ?? null : null,
    rim: isTyre ? item.rim ?? null : null,
    load_speed_index: isTyre ? item.loadSpeedIndex : null,
    season: isTyre ? item.season ?? null : null,
    quantity: item.quantity,
    preference_type: item.preferenceType ?? null,
    preferred_brand: usesBrand ? item.preferredBrand : null,
    delivery_speed: item.deliverySpeed,
  };
}
