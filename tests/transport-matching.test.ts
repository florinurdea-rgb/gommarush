import { describe, expect, it } from "vitest";
import {
  mappingToSave,
  matchDistributor,
  matchIsActionable,
  matchRecipient,
  type DistributorCandidate,
  type IncomingParty,
  type RecipientCandidate,
  type SavedCustomerRef,
} from "@/lib/transport/matching";

const ZUIN_ID = "d-zuin";
const EMMECI_ID = "c-emmeci";

const zuin: DistributorCandidate = { id: ZUIN_ID, name: "ZUIN S.p.A.", vatNumber: "02627710284" };
const carlini: DistributorCandidate = {
  id: "d-carlini",
  name: "CARLINI GOMME SRL",
  vatNumber: null,
  aliases: ["CARLINI PNEUMATICI"],
};

const emmeci: RecipientCandidate = {
  id: EMMECI_ID,
  name: "EMMECI GOMME di Nicetto Federico",
  vatNumber: "03824320240",
  taxCode: "NCTFRC90C06L840X",
  locations: [
    {
      id: "loc-quinto",
      locationName: "Sede",
      addressLine1: "STRADA CA' BALBI 1",
      city: "QUINTO VICENTINO",
      postalCode: "36050",
      province: "VI",
    },
  ],
};

function incoming(overrides: Partial<IncomingParty> = {}): IncomingParty {
  return {
    companyName: "EMMECI GOMME di Nicetto Federico",
    vatNumber: "03824320240",
    taxCode: "NCTFRC90C06L840X",
    customerCode: "034932",
    addressLine: "STRADA CA' BALBI 1",
    city: "QUINTO VICENTINO",
    postalCode: "36050",
    province: "VI",
    ...overrides,
  };
}

const savedZuinRef: SavedCustomerRef = {
  distributorId: ZUIN_ID,
  customerCode: "034932",
  customerId: EMMECI_ID,
  customerLocationId: "loc-quinto",
  distributorCustomerName: "EMMECI GOMME",
};

// ---------------------------------------------------------------------------
// Distributor
// ---------------------------------------------------------------------------

describe("matchDistributor", () => {
  it("matches Zuin automatically by VAT number", () => {
    const match = matchDistributor({
      incoming: { name: "ZUIN SPA", vatNumber: "02627710284" },
      candidates: [zuin, carlini],
    });

    expect(match.strength).toBe("IDENTIFIER");
    expect(match.rule).toBe("VAT_NUMBER");
    expect(match.party?.id).toBe(ZUIN_ID);
    expect(match.requiresConfirmation).toBe(false);
    expect(matchIsActionable(match)).toBe(true);
  });

  it("requires confirmation for a name-only match", () => {
    const match = matchDistributor({
      incoming: { name: "CARLINI GOMME SRL", vatNumber: null },
      candidates: [zuin, carlini],
    });

    expect(match.strength).toBe("EXACT_NAME_ADDRESS");
    expect(match.party?.id).toBe("d-carlini");
    expect(match.requiresConfirmation).toBe(true);
    expect(matchIsActionable(match)).toBe(false);
  });

  it("requires confirmation for an approved alias", () => {
    const match = matchDistributor({
      incoming: { name: "CARLINI PNEUMATICI", vatNumber: null },
      candidates: [zuin, carlini],
    });

    expect(match.rule).toBe("APPROVED_ALIAS");
    expect(match.requiresConfirmation).toBe(true);
  });

  it("ignores an invalid VAT number rather than matching on it", () => {
    const match = matchDistributor({
      incoming: { name: "SCONOSCIUTO", vatNumber: "02627710285" },
      candidates: [zuin],
    });

    expect(match.strength).toBe("NONE");
  });

  it("returns no match for an unknown distributor", () => {
    const match = matchDistributor({
      incoming: { name: "PNEUS NUOVI SRL", vatNumber: null },
      candidates: [zuin, carlini],
    });

    expect(match.strength).toBe("NONE");
    expect(match.party).toBeNull();
    expect(match.explanation).toContain("non presente in anagrafica");
  });
});

// ---------------------------------------------------------------------------
// Recipient
// ---------------------------------------------------------------------------

describe("matchRecipient - saved distributor mapping", () => {
  it("applies the Zuin 034932 -> EMMECI GOMME mapping automatically", () => {
    const match = matchRecipient({
      incoming: incoming(),
      distributorId: ZUIN_ID,
      candidates: [emmeci],
      savedRefs: [savedZuinRef],
    });

    expect(match.strength).toBe("IDENTIFIER");
    expect(match.rule).toBe("DISTRIBUTOR_CUSTOMER_CODE");
    expect(match.party?.id).toBe(EMMECI_ID);
    expect(match.party?.locationId).toBe("loc-quinto");
    expect(match.requiresConfirmation).toBe(false);
  });

  it("still exposes the matched party so the operator can see it", () => {
    // Automatic must not mean invisible.
    const match = matchRecipient({
      incoming: incoming(),
      distributorId: ZUIN_ID,
      candidates: [emmeci],
      savedRefs: [savedZuinRef],
    });

    expect(match.party?.name).toBe("EMMECI GOMME di Nicetto Federico");
    expect(match.party?.addressSummary).toContain("QUINTO VICENTINO");
    expect(match.explanation).toContain("034932");
  });

  it("does not apply another distributor's mapping for the same code", () => {
    const match = matchRecipient({
      incoming: incoming(),
      distributorId: "d-carlini",
      candidates: [emmeci],
      savedRefs: [savedZuinRef],
    });

    // Falls through to the VAT identifier, not the foreign mapping.
    expect(match.rule).toBe("VAT_NUMBER");
  });
});

