# GommaRush --- Pricing, PFU, VAT & Markup Specification

## Principle

Supplier integration returns supplier commercial data. It must NOT
calculate the final customer price.

Pricing is a separate GommaRush business layer.

## V1 calculation model

supplier purchase price net → apply GommaRush markup → tyre selling
price net → add PFU → taxable subtotal → VAT → customer gross total

Conceptually:

`tyre_sale_net = supplier_cost_net + markup_amount`

`taxable_subtotal = tyre_sale_net + pfu_amount`

`vat_amount = taxable_subtotal × vat_rate`

`customer_total = taxable_subtotal + vat_amount`

Rounding must use deterministic currency rules.

## Markup terminology

Use **markup** for the configurable percentage applied to supplier cost.

Example: supplier cost = €100 markup = 20% markup amount = €20 tyre
selling price net = €120

Do not label this as a 20% gross margin. A 20% markup on €100 produces a
€20 gross profit before other costs, which is a 16.67% gross margin on
€120 revenue.

## Configurable markup

Markup must NEVER be hard-coded in supplier adapters.

Create centrally managed pricing configuration.

V1 should support at least: - default markup percentage - optional
minimum profit/markup amount per tyre - VAT rate - optional
price-rounding rule

Initial default markup may be 20%, but this is configuration and can be
changed by an authorized admin without deployment.

Later architecture should permit: - supplier override - customer
override - brand/category override - quantity/tier rule - promotional
rule

Do not implement all advanced overrides unless approved; make the model
extensible.

## Price snapshots

Changing the global markup must affect NEW calculations only.

Once a quote/offer/order price is created, snapshot the commercial
inputs/rule used so historical prices do not mutate.

At minimum preserve: - supplier cost used - markup type/value - markup
amount - tyre sale net - PFU amount/status/source - VAT rate - VAT
amount - gross total - calculation timestamp/version

## Minimum profit

Architecture should permit an optional minimum euro profit per tyre.

Example: supplier cost €40 20% markup = €8 minimum markup amount = €10
effective markup amount = €10

The rule should be centrally configurable, not embedded in supplier
logic.

## PFU

PFU must be modeled separately from GommaRush commercial markup.

Do NOT apply GommaRush markup to PFU.

PFU should have provenance/confidence such as: - SUPPLIER_EXACT -
RULE_CALCULATED - MANUAL_CONFIRMED - TO_CONFIRM

Suggested fields: - pfu_amount - pfu_status - pfu_source -
pfu_rule/category reference if applicable - pfu_verified_at

If the exact applicable PFU cannot be determined reliably, do not invent
a definitive value. Represent it as `TO_CONFIRM` and handle customer
presentation accordingly.

The system must not assume one universal PFU amount for every tyre.

## VAT

VAT is a separate tax layer and must not be confused with markup.

For the current Italian business flow, the configured standard VAT rate
can initially be 22%, but it should live in controlled tax/pricing
configuration rather than duplicated across supplier integrations.

The implementation must preserve net/tax/gross values separately.

## Example

Supplier tyre cost net: €80.00 Markup: 20% = €16.00 Tyre sale net:
€96.00 PFU: €2.60 Taxable subtotal: €98.60 VAT 22%: €21.69 Customer
gross total: €120.29

Internal commercial profit from the tyre markup in this simplified
example is €16.00. PFU is not a profit component.

## Customer presentation

A B2B offer should be able to show a clear breakdown such as: - tyre
price - PFU - VAT - total

Exact presentation can differ by screen/document, but the underlying
components must remain separate and auditable.
