-- ============================================================================
-- Catalogue import: the transactional apply step
-- ============================================================================
-- Matching happens in TypeScript, where it is pure and unit-tested
-- (src/lib/catalogue/matching.ts). This function only APPLIES decisions that
-- have already been made, and its whole value is that it applies them inside
-- one transaction: a plpgsql body either completes or rolls back, so a batch
-- can never leave half a product behind.
--
-- Splitting it this way is deliberate. Matching rules change and need tests;
-- writing rows needs atomicity. Putting the rules in here would have given us
-- neither — an untestable matcher AND a transaction, when we can have a
-- tested matcher AND a transaction instead.
--
-- The caller commits in batches so no single request outlives Vercel's
-- limit. Each batch is atomic on its own, and catalogue_import_rows.committed_at
-- records exactly how far a run got, so an interrupted import resumes rather
-- than restarting or, worse, double-applying.
-- ============================================================================

create or replace function public.gorush_commit_catalogue_batch(payload jsonb)
returns jsonb
language plpgsql
as $fn$
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
$fn$;

comment on function public.gorush_commit_catalogue_batch(jsonb) is
  'Applies one batch of already-decided catalogue import operations atomically. Matching lives in TypeScript (src/lib/catalogue/matching.ts); this only writes.';
