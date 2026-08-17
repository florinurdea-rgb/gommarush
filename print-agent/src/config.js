import { hostname } from "node:os";
import { config as loadEnv } from "dotenv";

loadEnv();

/**
 * Agent configuration, entirely from the environment.
 *
 * The printer queue name in particular is NEVER hardcoded: the warehouse
 * machine already has a working printer installed under some name, and this
 * agent adapts to it rather than requiring the setup to change.
 */

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`
    );
  }
  return value.trim();
}

function number(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig() {
  const adapter = (process.env.PRINTER_ADAPTER ?? "file").trim().toLowerCase();

  if (adapter !== "file" && adapter !== "windows") {
    throw new Error(`PRINTER_ADAPTER must be "file" or "windows", got "${adapter}"`);
  }

  // The printer name only matters when actually printing; test mode must run
  // on any machine, including this repo's CI.
  const printerName = (process.env.PRINTER_NAME ?? "").trim();
  if (adapter === "windows" && !printerName) {
    throw new Error("PRINTER_NAME is required when PRINTER_ADAPTER=windows");
  }

  return {
    supabaseUrl: required("SUPABASE_URL"),
    supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),

    adapter,
    printerName,
    printCommand: (process.env.PRINT_COMMAND ?? "").trim() || null,

    label: {
      widthMm: number("LABEL_WIDTH_MM", 100),
      heightMm: number("LABEL_HEIGHT_MM", 70),
      marginMm: number("LABEL_MARGIN_MM", 4),
    },

    pollIntervalMs: Math.max(500, number("POLL_INTERVAL_MS", 3000)),
    staleJobMinutes: Math.max(1, number("STALE_JOB_MINUTES", 5)),

    // Recorded in print_jobs.claimed_by so it's clear which machine took a job.
    agentId: (process.env.AGENT_ID ?? "").trim() || `agent-${hostname()}`,
    outputDir: (process.env.OUTPUT_DIR ?? "./output").trim(),
  };
}
