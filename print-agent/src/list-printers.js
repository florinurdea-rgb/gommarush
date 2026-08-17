import { exec } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(exec);

/**
 * Lists the exact Windows printer queue names, so PRINTER_NAME can be copied
 * verbatim. Getting this name subtly wrong (a double space, a missing suffix)
 * is the single most common cause of "nothing prints".
 */
async function main() {
  if (process.platform !== "win32") {
    console.log(
      "Not running on Windows.\n" +
        "On the warehouse PC, run:  npm run check-printers\n" +
        "or in PowerShell:  Get-Printer | Select-Object Name, DriverName, PortName"
    );
    return;
  }

  try {
    const { stdout } = await run(
      'powershell -NoProfile -Command "Get-Printer | Select-Object Name, DriverName, PortName | Format-Table -AutoSize"',
      { windowsHide: true }
    );
    console.log("\nInstalled printers (copy the Name EXACTLY into PRINTER_NAME):\n");
    console.log(stdout);
  } catch (error) {
    console.error("Could not list printers:", error?.message ?? error);
    console.error('Try manually:  powershell -Command "Get-Printer | Select-Object Name"');
  }
}

void main();
