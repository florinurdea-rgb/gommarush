/**
 * Runtime configuration helpers.
 *
 * Safe to import from client components: nothing here reads a secret.
 */

/**
 * The public base URL of this deployment, used to build the permanent stand QR
 * targets and the unit QR fallback links.
 *
 * Resolution order matters: an explicit APP_BASE_URL wins, because the stand
 * stickers are PHYSICAL and must keep pointing at the right host even when
 * Vercel gives a deployment its own generated URL. VERCEL_URL is the fallback
 * for previews; localhost for development.
 */
export function appBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl.replace(/\/+$/, "")}`;

  return "http://localhost:3000";
}

/** Whether the seed script is allowed to run. Never true in production. */
export function isDevelopmentEnvironment(): boolean {
  return process.env.NODE_ENV !== "production";
}
