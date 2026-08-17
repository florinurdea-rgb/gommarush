import { exec } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(exec);

/**
 * Windows printer adapter.
 *
 * It prints through the printer queue that is ALREADY installed and working on
 * this machine — nothing about the existing Toshiba setup has to be moved or
 * reconfigured. The queue name comes from PRINTER_NAME, never from code.
 *
 * The actual command is configurable because there is no single reliable
 * silent-PDF-print mechanism on Windows. The default targets SumatraPDF, which
 * is small, free, and the most dependable option for exactly this job.
 *
 * A print command that "succeeds" only means Windows accepted the job into the
 * spooler. Paper actually coming out cannot be confirmed from here — see the
 * README's known limitations.
 */
const DEFAULT_COMMAND =
  'SumatraPDF.exe -print-to "{{printer}}" -silent -print-settings "fit" "{{file}}"';

const COMMAND_TIMEOUT_MS = 60_000;

export function createWindowsPrinter({ printerName, printCommand }) {
  const template = printCommand || DEFAULT_COMMAND;

  return {
    name: "windows",

    async print({ pdf, job }) {
      const directory = await mkdtemp(join(tmpdir(), "gorush-label-"));
      const safeToken = String(job.label_data?.unit_token ?? job.id).replace(/[^A-Za-z0-9_-]/g, "");
      const file = join(directory, `${safeToken}.pdf`);

      try {
        await writeFile(file, pdf);

        const command = template
          .replaceAll("{{file}}", file)
          .replaceAll("{{printer}}", printerName);

        const { stdout, stderr } = await run(command, {
          timeout: COMMAND_TIMEOUT_MS,
          windowsHide: true,
        });

        return {
          ok: true,
          detail: [stdout?.trim(), stderr?.trim()].filter(Boolean).join(" | ") || "spooled",
        };
      } catch (error) {
        // Surfaced verbatim so the failure recorded on the job says something
        // actionable ("SumatraPDF.exe is not recognized…" is a real diagnosis).
        return {
          ok: false,
          detail: error?.stderr?.trim() || error?.message || "print command failed",
        };
      } finally {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}
