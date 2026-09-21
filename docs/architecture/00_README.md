# GommaRush --- Supplier, Pricing & Sourcing Architecture Package

## Purpose

This package is the specification Claude should use before implementing
the next supplier phase.

The immediate business priority is supplier integration and a reliable
internal tyre search. Automated purchasing is NOT the immediate
priority.

## Current supplier lanes

1.  **Inter-Sprint** --- automated catalogue/feed plus Gateway
    capabilities. Ordering exists in supplier documentation but must
    remain disabled until explicitly approved.
2.  **Deldo / competitive \~5--7 day supplier** --- FTP stock/price feed
    plus XML/API ordering documentation. Test data must never be treated
    as live commercial data. Production ordering remains disabled.
3.  **Italian \~48h supplier** --- manual for now. GommaRush staff
    manually search the supplier, record a price/stock observation, and
    answer the customer. It must still use the same normalized
    supplier-offer model.

## Key architectural principle

Source technology must not dictate the GommaRush business model.

API, FTP, CSV/XLSX and manual observations must all normalize into the
same supplier/product/offer model.

Read all files in this package before proposing implementation.