describe("matchRecipient - identifiers", () => {
  it("matches by VAT number when no saved mapping exists", () => {
    const match = matchRecipient({
      incoming: incoming({ customerCode: null }),
      distributorId: ZUIN_ID,
      candidates: [emmeci],
      savedRefs: [],
    });

    expect(match.rule).toBe("VAT_NUMBER");
    expect(match.requiresConfirmation).toBe(false);
  });

  it("matches by codice fiscale when the VAT number is absent", () => {
    const match = matchRecipient({
      incoming: incoming({ customerCode: null, vatNumber: null }),
      distributorId: ZUIN_ID,
      candidates: [emmeci],
      savedRefs: [],
    });

    expect(match.rule).toBe("TAX_CODE");
    expect(match.requiresConfirmation).toBe(false);
  });

  it("refuses to match when two customers share a VAT number", () => {
    const twin: RecipientCandidate = { ...emmeci, id: "c-twin", name: "EMMECI GOMME SRL" };
    const match = matchRecipient({
      incoming: incoming({ customerCode: null }),
      distributorId: ZUIN_ID,
      candidates: [emmeci, twin],
      savedRefs: [],
    });

    expect(match.strength).toBe("NONE");
    expect(match.alternatives).toHaveLength(2);
    expect(match.explanation).toContain("Piu' clienti");
  });
});

describe("matchRecipient - resemblance requires confirmation", () => {
  it("requires confirmation when only name and address agree", () => {
    const match = matchRecipient({
      incoming: incoming({ customerCode: null, vatNumber: null, taxCode: null }),
      distributorId: ZUIN_ID,
      candidates: [emmeci],
      savedRefs: [],
    });

    expect(match.strength).toBe("EXACT_NAME_ADDRESS");
    expect(match.requiresConfirmation).toBe(true);
    expect(matchIsActionable(match)).toBe(false);
  });

  it("refuses to choose between two companies whose names differ only by legal form", () => {
    // companyNameKey strips legal suffixes, so "GOMME VICENZA SRL" and
    // "GOMME VICENZA SNC" normalise to the same key. That is the right
    // normalisation for matching, and it means the matcher sees two
    // candidates -- so it must hand the choice over rather than pick the one
    // whose suffix happens to match the document. These are different legal
    // entities, and delivering to the wrong one costs a van run.
    const srl: RecipientCandidate = {
      id: "c-srl",
      name: "GOMME VICENZA SRL",
      vatNumber: null,
      taxCode: null,
      locations: [],
    };
    const snc: RecipientCandidate = {
      id: "c-snc",
      name: "GOMME VICENZA SNC",
      vatNumber: null,
      taxCode: null,
      locations: [],
    };

    const match = matchRecipient({
      incoming: incoming({
        companyName: "GOMME VICENZA SRL",
        customerCode: null,
        vatNumber: null,
        taxCode: null,
      }),
      distributorId: ZUIN_ID,
      candidates: [srl, snc],
      savedRefs: [],
    });

    expect(match.strength).toBe("NONE");
    expect(match.party).toBeNull();
    expect(match.alternatives.map((party) => party.id).sort()).toEqual(["c-snc", "c-srl"]);
    expect(match.requiresConfirmation).toBe(true);
  });

  it("flags a customer found without a matching branch", () => {
    const multiSite: RecipientCandidate = {
      ...emmeci,
      vatNumber: null,
      taxCode: null,
      locations: [
        { id: "loc-a", locationName: "A", addressLine1: "VIA A 1", city: "PADOVA", postalCode: "35100", province: "PD" },
        { id: "loc-b", locationName: "B", addressLine1: "VIA B 2", city: "VERONA", postalCode: "37100", province: "VR" },
      ],
    };

    const match = matchRecipient({
      incoming: incoming({ customerCode: null, vatNumber: null, taxCode: null }),
      distributorId: ZUIN_ID,
      candidates: [multiSite],
      savedRefs: [],
    });

    expect(match.strength).toBe("SAVED_BRANCH");
    expect(match.party?.locationId).toBeNull();
    expect(match.requiresConfirmation).toBe(true);
    expect(match.explanation).toContain("selezionarla");
  });

  it("never returns a party for an unknown recipient", () => {
    const match = matchRecipient({
      incoming: incoming({
        companyName: "OFFICINA NUOVA SRL",
        customerCode: null,
        vatNumber: null,
        taxCode: null,
      }),
      distributorId: ZUIN_ID,
      candidates: [emmeci],
      savedRefs: [],
    });

    expect(match.strength).toBe("NONE");
    expect(match.party).toBeNull();
    // Creating a recipient is an explicit operator action, never a side
    // effect of extraction.
    expect(match.explanation).toContain("crearne uno nuovo");
  });
});

describe("mappingToSave", () => {
  it("builds the mapping to remember after an operator confirms", () => {
    const mapping = mappingToSave({
      distributorId: ZUIN_ID,
      customerCode: "034932",
      customerId: EMMECI_ID,
      customerLocationId: "loc-quinto",
      distributorCustomerName: "EMMECI GOMME",
    });

    expect(mapping).toEqual({
      distributorId: ZUIN_ID,
      customerCode: "034932",
      customerId: EMMECI_ID,
      customerLocationId: "loc-quinto",
      distributorCustomerName: "EMMECI GOMME",
    });
  });

  it("saves nothing without a distributor-specific code to key on", () => {
    expect(
      mappingToSave({
        distributorId: ZUIN_ID,
        customerCode: null,
        customerId: EMMECI_ID,
        customerLocationId: null,
        distributorCustomerName: null,
      })
    ).toBeNull();

    expect(
      mappingToSave({
        distributorId: null,
        customerCode: "034932",
        customerId: EMMECI_ID,
        customerLocationId: null,
        distributorCustomerName: null,
      })
    ).toBeNull();
  });
});
