import { describe, expect, it } from "vitest";
import { InterSprintGatewayClient } from "@/lib/suppliers/gateway/client";
import { describeGatewayConfig, resolveGatewayConfig } from "@/lib/suppliers/gateway/config";
import { GATEWAY_PARTNERS, PROTOCOLS, type GatewayPartner } from "@/lib/suppliers/gateway/protocols";
import { toStockRow } from "@/lib/suppliers/gateway/response";
import type { GatewayCallResult } from "@/lib/suppliers/gateway/client";

/**
 * A LIVE probe against the real Inter-Sprint / Inter-Tyre gateway.
 *
 * This is an operational diagnostic, not a unit test, and it is skipped
 * unless INTERSPRINT_LIVE_PROBE=1 — so `npm test` and CI are unaffected. It
 * lives under tests/ because vitest is the only TypeScript runner configured
 * in this repo, and the whole point is to exercise the REAL client
 * (src/lib/suppliers/gateway/client.ts) rather than a second implementation
 * that could pass while the real one is broken.
 *
 *   INTERSPRINT_LIVE_PROBE=1 npx vitest run tests/intersprint-live-probe.test.ts
 *
 * Reads, and only reads. Protocol 104 (order entry) is never called here, in
 * any form, including its test=1 validation mode: placing or validating an
 * order is not what a connectivity check is for, and the safest probe is one
 * that has no code path to an order at all.
 *
 * Environment:
 *   INTERSPRINT_LIVE_PROBE=1     required, or everything below skips
 *   INTERSPRINT_PROBE_PARTNER    'intersprint' (default) or 'intertyre'
 *   INTERSPRINT_PROBE_EAN        an EAN to look up via protocol 103
 *   INTERSPRINT_PROBE_ARTICLE    an article system number, as an alternative
 *
 * Credentials come from the same INTERSPRINT_GATEWAY_* variables the
 * application uses. Nothing here prints one.
 */

const ENABLED = process.env.INTERSPRINT_LIVE_PROBE === "1";

function probePartner(): GatewayPartner {
  const raw = (process.env.INTERSPRINT_PROBE_PARTNER ?? "intersprint").trim().toLowerCase();
  return (GATEWAY_PARTNERS as readonly string[]).includes(raw)
    ? (raw as GatewayPartner)
    : "intersprint";
}

