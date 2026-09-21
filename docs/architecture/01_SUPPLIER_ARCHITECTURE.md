# GommaRush --- Supplier Architecture

## Objective

Allow GommaRush to search one tyre and compare real sourcing options
from multiple suppliers without exposing supplier identities or costs to
customers.

## Canonical flow

Supplier source → Supplier adapter/manual observation → Catalogue
product identity → Supplier listing → Price/stock observation → Internal
sourcing → Pricing → Customer offer → Sales order → Sourcing allocation
→ Supplier purchase → Existing logistics order → Warehouse / driver /
delivery

## Important existing-system rule

The existing `orders` table represents supplier consignments /
transport-logistics jobs. It is NOT the customer sales-order entity.

Do not remove its supplier relationship and do not repurpose it into a
customer sales-order table.

A separate sales layer must exist above logistics.

## Product identity

A catalogue product is supplier-independent.

Prefer EAN as the strongest bridge when present, while retaining: -
supplier article code - brand - model/pattern - width - profile - rim -
load index - speed index - season - category - EU label information when
available - DOT information when relevant

A supplier listing is not itself a catalogue product.

## Normalized supplier offer / observation

Regardless of whether data came from API, FTP, spreadsheet or manual
search, GommaRush should be able to represent:

-   supplier
-   catalogue product / EAN where known
-   supplier article code
-   supplier purchase price
-   currency
-   stock quantity or stock status
-   stock confidence
-   expected lead time / delivery class
-   observed_at
-   price_verified_at
-   stock_verified_at
-   source type
-   PFU data when supplied
-   DOT when supplied
-   ordering capability/status

## Capabilities

Capabilities should be explicit rather than inferred: - catalogue feed -
price feed - stock feed - live stock lookup - live price lookup - test
ordering - production ordering - order status - delivery documents -
invoices

Absence of a capability means it is unavailable.

## Search strategy

Customer/internal search should normally search GommaRush's local
normalized catalogue/database.

Do NOT synchronously call every supplier for every search.

Bulk feeds populate searchable data. Live supplier APIs can selectively
validate freshness and should be used before automated purchasing where
available.

## Customer confidentiality

Public/customer APIs must never expose: - supplier identity - supplier
purchase price - supplier credentials - internal sourcing score -
private integration metadata

Customer-facing choices describe GommaRush service levels, not
suppliers.
