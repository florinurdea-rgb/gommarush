-- Phase 1 / part 3: register the sourcing lanes and their EXPLICIT capabilities.
--
-- A capability is enabled ONLY where GommaRush can actually serve it today.
-- Everything else is registered disabled (or simply absent) so that "absence
-- means unavailable" holds literally. Rows carry a note recording WHY, so a
-- later reader does not mistake "not enabled" for "not supported by the
-- supplier".
--
-- TTL values are engineering defaults chosen to make freshness deterministic,
-- not business policy. Tune them per lane as real feed cadence is observed.
set search_path = "$user", public, extensions;

insert into public.suppliers
  (name, legal_name, lane_code, integration_type, is_sourcing_lane,
   delivery_class, default_lead_time_days, price_ttl_hours, stock_ttl_hours, notes, active)
values
  ('Inter-Sprint', 'Inter-Sprint Banden B.V.', 'intersprint', 'file_import', true,
   'unknown', null, 24, 24,
   'Sourcing lane. Bulk catalogue ingestion implemented against the real ISB spreadsheet contract. FTP delivery and Gateway live lookup are NOT implemented: no verified Inter-Sprint protocol documentation is available. integration_type will move file_import -> ftp_feed once FTP details are supplied.', true),
  ('Deldo', null, 'deldo', 'ftp_feed', true,
   '5_7d', 7, 24, 12,
   'Sourcing lane, registered but NOT INGESTING. No Deldo feed documentation (file/FTP mechanism, path, format, column contract) is available, so no parser exists. Supplier-supplied sample files are fictional/non-current and must be ingested only with is_test_data = true.', true),
  ('Italian 48h supplier', null, 'it_48h', 'manual', true,
   '48h', 2, 24, 8,
   'Manual sourcing lane. Registered now so the observation model does not need redesign later; integration deliberately deprioritised behind Inter-Sprint and Deldo. Operators record observations with source_type = manual and observed_by set.', true)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Capabilities.
-- production_ordering / test_ordering are inserted EXPLICITLY DISABLED for
-- every lane. They are recorded rather than omitted so the intent is visible in
-- data: these are known supplier features that GommaRush has deliberately not
-- enabled. supplier_capabilities_no_ordering_chk prevents them ever being
-- flipped to true without dropping the constraint.
-- ---------------------------------------------------------------------------
insert into public.supplier_capabilities (supplier_id, capability, enabled, verified_at, notes)
select s.id, c.capability, c.enabled, c.verified_at, c.notes
from public.suppliers s
join (values
  -- Inter-Sprint
  ('intersprint','catalogue_feed',     true,  now(), 'Implemented. Parser written against the real ISB row contract proven by the production import of 9,559 rows.'),
  ('intersprint','price_feed',         false, null,  'The ISB catalogue file carries NO price column. Not available until a priced feed is supplied.'),
  ('intersprint','stock_feed',         false, null,  'The ISB catalogue file carries NO stock column. Not available until a stock feed is supplied.'),
  ('intersprint','live_stock_lookup',  false, null,  'Gateway Protocol 103 is referenced in supplier correspondence but no verified protocol documentation is available. Not implemented; undocumented protocol behaviour must not be inferred.'),
  ('intersprint','live_price_lookup',  false, null,  'No verified Gateway documentation available.'),
  ('intersprint','test_ordering',      false, null,  'Out of scope in V1.'),
  ('intersprint','production_ordering',false, null,  'Protocol 104. DELIBERATELY DISABLED. Enabling is an OWNER_DECISION.'),
  -- Deldo
  ('deldo','catalogue_feed',     false, null, 'Supplier can supply/push stock+price files via FTP per correspondence, but no format documentation is available. No parser implemented.'),
  ('deldo','price_feed',         false, null, 'Documented as available from the supplier; not implemented - feed contract unknown.'),
  ('deldo','stock_feed',         false, null, 'Documented as available from the supplier; not implemented - feed contract unknown.'),
  ('deldo','live_stock_lookup',  false, null, 'Not documented as available.'),
  ('deldo','live_price_lookup',  false, null, 'Not documented as available.'),
  ('deldo','test_ordering',      false, null, 'Supplier requested XML validation before test-environment ordering. Out of scope in V1.'),
  ('deldo','production_ordering',false, null, 'DELIBERATELY DISABLED. Requires successful testing AND explicit approval. OWNER_DECISION.'),
  -- Italian 48h
  ('it_48h','catalogue_feed',     false, null, 'Manual lane - no feed exists.'),
  ('it_48h','price_feed',         false, null, 'Manual lane - operator records observations by hand.'),
  ('it_48h','stock_feed',         false, null, 'Manual lane - operator records observations by hand.'),
  ('it_48h','test_ordering',      false, null, 'Out of scope in V1.'),
  ('it_48h','production_ordering',false, null, 'Manual purchasing only. DELIBERATELY DISABLED.')
) as c(lane_code, capability, enabled, verified_at, notes)
  on c.lane_code = s.lane_code
on conflict (supplier_id, capability) do nothing;

-- ---------------------------------------------------------------------------
-- Inter-Sprint commercial terms as DATA, from supplier correspondence
-- (docs/architecture/02_SUPPLIER_RULES.md). Sourcing reads these; no adapter
-- and no hard-coded check may carry them.
-- ---------------------------------------------------------------------------
insert into public.supplier_commercial_rules (supplier_id, rule_type, scope, numeric_value, source_note)
select s.id, r.rule_type, r.scope, r.numeric_value, r.source_note
from public.suppliers s
join (values
  ('intersprint','min_order_qty',       'pcr',   60::numeric, 'Minimum release quantity communicated by supplier: passenger/PCR 60 tyres.'),
  ('intersprint','min_order_qty',       'truck', 10::numeric, 'Minimum release quantity communicated by supplier: truck 10 tyres.'),
  ('intersprint','prepayment_required', 'all',   null::numeric, 'Advance-payment/deposit model described by supplier.'),
  ('intersprint','balance_gated',       'all',   null::numeric, 'Supplier indicated order release depends on sufficient paid balance.')
) as r(lane_code, rule_type, scope, numeric_value, source_note)
  on r.lane_code = s.lane_code
on conflict do nothing;
