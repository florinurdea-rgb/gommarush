# GommaRush --- Sales & Sourcing Model

## Sales order

A customer sales order represents what GommaRush sold.

It must NOT require a supplier at creation.

Potential sources: - public website - customer portal - quote
conversion - WhatsApp - admin/manual - email - phone - future AI sales
agent

A new sales order may begin in a `NEEDS_SOURCING` state.

## Sourcing

Sourcing determines where GommaRush obtains the tyre after or while
preparing the customer offer/order.

One sales item may be fulfilled from: - Inter-Sprint - Deldo - Italian
manual supplier - future supplier - own stock

The architecture must permit split allocation.

Example: customer orders 8 identical tyres - 4 from Supplier A - 4 from
Supplier B

Do not encode supplier directly as the immutable identity of the
customer sales item.

## Supplier purchase

Supplier purchase is separate from customer sales order.

A supplier purchase may initially be: - MANUAL - TEST_ONLY - API_ENABLED
later

Automated supplier ordering is explicitly out of scope until approved.

## Existing logistics

Once goods are expected inbound, the supplier purchase/fulfilment can
connect to the existing supplier/logistics `orders` flow.

Do not destabilize the existing warehouse, loading, driver and delivery
system while building the sales/sourcing layer.
