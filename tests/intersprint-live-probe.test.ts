import { describe, expect, it } from "vitest";
import { InterSprintGatewayClient } from "@/lib/suppliers/gateway/client";
import { describeGatewayConfig, resolveGatewayConfig } from "@/lib/suppliers/gateway/config";
import { GATEWAY_PARTNERS, PROTOCOLS, type GatewayPartner } from "@/lib/suppliers/gateway/protocols";
import { toStockRow } from "@/lib/suppliers/gateway/response";
import {
  CATALOGUE_PROBE_SET,
  sizeMatchesDescription,
} from "./intersprint-catalogue-fixtures";
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
 *   INTERSPRINT_PROBE_EAN        optional. One EAN, or a comma-separated
 *                                list, replacing the five-product proof set
 *                                in tests/intersprint-catalogue-fixtures.ts
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

  it("resolves real catalogue EANs to live price and stock", async () => {
    // The proof set is the five real catalogue_products rows in
    // tests/intersprint-catalogue-fixtures.ts. An override is accepted so a
    // single EAN can be chased down without editing the fixture.
    const override = (process.env.INTERSPRINT_PROBE_EAN ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    const products = override.length
      ? override.map((ean) => {
          const known = CATALOGUE_PROBE_SET.find((candidate) => candidate.ean === ean);
          return (
            known ?? {
              ean,
              brand: "(not in the fixture set)",
              model: "?",
              sizeDisplay: "?",
              loadSpeed: "?",
              // No expected dimensions, so identity cannot be checked.
              widthMm: -1,
              aspectRatio: -1,
              rimInch: -1,
              runFlat: false,
              xl: false,
              supplierArticleId: "?",
            }
          );
        })
      : CATALOGUE_PROBE_SET;

    const client = new InterSprintGatewayClient(resolveGatewayConfig(partner));
    console.log(`\n103 stock search ${PROTOCOLS.STOCK_SEARCH.manualRef} — ${products.length} catalogue product(s)`);

    let answered = 0;

    for (const product of products) {
      console.log(
        `\n  ${product.brand} ${product.model} ${product.sizeDisplay} ${product.loadSpeed}` +
          `${product.runFlat ? " run-flat" : ""}${product.xl ? " XL" : ""}  EAN ${product.ean}`
      );

      const result = await attempt(`    artc=E=${product.ean}`, () => client.stockByEan(product.ean));
      if (!result) continue;
      answered++;

      const { outcome } = result;

      // The parser only reports "data" when *END* was present, so reaching
      // this branch IS the end-marker check. Stated explicitly because it is
      // one of the things the proof has to demonstrate.
      if (outcome.status === "data") {
        console.log(`    end marker  present (parser requires *END* before classifying as data)`);
        for (const row of outcome.rows) {
          const parsed = toStockRow(row);
          const sizeOk = sizeMatchesDescription(product, parsed.description);
          console.log(
            `    row         sys=${parsed.articleSystemNumber} code=${parsed.articleCode} ` +
              `brand=${parsed.brand} fields=${row.length}\n` +
              `                desc="${parsed.description}"\n` +
              `                net=${parsed.netPrice} ${parsed.currency}  gross=${parsed.grossPrice}  ` +
              `available=${parsed.available}\n` +
              `                size match: ${sizeOk === null ? "undetermined (empty description)" : sizeOk ? "YES" : "NO — WRONG ARTICLE"}`
          );
        }
      } else if (outcome.status === "error") {
        // A supplier that does not carry an article is a normal commercial
        // answer, not a broken integration. Which code means that is not
        // something to assume: 54 ("invalid item code") is the candidate, and
        // the real response is what settles it.
        console.log(
          `    supplier    code ${outcome.code} — ${outcome.description}\n` +
            `                treat as a commercial outcome (not carried / not found), not a failure`
        );
      } else if (outcome.status === "malformed") {
        console.log(`    MALFORMED   ${outcome.reason} — this IS an integration problem`);
      }
    }

    // The assertion is about the transport, not about Inter-Sprint's range.
    // Every EAN coming back "not carried" still proves Protocol 103 works.
    expect(
      answered,
      "no EAN produced any response at all — transport, credentials or egress"
    ).toBeGreaterThan(0);
  }, 300_000);
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
