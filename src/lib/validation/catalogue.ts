import { z } from "zod";

/**
 * Request shapes for the catalogue import routes.
 *
 * The file itself never travels through these: the browser uploads it
 * straight to Supabase Storage and the routes receive only a pointer, so a
 * multi-megabyte workbook never has to fit inside a serverless request body.
 */

export const analyzeCatalogueSchema = z.object({
  storagePath: z.string().min(1).max(400),
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().positive(),
  supplierId: z.string().uuid(),
  adapterId: z.string().min(1).max(40).default("isb"),
  // 'partial' is the default on purpose: only an explicit 'complete' may
  // propose deactivating listings the file omits, so the safe reading of a
  // missing or malformed value is the one that cannot remove anything.
  importMode: z.enum(["complete", "partial", "manual_correction"]).default("partial"),
});

export const commitCatalogueSchema = z.object({
  runId: z.string().uuid(),
  /** Bounded so one request cannot run past the function's time limit. */
  maxBatches: z.number().int().positive().max(20).default(6),
});

export const cancelCatalogueSchema = z.object({
  runId: z.string().uuid(),
});
