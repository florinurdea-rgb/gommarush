# GommaRush --- Current Supplier Rules

## Inter-Sprint

### Known integration model

-   Bulk passenger and truck catalogue feeds via FTP.
-   Feed contains EAN/product information.
-   PFU is not supplied in the feed according to supplier
    correspondence.
-   Gateway provides machine-to-machine functionality including stock
    lookup and ordering capabilities.
-   Protocol 103 has been identified for extended stock search.
-   Protocol 104 concerns ordering.

### GommaRush rule

FTP/local catalogue ingestion and live Gateway lookup are separate
capabilities.

Do not enable Protocol 104 production ordering yet.

### Commercial facts captured from correspondence

-   Advance-payment/deposit model was described.
-   Supplier indicated order release depends on sufficient paid balance.
-   Minimum release quantities communicated:
    -   passenger/PCR: 60 tyres
    -   truck: 10 tyres

These commercial rules should be represented as supplier
rules/capabilities, not scattered hard-coded checks.

------------------------------------------------------------------------

## Deldo / competitive 5--7 day supplier

### Known integration model

-   Stock/price files can be supplied and/or pushed to GommaRush via
    FTP.
-   Supplier supplied XML/API documentation for order communication.
-   Initial CSV samples were described by supplier as structural/test
    data and may contain fictional/non-current price, quantity and
    availability.
-   Supplier requested first XML payloads be generated for validation
    before test-environment ordering.
-   Production ordering comes only after successful testing and explicit
    approval.

### GommaRush rule

Build catalogue/feed ingestion first. Ordering remains
test-only/disabled until separately approved.

Never expose test catalogue values to customers as real
availability/pricing.

------------------------------------------------------------------------

## Italian \~48h supplier

### Current integration type

MANUAL.

### Operational flow

Customer request → GommaRush operator manually searches supplier →
operator records price/stock/product result → GommaRush pricing engine
calculates customer price → customer receives offer → if accepted,
operator rechecks supplier → operator purchases manually → normal
inbound/logistics flow

### Required recorded fields

Where available: - EAN - supplier article code - matched catalogue
product - purchase price - currency - stock/availability - expected
delivery - checked_at - operator/source note

Manual observations must expire/become stale just like automated
observations.

Later API/FTP automation should replace only the lookup/order mechanism,
not require redesign of the sales architecture.
