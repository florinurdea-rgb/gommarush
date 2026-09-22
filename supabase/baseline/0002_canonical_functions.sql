-- GommaRush canonical baseline, part 2: functions, triggers, CHECK constraints
-- ===========================================================================
--
-- Companion to 0001_canonical_baseline.sql. Apply 0001 first.
--
-- ORDER MATTERS HERE. CHECK constraints come last because one of them,
-- valid_client_offer_request_tyres, calls is_valid_tyre_request() — a check
-- added before its function exists fails.
--
-- PROVENANCE. Unlike 0001, these definitions are NOT transcribed from
-- production. Every one of production's 28 functions is already defined in the
-- repository's migrations, so they are taken from there — keeping the comments
-- and reasoning the migrations carry — and then VERIFIED against production by
-- comparing normalised pg_get_functiondef output. The verification is the
-- point: it proves the repository's functions and production's are the same
-- code, which had never been checked.
--
-- The four document-analysis functions are deliberately absent. Their
-- migrations exist in the repository but have never been applied to
-- production, so they are not part of the current schema. They stay as a
-- pending migration rather than being folded into the baseline.
--
-- NOT APPLIED to production or staging.

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gorush_broadcast_order_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  perform realtime.send(
    jsonb_build_object(
      'table', 'orders',
      'id', new.id,
      'status', new.status,
      'vehicle_id', new.vehicle_id,
      'driver_id', new.driver_id
    ),
    'change',
    'gorush-ops',
    false
  );
  return new;
exception
  when others then
    -- Realtime must never block or fail the underlying write.
    return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_broadcast_quote_request_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  perform realtime.send(
    jsonb_build_object(
      'table', 'quote_requests',
      'id', new.id,
      'status', new.status,
      'notification_status', new.notification_status
    ),
    'change',
    'gorush-ops',
    false
  );
  return new;
exception
  when others then
    -- Realtime must never block or fail the underlying write.
    return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_broadcast_vehicle_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  perform realtime.send(
    jsonb_build_object('table', 'vehicles', 'id', new.id, 'active', new.active),
    'change',
    'gorush-ops',
    false
  );
  return new;
