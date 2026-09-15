-- gorush_create_transport_order: the single creation path for transport jobs.
--
-- Forward-only and additive. The existing gorush_create_order is NOT modified
-- and NOT replaced -- it is 6.4kB of working logic that creates orders,
-- order_items, inventory_units and order_status_history, and it is called by
-- the manual-order route and the DDT import as well. Rewriting it to learn
-- about transport columns would put this feature's concerns inside everyone
-- else's creation path.
--
-- Instead this delegates to it and then applies the transport attributes. The
-- whole thing is one plpgsql function, so it is one transaction: either the
-- order, its items, its units, its history, its transport attributes AND its
-- first event all exist, or none of them do. That is the atomicity the brief
-- requires, achieved without forking the canonical service.
--
-- Why a wrapper rather than an UPDATE from the application: a second
-- round-trip is a second transaction, which would leave a window where an
-- order exists without a business_type. An order whose commercial type is
-- briefly unknown is exactly the ambiguity this whole feature exists to
-- prevent.

do $$
begin
  if to_regclass('public.transport_events') is null then
    raise exception 'MIGRATION_PREREQUISITE_MISSING: apply 20260903000000_transport_intake.sql first';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'gorush_create_order'
  ) then
    raise exception 'MIGRATION_PREREQUISITE_MISSING: gorush_create_order() must exist';
  end if;
end $$;

create or replace function public.gorush_create_transport_order(payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_ingestion_id uuid;
  v_inbound_status text;
  v_order_status text;
begin
  -- 1. Delegate to the canonical creation service, unchanged.
  v_result := public.gorush_create_order(payload);

  v_order_id := nullif(v_result->>'order_id', '')::uuid;
  if v_order_id is null then
    raise exception 'TRANSPORT_ORDER_CREATE_FAILED: gorush_create_order returned no order_id';
  end if;

  v_ingestion_id := nullif(payload->>'transport_ingestion_id', '')::uuid;
  v_inbound_status := coalesce(nullif(payload->>'inbound_status', ''), 'not_required');

  -- 2. Apply the transport attributes.
  --
  -- business_type is hard-coded rather than read from the payload: this
  -- function exists only to create transport jobs, and a caller must not be
  -- able to mint an OWN_SALE through it.
  update public.orders set
    business_type              = 'TRANSPORT_JOB',
    inbound_status             = v_inbound_status,
    inbound_method             = nullif(payload->>'inbound_method', ''),
    pickup_company             = nullif(payload->>'pickup_company', ''),
    pickup_address             = nullif(payload->>'pickup_address', ''),
    requested_pickup_date      = nullif(payload->>'requested_pickup_date', '')::date,
    requested_pickup_window    = nullif(payload->>'requested_pickup_window', ''),
    payment_operational_status = nullif(payload->>'payment_operational_status', ''),
    payment_printed_terms      = nullif(payload->>'payment_printed_terms', ''),
    payment_evidence           = nullif(payload->>'payment_evidence', ''),
    transport_ingestion_id     = v_ingestion_id
  where id = v_order_id;

  select status into v_order_status from public.orders where id = v_order_id;

  -- 3. The first immutable event, in the same transaction.
  --
  -- Recorded here rather than by the application so that an order can never
  -- exist without the event that explains where it came from.
  insert into public.transport_events (
    order_id, ingestion_id, event_kind, actor_type, actor_label,
    new_status, new_inbound_status, notes, metadata
  ) values (
    v_order_id,
    v_ingestion_id,
    'INGESTION_CONFIRMED',
    'OPERATOR',
    nullif(payload->>'created_by', ''),
    v_order_status,
    v_inbound_status,
    nullif(payload->>'confirm_notes', ''),
    jsonb_strip_nulls(jsonb_build_object(
      'document_number', payload->>'supplier_document_number',
      'distributor_id', payload->>'supplier_id',
      'extraction_model', payload->>'extraction_model',
      'used_escalation_model', payload->>'used_escalation_model'
    ))
  );

  return v_result || jsonb_build_object(
    'business_type', 'TRANSPORT_JOB',
    'inbound_status', v_inbound_status,
    'status', v_order_status
  );
end;
$$;

comment on function public.gorush_create_transport_order(jsonb) is
  'Creates one transport job: delegates to gorush_create_order, applies the transport attributes and writes the INGESTION_CONFIRMED event, all in one transaction. business_type is hard-coded to TRANSPORT_JOB so this path cannot mint a sales order.';
