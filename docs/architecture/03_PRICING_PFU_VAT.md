# Pricing, PFU, VAT & Markup

**Status: PARTLY IMPLEMENTED (2026-09-22, branch
`claude/confident-albattani-p43rkj`).** The calculation, the markup
configuration, the PFU component and the customer/internal split now exist in
`src/lib/pricing/`; they are reachable only from the internal admin preview at
`/admin/catalogue/ricerca`. Price snapshots and the override model remain
PLANNED. What is NOT implemented is marked per section below.

> **The engine has no data to price.** All 9,559 supplier listing price rows
> have a NULL `purchase_price` and NULL stock (verified against production,
> 2026-09-22): the one catalogue import was specification-only. Every listing
> therefore resolves to `cost_unavailable`. This is a data gap, not a defect —
> the arithmetic below is tested and will apply the moment a price-bearing
> supplier file is imported.

## Principle

Supplier integration returns supplier commercial data. It must **not** calculate
the final customer price. Pricing is a separate GommaRush business layer.

## V1 calculation model

```
supplier purchase price net
  → apply GommaRush markup      → tyre selling price net
  → add PFU                     → taxable subtotal
  → apply VAT                   → customer gross total
```

```
tyre_sale_net    = supplier_cost_net + markup_amount
taxable_subtotal = tyre_sale_net + pfu_amount
vat_amount       = taxable_subtotal × vat_rate
customer_total   = taxable_subtotal + vat_amount
```

Rounding uses deterministic currency rules. Net, tax and gross values are always
preserved separately.

> **OWNER_DECISION — is PFU inside the VAT base?** The model above assumes yes.
> This is a tax position for the commercialista, not an engineering choice, and
> it changes every customer total. Must be settled before the first price
> snapshot is written, because snapshots are immutable.

> **OWNER_DECISION — rounding scope:** per unit or per line. Same reason.

## Markup terminology

Use **markup** for the configurable percentage applied to supplier cost.

> Supplier cost €100 · markup 20% · markup amount €20 · selling price net €120.

Do **not** call that a 20% gross margin. A 20% markup on €100 is a €20 gross
profit before other costs — a **16.67%** gross margin on €120 of revenue.
Conflating the two overstates profitability by a third.

## Configurable markup

**Markup must never be hard-coded, and never live in a supplier adapter.** It
belongs in central pricing configuration, changeable by an authorized admin
without a deployment.

V1 supports at least: default markup percentage · optional minimum profit per
tyre · VAT rate · optional rounding rule.

The model must be extensible to supplier, customer, brand/category, quantity
tier and promotional overrides — but **do not implement those until approved**.

> **OWNER_DECISION — the actual markup value. DECIDED for the preview:
> 20%.** Set by the owner on 2026-09-22 and held in
> `DEFAULT_PRICING_SETTINGS.markupPercent` with provenance `POLICY_OWNER`.
> It is configuration, not a figure compiled into a calculation, and it
> applies to every supplier lane at once. A different value for live selling
> remains an owner decision.

## Minimum profit

An optional minimum euro profit per tyre, centrally configured.

> Supplier cost €40 · 20% markup = €8 · minimum €10 → effective markup €10.

## PFU

PFU (*pneumatico fuori uso*) is modelled **separately** from commercial markup.

- **GommaRush markup is never applied to PFU.** It is a levy, not a product
  component, and not a profit component.
- The system must **not** assume one universal PFU amount for every tyre.
- PFU is **verified, versioned, effective-dated reference data** — never a
  timeless constant. A transaction records the tariff, version and source used
  at that moment, so historical orders stay explainable after tariffs change.
- A freshness/validity control must prevent silent use of an expired or
  unverified tariff.

Provenance/confidence: `SUPPLIER_EXACT` · `RULE_CALCULATED` · `MANUAL_CONFIRMED`
· `TO_CONFIRM`.

Fields: `pfu_amount`, `pfu_status`, `pfu_source`, tariff/category reference,
`pfu_verified_at`.

If the applicable PFU cannot be determined reliably, **do not invent a
definitive value.** Represent it as `TO_CONFIRM` and handle the customer
presentation accordingly.

> **BLOCKED — no verified tariff data exists.** No tariff table, values or
> effective dates are available to this project. Sourcing them is an
> OWNER_DECISION. **Do not populate tariffs from model knowledge.**

> **Known data gap:** 1,229 of 9,550 catalogue products (12.9%) have
> `weight_status = 'missing_or_zero'`. Any weight-based PFU rule is
> indeterminate for those products and must resolve to `TO_CONFIRM` rather than
> to a guess. Policy for them is an OWNER_DECISION.

## VAT

A separate tax layer, never confused with markup. The Italian standard rate is
configuration held in controlled tax/pricing settings, never duplicated across
supplier integrations.

**IMPLEMENTED.** `vatRatePercent` is 22 with provenance `STATUTORY` — the
Italian ordinary rate, recorded as configuration rather than inferred at a call
site. A rate whose provenance is `UNRESOLVED` produces no VAT at all rather
than a zero-rated total.

The engine will not produce a customer total today, because `pfuVatBase` is
`unresolved`: whether PFU sits inside the taxable base is the open accounting
question above, and both answers give different totals. Net selling price,
markup and gross profit are still reported, which is what B2B competitiveness
is judged on.

## Price snapshots

**Status: PLANNED — not implemented.** Nothing writes a price snapshot yet,
because nothing yet creates a quote or an order from a calculated price.

Changing the global markup affects **new** calculations only. Once a quote,
offer or order price is created, the commercial inputs are snapshotted so
historical prices never mutate.

Preserve at minimum: supplier cost used · markup type and value · markup amount
· tyre sale net · PFU amount, status and source · **PFU tariff version** · VAT
rate · VAT amount · gross total · calculation timestamp/version.

## Customer presentation

A B2B offer shows a clear breakdown — tyre price, PFU, VAT, total. Presentation
may differ per screen or document, but the underlying components stay separate
and auditable.

> The worked examples above use illustrative numbers to show the *arithmetic*.
> They are **not** tariff or rate references and must not be copied into code.