exception
  when others then
    return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_claim_print_job(p_agent_id text, p_printer_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_job public.print_jobs;
begin
  select * into v_job from public.print_jobs
   where status = 'pending'
   order by created_at
   for update skip locked
   limit 1;

  if v_job.id is null then
    return jsonb_build_object('ok', true, 'code', 'NO_JOB');
  end if;

  update public.print_jobs
     set status = 'processing',
         claimed_by = nullif(p_agent_id, ''),
         claimed_at = now(),
         printer_name = coalesce(nullif(p_printer_name, ''), printer_name),
         attempts = attempts + 1
   where id = v_job.id
   returning * into v_job;

  return jsonb_build_object(
    'ok', true, 'code', 'CLAIMED',
    'job', jsonb_build_object(
      'id', v_job.id,
      'inventory_unit_id', v_job.inventory_unit_id,
      'order_id', v_job.order_id,
      'print_type', v_job.print_type,
      'label_data', v_job.label_data,
      'attempts', v_job.attempts
    )
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_commit_catalogue_batch(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_run_id uuid;
  v_supplier_id uuid;
  v_operation jsonb;
  v_product jsonb;
  v_listing jsonb;
  v_identifier jsonb;
  v_conflict jsonb;
  v_action text;
  v_product_id uuid;
  v_listing_id uuid;
  v_import_row_id uuid;
  v_changes jsonb;

  v_inserted_products integer := 0;
  v_inserted_listings integer := 0;
  v_updated_listings integer := 0;
  v_updated_products integer := 0;
  v_unchanged integer := 0;
  v_conflicts integer := 0;
  v_deactivated integer := 0;
  v_applied integer := 0;
begin
  if payload is null then
    raise exception 'MISSING_PAYLOAD';
  end if;

  v_run_id := (payload ->> 'runId')::uuid;
  v_supplier_id := (payload ->> 'supplierId')::uuid;

  if v_run_id is null or v_supplier_id is null then
    raise exception 'MISSING_RUN_OR_SUPPLIER';
  end if;

  for v_operation in select * from jsonb_array_elements(coalesce(payload -> 'operations', '[]'::jsonb))
  loop
    v_action := v_operation ->> 'action';
    v_import_row_id := nullif(v_operation ->> 'importRowId', '')::uuid;
    v_product_id := nullif(v_operation ->> 'productId', '')::uuid;
    v_listing_id := nullif(v_operation ->> 'listingId', '')::uuid;
    v_product := v_operation -> 'product';
    v_listing := v_operation -> 'listing';

    -- ---------------------------------------------------------------------
    -- A product we have never seen
    -- ---------------------------------------------------------------------
    if v_action = 'insert_product' then
      insert into public.catalogue_products (
        product_key, ean, ean_status, manufacturer_product_code, brand_code, brand,
        model_pattern, description, product_class, season, width_mm, aspect_ratio,
        rim_inch, size_display, load_speed_raw, load_index, speed_rating, xl,
        run_flat, old_dot, weight_kg, weight_status, weight_category, e_mark,
        european, eprel_id, scan_ready, review_required, review_reasons,
        first_seen_at, last_seen_at
      )
      values (
        v_product ->> 'product_key',
        nullif(v_product ->> 'ean', ''),
        coalesce(v_product ->> 'ean_status', 'missing'),
        nullif(v_product ->> 'manufacturer_product_code', ''),
        nullif(v_product ->> 'brand_code', ''),
        nullif(v_product ->> 'brand', ''),
        nullif(v_product ->> 'model_pattern', ''),
        nullif(v_product ->> 'description', ''),
        nullif(v_product ->> 'product_class', ''),
        nullif(v_product ->> 'season', ''),
        (v_product ->> 'width_mm')::integer,
        (v_product ->> 'aspect_ratio')::integer,
        (v_product ->> 'rim_inch')::integer,
        nullif(v_product ->> 'size_display', ''),
        nullif(v_product ->> 'load_speed_raw', ''),
        nullif(v_product ->> 'load_index', ''),
        nullif(v_product ->> 'speed_rating', ''),
        (v_product ->> 'xl')::boolean,
        (v_product ->> 'run_flat')::boolean,
        coalesce((v_product ->> 'old_dot')::boolean, false),
        (v_product ->> 'weight_kg')::numeric,
        coalesce(v_product ->> 'weight_status', 'missing_or_zero'),
        nullif(v_product ->> 'weight_category', ''),
        nullif(v_product ->> 'e_mark', ''),
        (v_product ->> 'european')::boolean,
        nullif(v_product ->> 'eprel_id', ''),
        coalesce((v_product ->> 'scan_ready')::boolean, false),
        coalesce((v_product ->> 'review_required')::boolean, false),
        coalesce(
          (select array_agg(value::text) from jsonb_array_elements_text(coalesce(v_product -> 'review_reasons', '[]'::jsonb)) as value),
          '{}'::text[]
        ),
        now(), now()
      )
      -- A re-run of the same batch must not create a second product. The
      -- product key is stable across imports, so this is the resume path,
      -- not a silent overwrite: it touches last_seen_at and nothing else.
      on conflict (product_key) do update set last_seen_at = now()
      returning id into v_product_id;

      v_inserted_products := v_inserted_products + 1;
    end if;

    -- ---------------------------------------------------------------------
    -- Field-level updates to a product we already hold
    -- ---------------------------------------------------------------------
    if v_action in ('insert_listing', 'update_listing') and v_product_id is not null then
      v_changes := coalesce(v_operation -> 'productChanges', '{}'::jsonb);
      if v_changes <> '{}'::jsonb then
        update public.catalogue_products p set
          ean = coalesce(nullif(v_changes ->> 'ean', ''), p.ean),
          ean_status = coalesce(nullif(v_changes ->> 'ean_status', ''), p.ean_status),
          scan_ready = coalesce((v_changes ->> 'scan_ready')::boolean, p.scan_ready),
          weight_kg = coalesce((v_changes ->> 'weight_kg')::numeric, p.weight_kg),
          weight_status = coalesce(nullif(v_changes ->> 'weight_status', ''), p.weight_status),
          manufacturer_product_code = coalesce(nullif(v_changes ->> 'manufacturer_product_code', ''), p.manufacturer_product_code),
          brand = coalesce(nullif(v_changes ->> 'brand', ''), p.brand),
          brand_code = coalesce(nullif(v_changes ->> 'brand_code', ''), p.brand_code),
          model_pattern = coalesce(nullif(v_changes ->> 'model_pattern', ''), p.model_pattern),
          description = coalesce(nullif(v_changes ->> 'description', ''), p.description),
          product_class = coalesce(nullif(v_changes ->> 'product_class', ''), p.product_class),
          season = coalesce(nullif(v_changes ->> 'season', ''), p.season),
          size_display = coalesce(nullif(v_changes ->> 'size_display', ''), p.size_display),
          load_speed_raw = coalesce(nullif(v_changes ->> 'load_speed_raw', ''), p.load_speed_raw),
          load_index = coalesce(nullif(v_changes ->> 'load_index', ''), p.load_index),
          speed_rating = coalesce(nullif(v_changes ->> 'speed_rating', ''), p.speed_rating),
          weight_category = coalesce(nullif(v_changes ->> 'weight_category', ''), p.weight_category),
          e_mark = coalesce(nullif(v_changes ->> 'e_mark', ''), p.e_mark),
          eprel_id = coalesce(nullif(v_changes ->> 'eprel_id', ''), p.eprel_id),
          width_mm = coalesce((v_changes ->> 'width_mm')::integer, p.width_mm),
          aspect_ratio = coalesce((v_changes ->> 'aspect_ratio')::integer, p.aspect_ratio),
          rim_inch = coalesce((v_changes ->> 'rim_inch')::integer, p.rim_inch),
          xl = coalesce((v_changes ->> 'xl')::boolean, p.xl),
          run_flat = coalesce((v_changes ->> 'run_flat')::boolean, p.run_flat),
          european = coalesce((v_changes ->> 'european')::boolean, p.european),
          last_seen_at = now()
        where p.id = v_product_id;
        v_updated_products := v_updated_products + 1;
      else
        update public.catalogue_products set last_seen_at = now() where id = v_product_id;
      end if;
    end if;

    -- ---------------------------------------------------------------------
    -- The supplier's listing
    -- ---------------------------------------------------------------------
    if v_action in ('insert_product', 'insert_listing') and v_product_id is not null then
      insert into public.supplier_product_listings (
        supplier_id, catalogue_product_id, supplier_listing_key, supplier_article_id,
        supplier_item_code, source_product_key, source_row, old_dot, active,
        first_seen_at, last_seen_at, last_import_run_id
      )
      values (
        v_supplier_id,
        v_product_id,
        v_listing ->> 'supplier_listing_key',
        v_listing ->> 'supplier_article_id',
        nullif(v_listing ->> 'supplier_item_code', ''),
        nullif(v_listing ->> 'source_product_key', ''),
        (v_listing ->> 'source_row')::integer,
        coalesce((v_listing ->> 'old_dot')::boolean, false),
        true,
        now(), now(), v_run_id
      )
      -- first_seen_at is deliberately absent from the update: a listing that
      -- reappears keeps the date we first saw it, which is the whole point of
      -- having both columns.
      on conflict (supplier_listing_key) do update set
        supplier_item_code = excluded.supplier_item_code,
        old_dot = excluded.old_dot,
        active = true,
        last_seen_at = now(),
        last_import_run_id = v_run_id,
        deactivated_at = null
      returning id into v_listing_id;

      if v_action = 'insert_listing' then
        v_inserted_listings := v_inserted_listings + 1;
      end if;
    end if;

    if v_action = 'update_listing' and v_listing_id is not null then
      v_changes := coalesce(v_operation -> 'listingChanges', '{}'::jsonb);
      update public.supplier_product_listings l set
        supplier_item_code = coalesce(nullif(v_changes ->> 'supplier_item_code', ''), l.supplier_item_code),
        old_dot = coalesce((v_changes ->> 'old_dot')::boolean, l.old_dot),
        active = coalesce((v_changes ->> 'active')::boolean, l.active),
        deactivated_at = case when coalesce((v_changes ->> 'active')::boolean, l.active) then null else l.deactivated_at end,
        last_seen_at = now(),
        last_import_run_id = v_run_id
      where l.id = v_listing_id;
      v_updated_listings := v_updated_listings + 1;
    end if;

    if v_action = 'unchanged' then
      update public.supplier_product_listings
        set last_seen_at = now(), last_import_run_id = v_run_id
        where id = v_listing_id;
      v_unchanged := v_unchanged + 1;
    end if;

    -- A listing absent from a COMPLETE snapshot. Never deleted — the row and
    -- its history stay, and last_seen_at says when it was last offered.
    if v_action = 'deactivate_listing' and v_listing_id is not null then
      update public.supplier_product_listings
        set active = false, deactivated_at = now(), last_import_run_id = v_run_id
        where id = v_listing_id and active = true;
      v_deactivated := v_deactivated + 1;
    end if;

    -- ---------------------------------------------------------------------
    -- Identifiers: every code that has ever pointed at this product
    -- ---------------------------------------------------------------------
    if v_product_id is not null then
      for v_identifier in
        select * from jsonb_array_elements(coalesce(v_operation -> 'identifiers', '[]'::jsonb))
      loop
        insert into public.product_identifiers (
          catalogue_product_id, identifier_type, identifier_value, normalized_value,
          supplier_id, validation_status, source, first_seen_at, last_seen_at
        )
        values (
          v_product_id,
          v_identifier ->> 'identifier_type',
          v_identifier ->> 'identifier_value',
          v_identifier ->> 'normalized_value',
          case when (v_identifier ->> 'supplier_scoped')::boolean then v_supplier_id else null end,
          coalesce(v_identifier ->> 'validation_status', 'unverified'),
          coalesce(v_identifier ->> 'source', 'import'),
          now(), now()
        )
        on conflict (catalogue_product_id, identifier_type, normalized_value,
                     coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid))
        do update set last_seen_at = now();
      end loop;
    end if;

    -- ---------------------------------------------------------------------
    -- Commercial data, kept off the canonical product
    -- ---------------------------------------------------------------------
    if v_listing_id is not null and (v_operation -> 'price') is not null then
      insert into public.supplier_listing_prices (
        supplier_listing_id, purchase_price, currency, stock_raw, stock_exact,
        stock_minimum, observed_at, import_run_id
      )
      values (
        v_listing_id,
        (v_operation -> 'price' ->> 'purchase_price')::numeric,
        coalesce(v_operation -> 'price' ->> 'currency', 'EUR'),
        nullif(v_operation -> 'price' ->> 'stock_raw', ''),
        (v_operation -> 'price' ->> 'stock_exact')::integer,
        (v_operation -> 'price' ->> 'stock_minimum')::integer,
        now(), v_run_id
      );
    end if;

    -- ---------------------------------------------------------------------
    -- Conflicts: recorded, never resolved by picking a value
    -- ---------------------------------------------------------------------
    for v_conflict in select * from jsonb_array_elements(coalesce(v_operation -> 'conflicts', '[]'::jsonb))
    loop
      insert into public.catalogue_conflicts (
        import_run_id, import_row_id, conflict_type, supplier_id, supplier_listing_key,
        catalogue_product_id, competing_product_id, field, existing_value,
        incoming_value, detail, status
      )
      values (
        v_run_id,
        v_import_row_id,
        v_conflict ->> 'conflict_type',
        v_supplier_id,
        nullif(v_conflict ->> 'supplier_listing_key', ''),
        nullif(v_conflict ->> 'catalogue_product_id', '')::uuid,
        nullif(v_conflict ->> 'competing_product_id', '')::uuid,
        nullif(v_conflict ->> 'field', ''),
        nullif(v_conflict ->> 'existing_value', ''),
        nullif(v_conflict ->> 'incoming_value', ''),
        coalesce(v_conflict -> 'detail', '{}'::jsonb),
        'open'
      );
      v_conflicts := v_conflicts + 1;
    end loop;

    -- ---------------------------------------------------------------------
    -- Mark the staged row applied. This is what makes the run resumable.
    -- ---------------------------------------------------------------------
    if v_import_row_id is not null then
      update public.catalogue_import_rows
        set committed_at = now(),
            matched_product_id = v_product_id,
            matched_listing_id = v_listing_id
        where id = v_import_row_id;
    end if;

    v_applied := v_applied + 1;
  end loop;

  update public.catalogue_import_runs
    set committed_row_count = committed_row_count + v_applied,
        inserted_listings = inserted_listings + v_inserted_listings,
        updated_listings = updated_listings + v_updated_listings,
        unchanged_listings = unchanged_listings + v_unchanged,
        new_products = new_products + v_inserted_products,
        updated_products = updated_products + v_updated_products,
        deactivated_listings = deactivated_listings + v_deactivated,
        conflict_count = conflict_count + v_conflicts
    where id = v_run_id;

  return jsonb_build_object(
    'applied', v_applied,
    'newProducts', v_inserted_products,
    'insertedListings', v_inserted_listings,
    'updatedListings', v_updated_listings,
    'updatedProducts', v_updated_products,
    'unchanged', v_unchanged,
    'deactivated', v_deactivated,
    'conflicts', v_conflicts
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_complete_print_job(p_job_id uuid, p_success boolean, p_error text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_exists boolean;
begin
  select true into v_exists from public.print_jobs where id = p_job_id for update;
  if v_exists is null then
    return jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND');
  end if;

  if p_success then
    update public.print_jobs
       set status = 'printed', printed_at = now(), error_message = null
     where id = p_job_id;
    return jsonb_build_object('ok', true, 'code', 'PRINTED');
  end if;

  -- Failure keeps the job recoverable: status 'failed' with the reason, ready
  -- for a manual retry. The label is never lost.
  update public.print_jobs
     set status = 'failed', error_message = left(coalesce(p_error, 'unknown error'), 1000)
   where id = p_job_id;
  return jsonb_build_object('ok', true, 'code', 'FAILED');
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_create_order(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_order_id uuid;
  v_order_number bigint;
  v_status text := coalesce(nullif(payload->>'status', ''), 'expected');
  v_item jsonb;
  v_item_id uuid;
  v_line integer := 0;
  v_unit_count integer := 0;
  v_quantity integer;
  v_is_physical boolean;
  v_item_type text;
  v_unit_type text;
  i integer;
begin
  if payload is null then
    raise exception 'MISSING_PAYLOAD';
  end if;
  if nullif(payload->>'supplier_id', '') is null then
    -- orders.supplier_id is NOT NULL in this schema: an order always originates
    -- from a supplier document.
    raise exception 'SUPPLIER_REQUIRED';
  end if;

  insert into public.orders (
    supplier_id, supplier_document_number, document_date, supplier_order_reference,
    document_type, source_type,
    customer_id, customer_location_id,
    delivery_name, delivery_address_line1, delivery_address_line2,
    delivery_postal_code, delivery_city, delivery_province, delivery_country_code,
    delivery_notes,
    planned_delivery_date, expected_at, driver_id, vehicle_id, status,
    cash_on_delivery, payment_method, amount_to_collect, currency, collection_method,
    payment_status, notes, source_document_id
  )
  values (
    (payload->>'supplier_id')::uuid,
    nullif(payload->>'supplier_document_number', ''),
    nullif(payload->>'supplier_document_date', '')::date,
    nullif(payload->>'supplier_reference', ''),
    nullif(payload->>'document_type', ''),
    coalesce(nullif(payload->>'source_type', ''), 'manual'),
    nullif(payload->>'customer_id', '')::uuid,
    nullif(payload->>'customer_location_id', '')::uuid,
    nullif(payload->>'delivery_recipient', ''),
    nullif(payload->>'delivery_address_line1', ''),
    nullif(payload->>'delivery_address_line2', ''),
    nullif(payload->>'delivery_postal_code', ''),
    nullif(payload->>'delivery_city', ''),
    nullif(payload->>'delivery_province', ''),
    coalesce(nullif(payload->>'delivery_country', ''), 'IT'),
    nullif(payload->>'delivery_notes', ''),
    nullif(payload->>'planned_delivery_date', '')::date,
    -- expected_at mirrors the planned date so the pre-existing timestamp column
    -- stays meaningful alongside the new date column.
    nullif(payload->>'planned_delivery_date', '')::date::timestamptz,
    nullif(payload->>'driver_id', '')::uuid,
    nullif(payload->>'vehicle_id', '')::uuid,
    v_status,
    coalesce((payload->>'requires_payment_on_delivery')::boolean, false),
    nullif(payload->>'payment_method', ''),
    nullif(payload->>'amount_to_collect', '')::numeric,
    coalesce(nullif(payload->>'currency', ''), 'EUR'),
    nullif(payload->>'collection_method', ''),
    case
      when coalesce((payload->>'requires_payment_on_delivery')::boolean, false) then 'pending'
      else 'not_required'
    end,
    nullif(payload->>'notes', ''),
    nullif(payload->>'source_document_id', '')::uuid
  )
  returning id, order_number into v_order_id, v_order_number;

  for v_item in select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    v_line := v_line + 1;
    v_item_type := coalesce(nullif(v_item->>'item_type', ''), 'other');
    v_quantity := greatest(coalesce((v_item->>'quantity')::integer, 1), 1);
    -- Services and fees are order items but not physical inventory. An explicit
    -- is_physical always wins, which is the hook for a future "fee that ships".
    v_is_physical := coalesce(
      (v_item->>'is_physical')::boolean,
      v_item_type not in ('service', 'fee')
    );

    insert into public.order_items (
      order_id, line_number, item_type, is_physical, supplier_sku,
      raw_description, description, brand, model,
      width, aspect_ratio, rim_diameter, load_index, speed_rating, season,
      extra_load, run_flat,
      quantity, unit_price, vat_percent, environmental_fee, logistics_fee,
      line_subtotal, notes, needs_review, review_fields, confidence
    )
    values (
      v_order_id,
      coalesce((v_item->>'line_number')::integer, v_line),
      v_item_type,
      v_is_physical,
      nullif(v_item->>'supplier_sku', ''),
      nullif(v_item->>'raw_description', ''),
      nullif(v_item->>'description', ''),
      nullif(v_item->>'brand', ''),
      nullif(v_item->>'model', ''),
      nullif(v_item->>'width', '')::integer,
      nullif(v_item->>'aspect_ratio', '')::integer,
      nullif(v_item->>'rim_diameter', '')::numeric,
      nullif(v_item->>'load_index', ''),
      nullif(v_item->>'speed_rating', ''),
      nullif(v_item->>'season', ''),
      nullif(v_item->>'extra_load', '')::boolean,
      nullif(v_item->>'run_flat', '')::boolean,
      v_quantity,
      nullif(v_item->>'unit_price', '')::numeric,
      nullif(v_item->>'tax_rate', '')::numeric,
      nullif(v_item->>'pfu_fee', '')::numeric,
      nullif(v_item->>'logistics_fee', '')::numeric,
      case
        when nullif(v_item->>'unit_price', '') is not null
          then round((v_item->>'unit_price')::numeric * v_quantity, 2)
        else null
      end,
      nullif(v_item->>'notes', ''),
      coalesce((v_item->>'needs_review')::boolean, false),
      coalesce(
        (select array_agg(value) from jsonb_array_elements_text(coalesce(v_item->'review_fields', '[]'::jsonb)) as value),
        '{}'
      ),
      nullif(v_item->>'confidence', '')::numeric
    )
    returning id into v_item_id;

    -- One inventory_unit per physical object: quantity 4 => 4 rows. No
    -- ceiling of any kind on how many orders/units can exist concurrently —
    -- the removed stand system was the only artificial cap here.
    if v_is_physical then
      -- inventory_units.unit_type has a narrower vocabulary than
      -- order_items.item_type (no service/fee), so anything unexpected lands on
      -- 'other' rather than violating the constraint.
      v_unit_type := case
        when v_item_type in ('tyre', 'tube', 'wheel', 'accessory') then v_item_type
        else 'other'
      end;

      for i in 1..v_quantity loop
        insert into public.inventory_units (
          order_id, order_item_id, unit_type, unit_sequence, qr_token, description, status
        )
        values (
          v_order_id, v_item_id, v_unit_type, i,
          public.gorush_new_unit_token(),
          coalesce(nullif(v_item->>'description', ''), nullif(v_item->>'raw_description', '')),
          'expected'
        );
        v_unit_count := v_unit_count + 1;
      end loop;
    end if;
  end loop;

  insert into public.order_status_history (order_id, old_status, new_status, changed_by_label, notes)
  values (v_order_id, null, v_status, nullif(payload->>'created_by', ''), 'order_created');

  if nullif(payload->>'source_document_id', '') is not null then
    update public.order_documents
       set order_id = v_order_id,
           extraction_status = 'confirmed'
     where id = (payload->>'source_document_id')::uuid;
  end if;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'inventory_unit_count', v_unit_count,
    'item_count', v_line
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_create_quote_request(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_request_id uuid;
  v_reference text;
  v_created_at timestamptz;
  v_idempotency_key text := nullif(btrim(coalesce(payload->>'idempotency_key', '')), '');
  v_item jsonb;
  v_index integer := 0;
  v_item_count integer := 0;
  v_delivery text;
begin
  if payload is null then
    raise exception 'MISSING_PAYLOAD';
  end if;

  if v_idempotency_key is not null then
    select id, public_reference, created_at
      into v_request_id, v_reference, v_created_at
      from public.quote_requests
     where idempotency_key = v_idempotency_key
     limit 1;

    if v_request_id is not null then
      select count(*) into v_item_count
        from public.quote_request_items
       where quote_request_id = v_request_id;

      insert into public.quote_request_events (quote_request_id, event_type, meta)
      values (v_request_id, 'duplicate_submission_prevented', '{}'::jsonb);

      return jsonb_build_object(
        'request_id', v_request_id,
        'public_reference', v_reference,
        'item_count', v_item_count,
        'created_at', v_created_at,
        'replayed', true
      );
    end if;
  end if;

  if jsonb_array_length(coalesce(payload->'items', '[]'::jsonb)) = 0 then
    raise exception 'NO_ITEMS';
  end if;

  select case when bool_or(coalesce(item->>'delivery_speed', '') = '48h') then '48h' else '7d' end
    into v_delivery
    from jsonb_array_elements(payload->'items') as item;

  insert into public.quote_requests (
    company_name, contact_email, whatsapp, language, idempotency_key, source,
    public_reference, notes, delivery_preference, submitted_at,
    status, notification_status
  )
  values (
    btrim(payload->>'company_name'),
    btrim(payload->>'contact_email'),
    nullif(btrim(coalesce(payload->>'whatsapp', '')), ''),
    coalesce(nullif(payload->>'language', ''), 'it'),
    v_idempotency_key,
    coalesce(nullif(payload->>'source', ''), 'web'),
    public.gorush_next_quote_reference(),
    nullif(btrim(coalesce(payload->>'notes', '')), ''),
    v_delivery,
    now(),
    'submitted',
    'pending'
  )
  returning id, public_reference, created_at
       into v_request_id, v_reference, v_created_at;

  for v_item in select * from jsonb_array_elements(payload->'items')
  loop
    insert into public.quote_request_items (
      quote_request_id, product_type, description,
      width, profile, rim, load_speed_index, season,
      quantity, preference_type, preferred_brand, delivery_speed, sort_order
    )
    values (
      v_request_id,
      v_item->>'product_type',
      nullif(btrim(coalesce(v_item->>'description', '')), ''),
      nullif(v_item->>'width', '')::integer,
      nullif(v_item->>'profile', '')::integer,
      nullif(v_item->>'rim', '')::integer,
      nullif(btrim(coalesce(v_item->>'load_speed_index', '')), ''),
      nullif(v_item->>'season', ''),
      coalesce(nullif(v_item->>'quantity', '')::integer, 1),
      nullif(v_item->>'preference_type', ''),
      nullif(btrim(coalesce(v_item->>'preferred_brand', '')), ''),
      v_item->>'delivery_speed',
      v_index
    );
    v_index := v_index + 1;
  end loop;

  insert into public.quote_request_events (quote_request_id, event_type, meta, duration_ms)
  values (
    v_request_id,
    'request_persisted',
    jsonb_build_object('item_count', v_index, 'delivery_preference', v_delivery),
    nullif(payload->>'validation_ms', '')::integer
  );

  return jsonb_build_object(
    'request_id', v_request_id,
    'public_reference', v_reference,
    'item_count', v_index,
    'created_at', v_created_at,
    'replayed', false
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_deliver_order(p_order_id uuid, p_driver_id uuid, p_operator text DEFAULT NULL::text, p_amount_collected numeric DEFAULT NULL::numeric, p_payment_method text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND');
  end if;
  -- A null p_driver_id means an admin/warehouse-initiated delivery (the
  -- Livrări board's own "Marchează livrată" action), which is exempt from
  -- the wrong-driver check by design. A non-null p_driver_id (the driver
  -- app) must always match the order's assigned driver.
  if p_driver_id is not null and v_order.driver_id is distinct from p_driver_id then
    return jsonb_build_object('ok', false, 'code', 'WRONG_DRIVER');
  end if;

  -- Idempotent: a double tap (or a retried request after a dropped
  -- response) must return the existing successful state, never error and
  -- never record a second delivery event.
  if v_order.status = 'delivered' then
    return jsonb_build_object(
      'ok', true, 'code', 'ALREADY_DELIVERED',
      'status', v_order.status, 'delivered_at', v_order.delivered_at
    );
  end if;

  if v_order.status not in ('loaded', 'out_for_delivery') then
    return jsonb_build_object('ok', false, 'code', 'NOT_LOADED', 'status', v_order.status);
  end if;

  update public.orders
     set status = 'delivered',
         delivered_at = now(),
         amount_collected = coalesce(p_amount_collected, amount_collected),
         payment_method = coalesce(nullif(p_payment_method, ''), payment_method),
         payment_status = case
           when p_amount_collected is not null then 'collected'
           else payment_status
         end,
         payment_collected_at = case
           when p_amount_collected is not null then now()
           else payment_collected_at
         end
   where id = p_order_id;

  insert into public.order_status_history (order_id, old_status, new_status, changed_by, changed_by_label, notes)
  values (p_order_id, v_order.status, 'delivered', p_driver_id, nullif(p_operator, ''), 'delivery_confirmed');

  return jsonb_build_object('ok', true, 'code', 'DELIVERED', 'status', 'delivered', 'delivered_at', now());
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_load_unit(p_unit_token text, p_driver_id uuid, p_vehicle_id uuid DEFAULT NULL::uuid, p_operator text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_unit public.inventory_units;
  v_order public.orders;
  v_customer_name text;
  v_code text;
  v_ok boolean := false;
  v_scan_type text := 'loading';
  v_result text := 'success';
begin
  if nullif(p_idempotency_key, '') is not null
     and exists (select 1 from public.inventory_scans where idempotency_key = p_idempotency_key) then
    select u.* into v_unit from public.inventory_units u
      join public.inventory_scans s on s.inventory_unit_id = u.id
     where s.idempotency_key = p_idempotency_key limit 1;
    return jsonb_build_object(
      'ok', true, 'code', 'ALREADY_PROCESSED',
      'inventory_unit_id', v_unit.id, 'status', v_unit.status
    );
  end if;

  select * into v_unit from public.inventory_units
   where qr_token = trim(p_unit_token) for update;

  if v_unit.id is null then
    return jsonb_build_object('ok', false, 'code', 'UNIT_NOT_FOUND');
  end if;

  select * into v_order from public.orders where id = v_unit.order_id;
  select c.name into v_customer_name from public.customers c where c.id = v_order.customer_id;

  -- Order of checks matters: "this belongs to another delivery" is the more
  -- important thing to tell someone holding the wrong tyre, even if that tyre
  -- also happens to be already loaded.
  if v_order.status = 'cancelled' then
    v_code := 'ORDER_CANCELLED'; v_result := 'rejected'; v_scan_type := 'inventory_check';
  elsif v_order.driver_id is distinct from p_driver_id then
    v_code := 'WRONG_DRIVER'; v_result := 'rejected'; v_scan_type := 'inventory_check';
  elsif p_vehicle_id is not null and v_order.vehicle_id is not null
        and v_order.vehicle_id <> p_vehicle_id then
    v_code := 'WRONG_VEHICLE'; v_result := 'rejected'; v_scan_type := 'inventory_check';
  elsif v_unit.status = 'loaded' then
    v_code := 'ALREADY_LOADED'; v_result := 'duplicate'; v_scan_type := 'inventory_check';
  elsif v_unit.status in ('out_for_delivery', 'delivered') then
    v_code := 'ALREADY_MOVED_ON'; v_result := 'duplicate'; v_scan_type := 'inventory_check';
  elsif v_unit.status not in ('stored', 'ready_for_loading') then
    -- Nothing gets on a van that the warehouse never checked in.
    v_code := 'NOT_STORED'; v_result := 'rejected'; v_scan_type := 'inventory_check';
  else
    update public.inventory_units
       set status = 'loaded',
           loaded_at = now(),
           last_vehicle_id = coalesce(p_vehicle_id, v_order.vehicle_id)
     where id = v_unit.id
     returning * into v_unit;
    v_code := 'LOADED';
    v_ok := true;
  end if;

  insert into public.inventory_scans (
    inventory_unit_id, order_id, order_item_id, scan_type, result,
    raw_value, driver_id, vehicle_id, operator_session, stand_code,
    idempotency_key, reason, device_type
  )
  values (
    v_unit.id, v_unit.order_id, v_unit.order_item_id, v_scan_type, v_result,
    trim(p_unit_token), p_driver_id, p_vehicle_id, nullif(p_operator, ''),
    v_order.stand_code, nullif(p_idempotency_key, ''),
    case when v_result <> 'success' then v_code else null end,
    'handheld_scanner'
  );

  if v_ok then
    perform public.gorush_refresh_order_status(v_order.id, p_operator);
  end if;

  return jsonb_build_object(
    'ok', v_ok, 'code', v_code,
    'inventory_unit_id', v_unit.id,
    'unit_token', v_unit.qr_token,
    'status', v_unit.status,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'customer', coalesce(v_customer_name, v_order.delivery_name, ''),
    'description', v_unit.description,
    'stand_code', v_order.stand_code
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_log_quote_event(p_event_type text, p_request_id uuid DEFAULT NULL::uuid, p_meta jsonb DEFAULT '{}'::jsonb, p_duration_ms integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  insert into public.quote_request_events (quote_request_id, event_type, meta, duration_ms)
  values (p_request_id, p_event_type, coalesce(p_meta, '{}'::jsonb), p_duration_ms);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_manual_load_unit(p_inventory_unit_id uuid, p_driver_id uuid, p_vehicle_id uuid, p_reason text, p_operator text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_unit public.inventory_units;
  v_order public.orders;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  select * into v_unit from public.inventory_units where id = p_inventory_unit_id for update;
  if v_unit.id is null then
    return jsonb_build_object('ok', false, 'code', 'UNIT_NOT_FOUND');
  end if;

  select * into v_order from public.orders where id = v_unit.order_id;

  if v_order.driver_id is distinct from p_driver_id then
    return jsonb_build_object('ok', false, 'code', 'WRONG_DRIVER');
  end if;
  if v_unit.status = 'loaded' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_LOADED');
  end if;

  update public.inventory_units
     set status = 'loaded',
         loaded_at = now(),
         stored_at = coalesce(stored_at, now()),
         received_at = coalesce(received_at, now()),
         last_vehicle_id = coalesce(p_vehicle_id, v_order.vehicle_id)
   where id = v_unit.id
   returning * into v_unit;

  insert into public.inventory_scans (
    inventory_unit_id, order_id, order_item_id, scan_type, result,
    driver_id, vehicle_id, operator_session, manual, reason, device_type
  )
  values (
    v_unit.id, v_unit.order_id, v_unit.order_item_id, 'manual_loading', 'success',
    p_driver_id, p_vehicle_id, nullif(p_operator, ''), true, trim(p_reason), 'manual'
  );

  perform public.gorush_refresh_order_status(v_order.id, p_operator);

  return jsonb_build_object(
    'ok', true, 'code', 'LOADED',
    'inventory_unit_id', v_unit.id, 'status', v_unit.status,
    'order_number', v_order.order_number
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_mark_delivery_failed(p_order_id uuid, p_driver_id uuid DEFAULT NULL::uuid, p_operator text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_order public.orders;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND');
  end if;
  if p_driver_id is not null and v_order.driver_id is distinct from p_driver_id then
    return jsonb_build_object('ok', false, 'code', 'WRONG_DRIVER');
  end if;
  if v_order.status = 'delivered' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_DELIVERED');
  end if;
  if v_order.status = 'on_hold' then
    -- Already flagged; update the reason rather than double-recording.
    update public.orders
       set delivery_failure_reason = v_reason, delivery_failed_at = now()
     where id = p_order_id;
    insert into public.order_status_history (order_id, old_status, new_status, changed_by, changed_by_label, notes)
    values (p_order_id, 'on_hold', 'on_hold', p_driver_id, nullif(p_operator, ''), 'delivery_failed:' || v_reason);
    return jsonb_build_object('ok', true, 'code', 'DELIVERY_FAILED', 'status', 'on_hold');
  end if;

  update public.orders
     set status = 'on_hold',
         status_before_hold = v_order.status,
         held_at = now(),
         delivery_failure_reason = v_reason,
         delivery_failed_at = now()
   where id = p_order_id;

  insert into public.order_status_history (order_id, old_status, new_status, changed_by, changed_by_label, notes)
  values (p_order_id, v_order.status, 'on_hold', p_driver_id, nullif(p_operator, ''), 'delivery_failed:' || v_reason);

  return jsonb_build_object('ok', true, 'code', 'DELIVERY_FAILED', 'status', 'on_hold');
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_mark_order_loaded(p_order_id uuid, p_vehicle_id uuid DEFAULT NULL::uuid, p_operator text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_order public.orders;
  v_vehicle_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND');
  end if;

  if v_order.status in ('loaded', 'out_for_delivery', 'partially_delivered', 'delivered') then
    return jsonb_build_object(
      'ok', true, 'code', 'ALREADY_LOADED',
      'status', v_order.status, 'loaded_at', v_order.loaded_at
    );
  end if;

  if v_order.status not in ('stored', 'ready_for_loading') then
    return jsonb_build_object('ok', false, 'code', 'NOT_READY', 'status', v_order.status);
  end if;

  v_vehicle_id := coalesce(p_vehicle_id, v_order.vehicle_id);
  if v_vehicle_id is null then
    return jsonb_build_object('ok', false, 'code', 'NO_VEHICLE');
  end if;

  update public.orders
     set status = 'loaded',
         loaded_at = now(),
         vehicle_id = v_vehicle_id
   where id = p_order_id;

  insert into public.order_status_history (order_id, old_status, new_status, changed_by_label, notes)
  values (p_order_id, v_order.status, 'loaded', nullif(p_operator, ''), 'marked_loaded');

  return jsonb_build_object('ok', true, 'code', 'LOADED', 'status', 'loaded', 'loaded_at', now());
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_new_unit_token()
 RETURNS text
 LANGUAGE sql
AS $function$
  select 'GRU' || upper(encode(gen_random_bytes(12), 'hex'));
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_next_quote_reference()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare
  -- Europe/Rome, not UTC: the date in the reference must match the date the
  -- Italian sales team saw the request arrive.
  v_day date := (now() at time zone 'Europe/Rome')::date;
  v_next integer;
begin
  insert into public.quote_request_reference_counter as c (day, last_value)
  values (v_day, 1)
  on conflict (day) do update set last_value = c.last_value + 1
  returning c.last_value into v_next;

  return 'GR-' || to_char(v_day, 'YYMMDD') || '-' || lpad(v_next::text, 4, '0');
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_receive_unit(p_order_item_id uuid, p_raw_value text DEFAULT NULL::text, p_operator text DEFAULT NULL::text, p_manual boolean DEFAULT false, p_reason text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_metadata jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_unit public.inventory_units;
  v_order public.orders;
  v_item public.order_items;
  v_scan_id uuid;
  v_print_job_id uuid;
  v_existing_scan public.inventory_scans;
  v_label jsonb;
  v_customer_name text;
  v_product text;
  v_size text;
begin
  -- Idempotency first: a double-submitted capture must return the original
  -- result rather than consuming a second physical unit.
  if nullif(p_idempotency_key, '') is not null then
    select * into v_existing_scan from public.inventory_scans
     where idempotency_key = p_idempotency_key limit 1;
    if v_existing_scan.id is not null then
      select * into v_unit from public.inventory_units where id = v_existing_scan.inventory_unit_id;
      select * into v_order from public.orders where id = v_unit.order_id;
      return jsonb_build_object(
        'ok', true, 'code', 'ALREADY_PROCESSED',
        'inventory_unit_id', v_unit.id,
        'unit_token', v_unit.qr_token,
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'stand_code', v_order.stand_code,
        'scan_id', v_existing_scan.id,
        'print_job_id', (
          select id from public.print_jobs
           where inventory_unit_id = v_unit.id order by created_at desc limit 1
        )
      );
    end if;
  end if;

  select * into v_item from public.order_items where id = p_order_item_id;
  if v_item.id is null then
    return jsonb_build_object('ok', false, 'code', 'ORDER_ITEM_NOT_FOUND');
  end if;

  select * into v_order from public.orders where id = v_item.order_id;
  if v_order.id is null then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND');
  end if;
  if v_order.status in ('cancelled', 'on_hold') then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_ACTIVE', 'status', v_order.status);
  end if;

  -- SKIP LOCKED: two operators receiving the same order item at the same moment
  -- each claim a different physical unit instead of colliding.
  select * into v_unit from public.inventory_units
   where order_item_id = p_order_item_id and status = 'expected'
   order by unit_sequence
   for update skip locked
   limit 1;

  if v_unit.id is null then
    return jsonb_build_object(
      'ok', false, 'code', 'NO_UNIT_EXPECTED',
      'order_id', v_order.id, 'order_number', v_order.order_number
    );
  end if;

  update public.inventory_units
     set status = 'received',
         received_at = now(),
         last_stand_code = v_order.stand_code,
         matched_manually = p_manual
   where id = v_unit.id
   returning * into v_unit;

  insert into public.inventory_scans (
    inventory_unit_id, order_id, order_item_id, scan_type, result,
    raw_value, operator_session, stand_code, manual, reason, metadata,
    idempotency_key, device_type
  )
  values (
    v_unit.id, v_order.id, v_item.id,
    -- Existing vocabulary: 'received' for a supplier-label match,
    -- 'manual_check' when a human picked the association.
    case when p_manual then 'manual_check' else 'received' end,
    'success',
    nullif(p_raw_value, ''), nullif(p_operator, ''), v_order.stand_code,
    p_manual, nullif(p_reason, ''), p_metadata, nullif(p_idempotency_key, ''),
    case when p_manual then 'manual' else 'camera' end
  )
  returning id into v_scan_id;

  perform public.gorush_refresh_order_status(v_order.id, p_operator);

  select c.name into v_customer_name from public.customers c where c.id = v_order.customer_id;

  v_size := case
    when v_item.width is not null and v_item.aspect_ratio is not null and v_item.rim_diameter is not null
      then v_item.width || '/' || v_item.aspect_ratio || ' R' ||
           -- R18 rather than R18.0, but R17.5 keeps its decimal.
           case when v_item.rim_diameter = trunc(v_item.rim_diameter)
                then trunc(v_item.rim_diameter)::integer::text
                else v_item.rim_diameter::text end
    else ''
  end;

  v_product := coalesce(
    nullif(trim(coalesce(v_item.brand, '') || ' ' || coalesce(v_item.description, '')), ''),
    v_item.raw_description,
    'Produs'
  );

  -- label_data carries everything the Print Agent needs to render the exact
  -- label, and nothing sensitive: no payment amounts, no addresses, no keys.
  v_label := jsonb_build_object(
    'inventory_unit_id', v_unit.id,
    'unit_token', v_unit.qr_token,
    'order_number', v_order.order_number,
    'stand_code', v_order.stand_code,
    'customer', coalesce(v_customer_name, v_order.delivery_name, ''),
    'product', v_product,
    'brand', coalesce(v_item.brand, ''),
    'size', v_size,
    'load_speed', trim(coalesce(v_item.load_index, '') || coalesce(v_item.speed_rating, '')),
    'unit_index', v_unit.unit_sequence,
    'unit_total', v_item.quantity,
    'item_type', v_item.item_type
  );

  -- print_jobs_open_unit_key makes this idempotent at the database level: if a
  -- pending/processing job already exists for this unit, keep it.
  insert into public.print_jobs (inventory_unit_id, order_id, print_type, label_data, status)
  values (v_unit.id, v_order.id, 'inventory_unit_label', v_label, 'pending')
  on conflict do nothing
  returning id into v_print_job_id;

  if v_print_job_id is null then
    select id into v_print_job_id from public.print_jobs
     where inventory_unit_id = v_unit.id order by created_at desc limit 1;
  end if;

  return jsonb_build_object(
    'ok', true, 'code', 'RECEIVED',
    'inventory_unit_id', v_unit.id,
    'unit_token', v_unit.qr_token,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'stand_code', v_order.stand_code,
    'customer', coalesce(v_customer_name, v_order.delivery_name, ''),
    'product', v_product,
    'scan_id', v_scan_id,
    'print_job_id', v_print_job_id,
    'label_data', v_label
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_record_notification(p_request_id uuid, p_status text, p_provider text DEFAULT NULL::text, p_message_id text DEFAULT NULL::text, p_error text DEFAULT NULL::text, p_count_attempt boolean DEFAULT true, p_duration_ms integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_attempts integer;
begin
  if p_status not in ('pending', 'sending', 'sent', 'delivered', 'failed') then
    raise exception 'INVALID_NOTIFICATION_STATUS';
  end if;

  update public.quote_requests
     set notification_status = p_status,
         notification_provider = coalesce(p_provider, notification_provider),
         provider_message_id = coalesce(p_message_id, provider_message_id),
         notification_attempts = notification_attempts + case when p_count_attempt then 1 else 0 end,
         last_notification_attempt_at =
           case when p_count_attempt then now() else last_notification_attempt_at end,
         notification_sent_at =
           case when p_status in ('sent', 'delivered') then coalesce(notification_sent_at, now())
                else notification_sent_at end,
         notification_delivered_at =
           case when p_status = 'delivered' then now() else notification_delivered_at end,
         notification_failed_at =
           case when p_status = 'failed' then now() else notification_failed_at end,
         -- Truncated: this string is rendered in the admin panel, and a
         -- provider stack trace has no business being stored in full.
         last_notification_error =
           case when p_status = 'failed' then left(coalesce(p_error, 'unknown'), 500) else null end,
         -- Legacy column, kept in sync so nothing still reading it breaks.
         notification_email_sent = (p_status in ('sent', 'delivered')),
         notification_email_error =
           case when p_status = 'failed' then left(coalesce(p_error, 'unknown'), 500) else null end,
         notification_email_sent_at =
           case when p_status in ('sent', 'delivered') then coalesce(notification_email_sent_at, now())
                else notification_email_sent_at end
   where id = p_request_id
   returning notification_attempts into v_attempts;

  if v_attempts is null then
    return jsonb_build_object('updated', false);
  end if;

  insert into public.quote_request_events (quote_request_id, event_type, meta, duration_ms)
  values (
    p_request_id,
    case p_status
      when 'sent'      then 'notification_sent'
      when 'delivered' then 'notification_delivered'
      when 'failed'    then 'notification_failed'
      when 'sending'   then 'notification_attempted'
      else 'notification_pending'
    end,
    jsonb_strip_nulls(jsonb_build_object(
      'provider', p_provider,
      'message_id', p_message_id,
      'error', left(coalesce(p_error, ''), 300),
      'attempt', v_attempts
    )),
    p_duration_ms
  );

  return jsonb_build_object('updated', true, 'attempts', v_attempts);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_refresh_order_status(p_order_id uuid, p_operator text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare
  v_current text;
  v_total integer;
  v_received integer;
  v_stored integer;
  v_loaded integer;
  v_target text;
begin
  select status into v_current from public.orders where id = p_order_id;
  if v_current is null then return null; end if;

  if v_current in ('on_hold', 'cancelled', 'out_for_delivery', 'partially_delivered',
                   'delivered', 'returned') then
    return v_current;
  end if;

  select
    count(*),
    count(*) filter (where status in ('received', 'stored', 'ready_for_loading', 'loaded', 'out_for_delivery', 'delivered')),
    count(*) filter (where status in ('stored', 'ready_for_loading', 'loaded', 'out_for_delivery', 'delivered')),
    count(*) filter (where status in ('loaded', 'out_for_delivery', 'delivered'))
    into v_total, v_received, v_stored, v_loaded
    from public.inventory_units
   where order_id = p_order_id;

  if v_total = 0 then return v_current; end if;

  v_target := case
    when v_loaded = v_total then 'loaded'
    when v_loaded > 0 then 'partially_loaded'
    when v_stored = v_total then 'stored'
    when v_received > 0 or v_stored > 0 then 'partially_received'
    else 'expected'
  end;

  -- 'ready_for_loading' is an explicit human decision on top of 'stored'; don't
  -- undo it just because the derivation says 'stored'.
  if v_current = 'ready_for_loading' and v_target = 'stored' then
    return v_current;
  end if;

  if v_target <> v_current then
    update public.orders
       set status = v_target,
           received_at = case when v_target in ('partially_received') and received_at is null then now() else received_at end,
           stored_at = case when v_target = 'stored' and stored_at is null then now() else stored_at end,
           loaded_at = case when v_target = 'loaded' and loaded_at is null then now() else loaded_at end
     where id = p_order_id;

    insert into public.order_status_history (order_id, old_status, new_status, changed_by_label, notes)
    values (p_order_id, v_current, v_target, nullif(p_operator, ''), 'derived_from_units');
  end if;

  return v_target;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_remove_vehicle(p_vehicle_id uuid, p_operator text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_vehicle public.vehicles;
  v_reassigned integer;
begin
  select * into v_vehicle from public.vehicles where id = p_vehicle_id for update;
  if v_vehicle.id is null then
    return jsonb_build_object('ok', false, 'code', 'VEHICLE_NOT_FOUND');
  end if;
  if v_vehicle.active is false then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_REMOVED');
  end if;

  update public.orders
     set vehicle_id = null,
         delivery_sequence = null
   where vehicle_id = p_vehicle_id
     and status in (
       'confirmed', 'expected', 'partially_received', 'received', 'sorting',
       'stored', 'ready_for_loading', 'partially_loaded', 'loaded',
       'out_for_delivery', 'partially_delivered', 'on_hold'
     );
  get diagnostics v_reassigned = row_count;

  update public.vehicles set active = false where id = p_vehicle_id;

  return jsonb_build_object('ok', true, 'code', 'REMOVED', 'reassigned_orders', v_reassigned);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_requeue_stale_print_jobs(p_stale_after interval DEFAULT '00:05:00'::interval)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare
  v_count integer;
begin
  with requeued as (
    update public.print_jobs
       set status = 'pending', claimed_by = null, claimed_at = null
     where status = 'processing' and claimed_at < now() - p_stale_after
    returning 1
  )
  select count(*) into v_count from requeued;
  return coalesce(v_count, 0);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_retry_print_job(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_status text;
begin
  select status into v_status from public.print_jobs where id = p_job_id for update;
  if v_status is null then
    return jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND');
  end if;
  if v_status = 'printed' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_PRINTED');
  end if;

  -- A 'processing' job whose agent died is also retryable — that is the
  -- crashed-agent recovery path.
  update public.print_jobs
     set status = 'pending', claimed_by = null, claimed_at = null, error_message = null
   where id = p_job_id;

  return jsonb_build_object('ok', true, 'code', 'REQUEUED');
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_schema_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_missing_tables text[] := '{}';
  v_missing_columns text[] := '{}';
  v_missing_functions text[] := '{}';
  v_tbl text;
  v_fn text;
  v_col record;
begin
  foreach v_tbl in array array[
    'orders', 'order_items', 'order_documents', 'document_charges', 'app_settings',
    'geocode_cache', 'vehicles', 'drivers', 'client_offer_requests', 'order_status_history'
  ]
  loop
    if not exists (
      select 1 from information_schema.tables
       where table_schema = 'public' and table_name = v_tbl
    ) then
      v_missing_tables := array_append(v_missing_tables, v_tbl);
    end if;
  end loop;

  for v_col in
    select * from (values
      ('vehicles', 'capacity_units'), ('vehicles', 'display_order'), ('vehicles', 'color_key'),
      ('orders', 'delivery_sequence'), ('orders', 'normalized_document_number'),
      ('orders', 'ready_at'), ('orders', 'amount_collected'), ('orders', 'delivery_failure_reason'),
      ('drivers', 'current_vehicle_id')
    ) as t(tbl, col)
  loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = v_col.tbl and column_name = v_col.col
    ) then
      v_missing_columns := array_append(v_missing_columns, v_col.tbl || '.' || v_col.col);
    end if;
  end loop;

  foreach v_fn in array array[
    'gorush_create_order', 'gorush_set_order_status',
    'gorush_deliver_order', 'gorush_mark_order_loaded', 'gorush_mark_delivery_failed',
    'gorush_remove_vehicle'
  ]
  loop
    if not exists (
      select 1 from information_schema.routines
       where routine_schema = 'public' and routine_name = v_fn
    ) then
      v_missing_functions := array_append(v_missing_functions, v_fn);
    end if;
  end loop;

  return jsonb_build_object(
    'ok', array_length(v_missing_tables, 1) is null
      and array_length(v_missing_columns, 1) is null
      and array_length(v_missing_functions, 1) is null,
    'missing_tables', v_missing_tables,
    'missing_columns', v_missing_columns,
    'missing_functions', v_missing_functions,
    'checked_at', now()
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_set_order_status(p_order_id uuid, p_status text, p_reason text DEFAULT NULL::text, p_changed_by text DEFAULT NULL::text, p_planned_delivery_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_current text;
begin
  select status into v_current
    from public.orders where id = p_order_id for update;

  if v_current is null then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND');
  end if;

  if v_current = p_status and p_planned_delivery_date is null then
    return jsonb_build_object('ok', true, 'code', 'NO_CHANGE', 'status', v_current);
  end if;

  if p_status = 'on_hold' then
    update public.orders
       set status = 'on_hold', status_before_hold = v_current, held_at = now()
     where id = p_order_id;

  elsif p_status = 'cancelled' then
    update public.orders
       set status = 'cancelled', cancelled_at = now(), cancellation_reason = nullif(p_reason, '')
     where id = p_order_id;

  else
    update public.orders
       set status = p_status,
           held_at = null,
           status_before_hold = null,
           delivery_failure_reason = null,
           planned_delivery_date = coalesce(p_planned_delivery_date, planned_delivery_date),
           expected_at = coalesce(p_planned_delivery_date::timestamptz, expected_at),
           ready_at = case when p_status = 'ready_for_loading' then coalesce(ready_at, now()) else ready_at end
     where id = p_order_id;
  end if;

  insert into public.order_status_history (order_id, old_status, new_status, changed_by_label, notes)
  values (p_order_id, v_current, p_status, nullif(p_changed_by, ''), nullif(p_reason, ''));

  return jsonb_build_object(
    'ok', true, 'status', p_status, 'previous_status', v_current
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_store_unit(p_unit_token text, p_operator text DEFAULT NULL::text, p_zone_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_unit public.inventory_units;
  v_order public.orders;
  v_customer_name text;
  v_scan_type text := 'storage';
  v_result text := 'success';
  v_code text;
begin
  if nullif(p_idempotency_key, '') is not null
     and exists (select 1 from public.inventory_scans where idempotency_key = p_idempotency_key) then
    select u.* into v_unit from public.inventory_units u
      join public.inventory_scans s on s.inventory_unit_id = u.id
     where s.idempotency_key = p_idempotency_key limit 1;
    select * into v_order from public.orders where id = v_unit.order_id;
    return jsonb_build_object(
      'ok', true, 'code', 'ALREADY_PROCESSED',
      'inventory_unit_id', v_unit.id, 'status', v_unit.status,
      'order_number', v_order.order_number, 'stand_code', v_order.stand_code
    );
  end if;

  select * into v_unit from public.inventory_units
   where qr_token = trim(p_unit_token) for update;

  if v_unit.id is null then
    return jsonb_build_object('ok', false, 'code', 'UNIT_NOT_FOUND');
  end if;

  select * into v_order from public.orders where id = v_unit.order_id;
  select c.name into v_customer_name from public.customers c where c.id = v_order.customer_id;

  if v_unit.status = 'stored' then
    -- Duplicate scan: record a harmless audit entry, corrupt nothing.
    v_scan_type := 'inventory_check';
    v_result := 'duplicate';
    v_code := 'ALREADY_STORED';
  elsif v_unit.status in ('loaded', 'out_for_delivery', 'delivered') then
    v_scan_type := 'inventory_check';
    v_result := 'duplicate';
    v_code := 'ALREADY_MOVED_ON';
  else
    update public.inventory_units
       set status = 'stored',
           stored_at = now(),
           last_stand_code = coalesce(v_order.stand_code, last_stand_code),
           current_zone_id = coalesce(p_zone_id, current_zone_id),
           -- A unit scanned straight to storage without a prior supplier-label
           -- match still gets a received timestamp.
           received_at = coalesce(received_at, now())
     where id = v_unit.id
     returning * into v_unit;
    v_code := 'STORED';
  end if;

  insert into public.inventory_scans (
    inventory_unit_id, order_id, order_item_id, scan_type, result,
    raw_value, operator_session, stand_code, warehouse_zone_id,
    idempotency_key, device_type
  )
  values (
    v_unit.id, v_unit.order_id, v_unit.order_item_id, v_scan_type, v_result,
    trim(p_unit_token), nullif(p_operator, ''), v_order.stand_code, p_zone_id,
    nullif(p_idempotency_key, ''), 'handheld_scanner'
  );

  if v_code = 'STORED' then
    perform public.gorush_refresh_order_status(v_order.id, p_operator);
  end if;

  return jsonb_build_object(
    'ok', v_code = 'STORED',
    'code', v_code,
    'inventory_unit_id', v_unit.id,
    'unit_token', v_unit.qr_token,
    'status', v_unit.status,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'stand_code', v_order.stand_code,
    'customer', coalesce(v_customer_name, v_order.delivery_name, ''),
    'description', v_unit.description
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gorush_widen_value_check(target_table text, target_column text, constraint_name text, extra_values text[])
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  existing_values text[] := '{}';
  allowed_values text[] := '{}';
  merged text[];
  value_list text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = target_table and column_name = target_column
  ) then
    raise warning 'gorush_widen_value_check: %.% does not exist, skipping', target_table, target_column;
    return;
  end if;

  -- Values currently allowed by the constraint, parsed out of its definition.
  select coalesce(array_agg(m[1]), '{}')
    into allowed_values
    from pg_constraint c,
         regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''::text', 'g') as m
   where c.connamespace = 'public'::regnamespace
     and c.conname = constraint_name;

  -- Values actually stored, so an out-of-band value can never be orphaned.
  execute format(
    'select coalesce(array_agg(distinct %I), ''{}'') from public.%I where %I is not null',
    target_column, target_table, target_column
  ) into existing_values;

  select array_agg(distinct v order by v)
    into merged
    from unnest(allowed_values || existing_values || extra_values) as v;

  select string_agg(quote_literal(v), ', ') into value_list from unnest(merged) as v;

  execute format('alter table public.%I drop constraint if exists %I', target_table, constraint_name);
  execute format(
    'alter table public.%I add constraint %I check (%I = any (array[%s]))',
    target_table, constraint_name, target_column, value_list
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.is_valid_tyre_request(items jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  item jsonb;
begin
  if items is null or jsonb_typeof(items) <> 'array' then
    return false;
  end if;

  if jsonb_array_length(items) < 1
     or jsonb_array_length(items) > 20 then
    return false;
  end if;

  for item in
    select value
    from jsonb_array_elements(items)
  loop
    if not (
      item ? 'width'
      and item ? 'profile'
      and item ? 'rim'
      and item ? 'season'
      and item ? 'quantity'
    ) then
      return false;
    end if;

    if (item->>'width')::integer not between 100 and 500 then
      return false;
    end if;

    if (item->>'profile')::integer not between 20 and 100 then
      return false;
    end if;

    if (item->>'rim')::numeric not between 10 and 30 then
      return false;
    end if;

    if (item->>'quantity')::integer not between 1 and 100 then
      return false;
    end if;

    if item->>'season' not in (
      'summer',
      'winter',
      'all_season'
    ) then
      return false;
    end if;
  end loop;

  return true;
exception
  when others then
    return false;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
drop trigger if exists app_settings_set_updated_at on public.app_settings;
CREATE TRIGGER app_settings_set_updated_at BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists catalogue_conflicts_set_updated_at on public.catalogue_conflicts;
CREATE TRIGGER catalogue_conflicts_set_updated_at BEFORE UPDATE ON public.catalogue_conflicts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists catalogue_import_runs_set_updated_at on public.catalogue_import_runs;
CREATE TRIGGER catalogue_import_runs_set_updated_at BEFORE UPDATE ON public.catalogue_import_runs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists catalogue_products_set_updated_at on public.catalogue_products;
CREATE TRIGGER catalogue_products_set_updated_at BEFORE UPDATE ON public.catalogue_products FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists client_offer_requests_set_updated_at on public.client_offer_requests;
CREATE TRIGGER client_offer_requests_set_updated_at BEFORE UPDATE ON public.client_offer_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists customer_locations_set_updated_at on public.customer_locations;
CREATE TRIGGER customer_locations_set_updated_at BEFORE UPDATE ON public.customer_locations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists customers_set_updated_at on public.customers;
CREATE TRIGGER customers_set_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists drivers_set_updated_at on public.drivers;
CREATE TRIGGER drivers_set_updated_at BEFORE UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists inventory_incidents_set_updated_at on public.inventory_incidents;
CREATE TRIGGER inventory_incidents_set_updated_at BEFORE UPDATE ON public.inventory_incidents FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists inventory_units_set_updated_at on public.inventory_units;
CREATE TRIGGER inventory_units_set_updated_at BEFORE UPDATE ON public.inventory_units FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists order_documents_set_updated_at on public.order_documents;
CREATE TRIGGER order_documents_set_updated_at BEFORE UPDATE ON public.order_documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists order_items_set_updated_at on public.order_items;
CREATE TRIGGER order_items_set_updated_at BEFORE UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists orders_broadcast_change on public.orders;
CREATE TRIGGER orders_broadcast_change AFTER INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION gorush_broadcast_order_change();
drop trigger if exists orders_set_updated_at on public.orders;
CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists print_jobs_set_updated_at on public.print_jobs;
CREATE TRIGGER print_jobs_set_updated_at BEFORE UPDATE ON public.print_jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists quote_requests_broadcast_change on public.quote_requests;
CREATE TRIGGER quote_requests_broadcast_change AFTER INSERT OR UPDATE ON public.quote_requests FOR EACH ROW EXECUTE FUNCTION gorush_broadcast_quote_request_change();
drop trigger if exists quote_requests_set_updated_at on public.quote_requests;
CREATE TRIGGER quote_requests_set_updated_at BEFORE UPDATE ON public.quote_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists supplier_locations_set_updated_at on public.supplier_locations;
CREATE TRIGGER supplier_locations_set_updated_at BEFORE UPDATE ON public.supplier_locations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists supplier_product_listings_set_updated_at on public.supplier_product_listings;
CREATE TRIGGER supplier_product_listings_set_updated_at BEFORE UPDATE ON public.supplier_product_listings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists suppliers_set_updated_at on public.suppliers;
CREATE TRIGGER suppliers_set_updated_at BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists vehicles_broadcast_change on public.vehicles;
CREATE TRIGGER vehicles_broadcast_change AFTER INSERT OR UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION gorush_broadcast_vehicle_change();
drop trigger if exists vehicles_set_updated_at on public.vehicles;
CREATE TRIGGER vehicles_set_updated_at BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists warehouse_zones_set_updated_at on public.warehouse_zones;
CREATE TRIGGER warehouse_zones_set_updated_at BEFORE UPDATE ON public.warehouse_zones FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- CHECK constraints (last: one of them calls is_valid_tyre_request)
-- ---------------------------------------------------------------------------
alter table public.catalogue_conflicts add constraint catalogue_conflicts_status_chk CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text, 'dismissed'::text])));
alter table public.catalogue_conflicts add constraint catalogue_conflicts_type_chk CHECK ((conflict_type = ANY (ARRAY['ean_spec_mismatch'::text, 'product_ean_change'::text, 'weight_conflict'::text, 'manufacturer_code_conflict'::text, 'ambiguous_match'::text, 'duplicate_source_row'::text])));
alter table public.catalogue_import_rows add constraint catalogue_import_rows_action_chk CHECK (((action IS NULL) OR (action = ANY (ARRAY['insert_product'::text, 'insert_listing'::text, 'update_listing'::text, 'unchanged'::text, 'conflict'::text, 'rejected'::text, 'deactivate_listing'::text]))));
alter table public.catalogue_import_rows add constraint catalogue_import_rows_validation_chk CHECK ((validation_result = ANY (ARRAY['pending'::text, 'valid'::text, 'review'::text, 'rejected'::text])));
alter table public.catalogue_import_runs add constraint catalogue_import_runs_mode_chk CHECK ((import_mode = ANY (ARRAY['complete'::text, 'partial'::text, 'manual_correction'::text])));
alter table public.catalogue_import_runs add constraint catalogue_import_runs_status_chk CHECK ((status = ANY (ARRAY['uploaded'::text, 'analyzing'::text, 'previewed'::text, 'committing'::text, 'committed'::text, 'failed'::text, 'cancelled'::text])));
alter table public.catalogue_products add constraint catalogue_products_dimensions_chk CHECK ((((width_mm IS NULL) OR (width_mm > 0)) AND ((aspect_ratio IS NULL) OR (aspect_ratio > 0)) AND ((rim_inch IS NULL) OR (rim_inch > 0))));
alter table public.catalogue_products add constraint catalogue_products_ean_status_chk CHECK ((ean_status = ANY (ARRAY['valid'::text, 'recovered_leading_zero'::text, 'invalid_check_digit'::text, 'missing'::text])));
alter table public.catalogue_products add constraint catalogue_products_scan_ready_chk CHECK (((scan_ready = false) OR ((ean IS NOT NULL) AND (ean_status = ANY (ARRAY['valid'::text, 'recovered_leading_zero'::text])))));
alter table public.catalogue_products add constraint catalogue_products_weight_positive_chk CHECK (((weight_kg IS NULL) OR (weight_kg > (0)::numeric)));
alter table public.catalogue_products add constraint catalogue_products_weight_provenance_chk CHECK (((weight_kg IS NULL) = (weight_status <> 'supplier_reported'::text)));
alter table public.catalogue_products add constraint catalogue_products_weight_status_chk CHECK ((weight_status = ANY (ARRAY['supplier_reported'::text, 'missing_or_zero'::text])));
alter table public.client_offer_requests add constraint client_offer_requests_contact_type_check CHECK ((contact_type = ANY (ARRAY['email'::text, 'phone'::text])));
alter table public.client_offer_requests add constraint client_offer_requests_delivery_preference_check CHECK ((delivery_preference = ANY (ARRAY['any'::text, '24_hours'::text, '48_hours'::text, '7_days'::text])));
alter table public.client_offer_requests add constraint client_offer_requests_notification_email_status_check CHECK ((notification_email_status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text])));
alter table public.client_offer_requests add constraint client_offer_requests_status_check CHECK ((status = ANY (ARRAY['new'::text, 'reviewing'::text, 'quoted'::text, 'sent'::text, 'accepted'::text, 'rejected'::text, 'expired'::text, 'converted_to_order'::text, 'cancelled'::text])));
alter table public.client_offer_requests add constraint valid_client_offer_request_tyres CHECK (is_valid_tyre_request(tyres));
alter table public.document_charges add constraint document_charges_charge_type_check CHECK ((charge_type = ANY (ARRAY['PFU'::text, 'LOGISTICS_FEE'::text, 'TRANSPORT_FEE'::text, 'DISCOUNT'::text, 'VAT'::text, 'OTHER_FEE'::text])));
alter table public.inventory_incidents add constraint inventory_incidents_incident_type_check CHECK ((incident_type = ANY (ARRAY['customer_refusal'::text, 'damage'::text, 'defect'::text, 'disposed'::text, 'lost'::text, 'missing'::text, 'other'::text, 'quarantine'::text, 'return'::text, 'warranty'::text, 'wrong_delivery'::text, 'wrong_item'::text])));
alter table public.inventory_scans add constraint inventory_scans_result_chk CHECK ((result = ANY (ARRAY['success'::text, 'duplicate'::text, 'rejected'::text])));
alter table public.inventory_scans add constraint inventory_scans_scan_type_check CHECK ((scan_type = ANY (ARRAY['delivery'::text, 'found'::text, 'inventory_check'::text, 'loading'::text, 'manual_check'::text, 'manual_loading'::text, 'received'::text, 'return'::text, 'storage'::text, 'unloading'::text, 'zone_scan'::text])));
alter table public.inventory_units add constraint inventory_units_status_check CHECK ((status = ANY (ARRAY['expected'::text, 'received'::text, 'stored'::text, 'ready_for_loading'::text, 'loaded'::text, 'out_for_delivery'::text, 'delivered'::text, 'returned'::text, 'defective'::text, 'damaged'::text, 'missing'::text, 'lost'::text, 'quarantine'::text, 'disposed'::text])));
alter table public.inventory_units add constraint inventory_units_unit_type_check CHECK ((unit_type = ANY (ARRAY['tyre'::text, 'tube'::text, 'wheel'::text, 'accessory'::text, 'other'::text])));
alter table public.order_documents add constraint order_documents_extraction_status_check CHECK ((extraction_status = ANY (ARRAY['confirmed'::text, 'failed'::text, 'pending'::text, 'processing'::text, 'review_required'::text, 'unconfigured'::text])));
alter table public.order_documents add constraint order_documents_source_type_check CHECK ((source_type = ANY (ARRAY['pdf'::text, 'image'::text, 'manual'::text, 'email'::text])));
alter table public.order_items add constraint order_items_item_type_check CHECK ((item_type = ANY (ARRAY['tyre'::text, 'tube'::text, 'wheel'::text, 'accessory'::text, 'service'::text, 'fee'::text, 'other'::text])));
alter table public.order_items add constraint order_items_quantity_check CHECK ((quantity > 0));
alter table public.orders add constraint orders_payment_status_check CHECK ((payment_status = ANY (ARRAY['unknown'::text, 'not_required'::text, 'pending'::text, 'collected'::text, 'paid'::text, 'failed'::text])));
alter table public.orders add constraint orders_source_type_check CHECK ((source_type = ANY (ARRAY['pdf'::text, 'image'::text, 'manual'::text, 'email'::text])));
alter table public.orders add constraint orders_stand_code_chk CHECK (((stand_code IS NULL) OR (stand_code = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text, 'E'::text]))));
alter table public.orders add constraint orders_status_check CHECK ((status = ANY (ARRAY['cancelled'::text, 'confirmed'::text, 'delivered'::text, 'draft'::text, 'expected'::text, 'loaded'::text, 'on_hold'::text, 'out_for_delivery'::text, 'partially_delivered'::text, 'partially_loaded'::text, 'partially_received'::text, 'ready_for_loading'::text, 'received'::text, 'returned'::text, 'review_required'::text, 'sorting'::text, 'stored'::text])));
alter table public.print_jobs add constraint print_jobs_print_type_check CHECK ((print_type = ANY (ARRAY['order_label'::text, 'inventory_unit_label'::text, 'zone_label'::text, 'return_label'::text, 'other'::text])));
alter table public.print_jobs add constraint print_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'printed'::text, 'failed'::text, 'cancelled'::text])));
alter table public.product_identifiers add constraint product_identifiers_type_chk CHECK ((identifier_type = ANY (ARRAY['ean'::text, 'gtin'::text, 'manufacturer_code'::text, 'supplier_article_code'::text])));
alter table public.product_identifiers add constraint product_identifiers_validation_chk CHECK ((validation_status = ANY (ARRAY['valid'::text, 'recovered_leading_zero'::text, 'invalid_check_digit'::text, 'unverified'::text])));
alter table public.quote_request_items add constraint quote_request_items_brand_present CHECK (((preference_type IS DISTINCT FROM 'specific_brand'::text) OR ((preferred_brand IS NOT NULL) AND (length(btrim(preferred_brand)) > 0))));
alter table public.quote_request_items add constraint quote_request_items_delivery_speed_check CHECK ((delivery_speed = ANY (ARRAY['48h'::text, '7d'::text])));
alter table public.quote_request_items add constraint quote_request_items_other_description CHECK (((product_type <> 'other'::text) OR ((description IS NOT NULL) AND (length(btrim(description)) > 0))));
alter table public.quote_request_items add constraint quote_request_items_preference_type_check CHECK (((preference_type IS NULL) OR (preference_type = ANY (ARRAY['best_price'::text, 'specific_brand'::text]))));
alter table public.quote_request_items add constraint quote_request_items_product_type_check CHECK ((product_type = ANY (ARRAY['tyre'::text, 'other'::text])));
alter table public.quote_request_items add constraint quote_request_items_profile_check CHECK (((profile IS NULL) OR ((profile >= 20) AND (profile <= 100))));
alter table public.quote_request_items add constraint quote_request_items_quantity_check CHECK (((quantity > 0) AND (quantity <= 1000)));
alter table public.quote_request_items add constraint quote_request_items_rim_check CHECK (((rim IS NULL) OR ((rim >= 10) AND (rim <= 30))));
alter table public.quote_request_items add constraint quote_request_items_season_check CHECK (((season IS NULL) OR (season = ANY (ARRAY['summer'::text, 'winter'::text, 'all_season'::text]))));
alter table public.quote_request_items add constraint quote_request_items_tyre_dimensions CHECK (((product_type <> 'tyre'::text) OR ((width IS NOT NULL) AND (profile IS NOT NULL) AND (rim IS NOT NULL))));
alter table public.quote_request_items add constraint quote_request_items_width_check CHECK (((width IS NULL) OR ((width >= 100) AND (width <= 500))));
alter table public.quote_requests add constraint quote_requests_company_name_check CHECK ((length(btrim(company_name)) > 0));
alter table public.quote_requests add constraint quote_requests_contact_email_check CHECK ((length(btrim(contact_email)) > 0));
alter table public.quote_requests add constraint quote_requests_delivery_preference_check CHECK (((delivery_preference IS NULL) OR (delivery_preference = ANY (ARRAY['48h'::text, '7d'::text]))));
alter table public.quote_requests add constraint quote_requests_language_check CHECK ((language = ANY (ARRAY['it'::text, 'en'::text])));
alter table public.quote_requests add constraint quote_requests_notification_status_check CHECK ((notification_status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'delivered'::text, 'failed'::text])));
alter table public.quote_requests add constraint quote_requests_status_check CHECK ((status = ANY (ARRAY['submitted'::text, 'reviewing'::text, 'quote_preparing'::text, 'quote_ready'::text, 'sent'::text, 'accepted'::text, 'rejected'::text, 'expired'::text, 'archived'::text])));
alter table public.supplier_listing_prices add constraint supplier_listing_prices_price_chk CHECK (((purchase_price IS NULL) OR (purchase_price >= (0)::numeric)));
alter table public.vehicles add constraint vehicles_capacity_units_chk CHECK (((capacity_units IS NULL) OR (capacity_units > 0)));
alter table public.vehicles add constraint vehicles_color_key_chk CHECK (((color_key IS NULL) OR (color_key = ANY (ARRAY['blue'::text, 'purple'::text, 'teal'::text, 'indigo'::text, 'slate'::text, 'cyan'::text, 'rose'::text, 'amber'::text]))));
alter table public.warehouse_zones add constraint warehouse_zones_zone_type_check CHECK ((zone_type = ANY (ARRAY['sorting'::text, 'returns'::text, 'quarantine'::text, 'damaged'::text, 'loading'::text, 'storage'::text, 'other'::text])));
