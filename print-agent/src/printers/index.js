import { createFilePrinter } from "./file-printer.js";
import { createWindowsPrinter } from "./windows-printer.js";

/**
 * Printer adapter factory.
 *
 * The abstraction exists so the agent's job loop knows nothing about Windows,
 * SumatraPDF, or files — which is also what makes the loop testable with a mock
 * adapter (see test/print-loop.test.js in the web app's suite).
 */
export function createPrinter(config) {
  if (config.adapter === "windows") {
    return createWindowsPrinter({
      printerName: config.printerName,
      printCommand: config.printCommand,
    });
  }
  return createFilePrinter({ outputDir: config.outputDir });
}
