# GommaRush --- Implementation Priorities

## Immediate product milestone

An internal GommaRush operator searches one tyre and sees trustworthy
sourcing options from the available supplier lanes in one place.

For each option, the system should ultimately know: - exact product
match - supplier internally - purchase price - stock/availability -
delivery estimate/class - freshness - PFU status - calculated GommaRush
customer price

## Priority order

1.  Audit/reconcile current repo and DB against this specification.
2.  Establish common supplier adapter/normalization contract.
3.  Integrate the strongest real catalogue/feed path for the competitive
    5--7 day supplier.
4.  Integrate the Italian \~48h supplier as manual observations.
5.  Fit existing Inter-Sprint work behind the same supplier-neutral
    boundary.
6.  Build unified internal tyre search/comparison.
7.  Add centralized pricing configuration and calculation.
8.  Build/complete customer offer and sales-order/sourcing layer.
9.  Connect accepted sourced orders into existing logistics.
10. Only later enable controlled automated supplier purchasing.
11. Customer/public buying/search experience follows reliable internal
    sourcing.

## Explicitly not first

-   autonomous AI purchasing
-   automatic Protocol 104 production ordering
-   Deldo live production ordering
-   complicated dynamic pricing
-   full customer checkout
-   redesigning existing logistics
