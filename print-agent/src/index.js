import { loadConfig } from "./config.js";
import { createSupabase } from "./supabase.js";
import { createPrinter } from "./printers/index.js";
import { createJobLoop } from "./job-loop.js";

/**
 * GoRush Print Agent.
 *
 *   phone / web app -> Supabase print_jobs -> THIS AGENT -> Windows print queue
 *                                                        -> Toshiba printer
 *
 * The web app never talks to the printer. If this agent is offline, jobs stay
 * `pending` in Supabase and print as soon as it comes back — the web app is
 * entirely unaffected.
 */
async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(`\n[GoRush Print Agent] Configuration error:\n  ${error.message}\n`);
    process.exit(1);
  }

  const supabase = createSupabase(config);
  const printer = createPrinter(config);

  console.log(
    [
      "",
      "  GoRush Print Agent",
      "  ------------------",
      `  agent id  : ${config.agentId}`,
      `  adapter   : ${printer.name}${printer.name === "file" ? "  (TEST MODE — nothing is printed)" : ""}`,
      `  printer   : ${config.printerName || "(not set)"}`,
      `  label     : ${config.label.widthMm} x ${config.label.heightMm} mm`,
      `  poll      : every ${config.pollIntervalMs} ms`,
      "",
    ].join("\n")
  );

  // Fail fast on a bad key or an unreachable project, rather than logging one
  // error per poll forever.
  const { error } = await supabase.from("print_jobs").select("id").limit(1);
  if (error) {
    console.error(
      `\n[GoRush Print Agent] Cannot reach Supabase: ${error.message}\n` +
        "  Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env\n"
    );
    process.exit(1);
  }
  console.log("  Connected to Supabase. Waiting for print jobs…\n");

  const stop = createJobLoop({ supabase, printer, config }).start();

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      console.log("\n  Stopping…");
      stop();
      process.exit(0);
    });
  }
}

void main();