/** Supplier data, truncated. Enough to confirm shape, not a full dump. */
function preview(raw: string, limit = 300): string {
  const flat = raw.replace(/\r?\n/g, " ⏎ ").replace(/\t/g, " → ");
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function report(label: string, result: GatewayCallResult): void {
  const { outcome } = result;
  const detail =
    outcome.status === "data"
      ? `${outcome.rows.length} row(s)${outcome.truncated ? " (truncated)" : ""}`
      : outcome.status === "error"
        ? `code ${outcome.code} — ${outcome.description}`
        : outcome.status === "malformed"
          ? `reason ${outcome.reason}`
          : outcome.status;

  console.log(
    [
      `  ${label}`,
      `    outcome     ${outcome.status} (${detail})`,
      `    http        ${result.httpStatus}`,
      `    duration    ${result.durationMs}ms, ${result.attempts} attempt(s)`,
      `    body        ${result.raw.length} bytes: ${preview(result.raw)}`,
    ].join("\n")
  );
}

/** Never throws. A probe that dies on the first failure diagnoses nothing. */
async function attempt(
  label: string,
  run: () => Promise<GatewayCallResult>
): Promise<GatewayCallResult | null> {
  try {
    const result = await run();
    report(label, result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const kind = (error as { kind?: string })?.kind ?? "unknown";
    console.log(`  ${label}\n    FAILED      [${kind}] ${message}`);
    return null;
  }
}

describe.skipIf(!ENABLED)("Inter-Sprint gateway live probe", () => {
  const partner = probePartner();

  it("reports configuration health without revealing it", () => {
    const configs = GATEWAY_PARTNERS.map((p) => describeGatewayConfig(p));
    console.log("\nConfiguration");
    for (const c of configs) {
      console.log(
        [
          `  ${c.partner}`,
          `    environment      ${c.environment}`,
          `    baseUrl          ${c.baseUrl}`,
          `    configured       ${c.configured}${c.missing.length ? ` (missing: ${c.missing.join(", ")})` : ""}`,
          `    customerNumber   ${c.customerNumberPresent ? "present" : "MISSING"}`,
          `    username         ${c.usernamePresent ? "present" : "MISSING"}`,
          `    password         ${c.passwordPresent ? "present" : "MISSING"}`,
          `    liveOrdering     ${c.liveOrderingEnabled}`,
          `    insecureTransport ${c.insecureTransport}`,
        ].join("\n")
      );
    }

    // A probe run against production by accident is worse than no probe.
    const target = configs.find((c) => c.partner === partner);
    expect(target, `no config report for ${partner}`).toBeDefined();
    expect(
      target!.configured,
      `${partner} is not configured — missing ${target!.missing.join(", ")}`
    ).toBe(true);
  });

  it("answers read-only protocols", async () => {
    const config = resolveGatewayConfig(partner);
    const client = new InterSprintGatewayClient(config, {
      // Audit records are the integration's own observability; surfacing them
      // here is how a probe shows that the audit trail works too.
      onAudit: (record) =>
        console.log(
          `    audit       protocol=${record.protocol} outcome=${record.outcome} ok=${record.ok} bytes=${record.responseBytes}`
        ),
    });

    console.log(`\nRead-only probes against ${config.baseUrl} (${config.environment})`);

    // Ordered least- to most-dependent on account setup. 117 and 116 take no
    // parameters at all, so a failure there is authentication or transport,
    // never a bad argument — which makes them the right first questions.
    const companyData = await attempt(`117 company data      ${PROTOCOLS.COMPANY_DATA.manualRef}`, () =>
      client.companyData()
    );
    await attempt(`116 delivery addresses ${PROTOCOLS.DELIVERY_ADDRESSES.manualRef}`, () =>
      client.deliveryAddresses()
    );
    await attempt(`15  error list        ${PROTOCOLS.ERROR_LIST.manualRef}`, () => client.errorList());
    await attempt(`115 delivery prices   ${PROTOCOLS.DELIVERY_PRICES.manualRef}`, () =>
      client.deliveryPrices()
    );

    // At least one zero-parameter read must come back, or there is nothing to
    // conclude about the integration beyond "it did not work".
    expect(
      companyData,
      "protocol 117 (company data) did not return — check credentials, egress and base URL"
    ).not.toBeNull();
  }, 120_000);

  it("looks up stock for a specific article, when one is supplied", async () => {
    const ean = (process.env.INTERSPRINT_PROBE_EAN ?? "").trim();
    const article = (process.env.INTERSPRINT_PROBE_ARTICLE ?? "").trim();

    if (!ean && !article) {
      // Protocol 103 is a LOOKUP: it needs an article identifier. Inventing
      // an EAN here would produce a meaningless "not found" and call it a
      // test, so the probe says what it needs instead.
      console.log(
        "\n103 stock search: skipped — set INTERSPRINT_PROBE_EAN or INTERSPRINT_PROBE_ARTICLE.\n" +
          "    Protocol 103 resolves an identifier you already hold; it does not enumerate\n" +
          "    a catalogue. See the note at the bottom of this file."
      );
      return;
    }

    const client = new InterSprintGatewayClient(resolveGatewayConfig(partner));
    console.log(`\n103 stock search ${PROTOCOLS.STOCK_SEARCH.manualRef}`);

    const result = ean
      ? await attempt(`    by EAN ${ean}`, () => client.stockByEan(ean))
      : await attempt(`    by article ${article}`, () => client.stockBySystemNumber(article));

    if (result?.outcome.status === "data") {
      for (const row of result.outcome.rows.slice(0, 5)) {
        const parsed = toStockRow(row);
        console.log(
          `      ${parsed.articleSystemNumber} | ${parsed.brand} | ${parsed.description} | ` +
            `${parsed.netPrice} ${parsed.currency} net | avail ${parsed.available} | ${row.length} fields`
        );
      }
    }
  }, 120_000);
});

/**
 * Why there is no "pull the catalogue" probe here.
 *
 * The gateway protocols this integration implements (see protocols.ts) are
 * all lookups or account/document reads. Protocol 103 is named "extended
 * stock search" and takes `artc=E=<ean>` or `artc=S=<system number>` — it
 * answers "what is the price and stock of this article", for an article you
 * already know. Nothing in the implemented set enumerates the article base.
 *
 * The bulk catalogue was designed to arrive by file instead: Inter-Sprint
 * pushes to the FTP endpoint in infra/ftp/, and infra/ftp/README.md records
 * that the importer for those files is deliberately absent, pending a known
 * file format. The adapter seam is src/lib/catalogue/ (isb-adapter.ts is the
 * worked example for ISB).
 *
 * If the Gateway Manual documents a bulk article protocol that simply was not
 * transcribed, adding it is a small change to protocols.ts plus a typed
 * method on the client. That needs the manual — the protocol code, its
 * parameters and its column order are not things to guess, because a wrong
 * guess here reads a supplier's response as data of the wrong shape.
 */
