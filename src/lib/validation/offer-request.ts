import { z } from "zod";

const seasonSchema = z.enum(["summer", "winter", "all_season"]);
const deliveryPreferenceSchema = z.enum(["any", "24_hours", "48_hours", "7_days"]);

const requestedTyreSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    width: z.number().int().min(100).max(500),
    profile: z.number().int().min(20).max(100),
    rim: z.number().min(10).max(30),
    season: seasonSchema,
    quantity: z.number().int().min(1).max(100),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

export const createOfferRequestSchema = z
  .object({
    companyName: z.string().trim().max(150).optional(),
    contact: z.string().trim().min(1).max(200),
    deliveryPreference: deliveryPreferenceSchema,
    tyres: z.array(requestedTyreSchema).min(1).max(20),
    customerMessage: z.string().trim().max(1000).optional(),
    idempotencyKey: z.string().trim().min(1).max(100),
    // Honeypot: real users never see or fill this in. Optional so the
    // field can be omitted entirely, but must be empty when present.
    website: z.string().max(200).optional(),
  })
  .strict();

export type CreateOfferRequestInput = z.infer<typeof createOfferRequestSchema>;
