import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Test-mode printer adapter.
 *
 * Writes the rendered label to disk instead of sending it anywhere. This is
 * what makes the whole pipeline testable on a machine with no printer — CI, a
 * developer laptop, this repository's own tests — and it is the DEFAULT, so a
 * misconfigured agent quietly writes files rather than surprising a warehouse.
 */
export function createFilePrinter({ outputDir }) {
  return {
    name: "file",

    async print({ pdf, job }) {
      const directory = resolve(outputDir);
      await mkdir(directory, { recursive: true });

      const safeToken = String(job.label_data?.unit_token ?? job.id).replace(/[^A-Za-z0-9_-]/g, "");
      const path = join(directory, `${safeToken}.pdf`);
      await writeFile(path, pdf);

      return { ok: true, detail: `written to ${path}` };
    },
  };
}
