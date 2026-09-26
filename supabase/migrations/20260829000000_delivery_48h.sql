-- ============================================================================
-- Delivery option: 24 hours becomes 48 hours
-- ============================================================================
-- The fast delivery option is now 48 hours rather than 24. The stored value
-- is renamed to match — '48h', not '24h' — because a value that says one
-- thing and means another is how a future reader gets it wrong.
--
-- Existing rows are migrated: any request that asked for '24h' asked for the
-- fast option, which is now 48 hours. No request loses its preference.
--
-- Constraint order matters. The CHECK has to be dropped before the UPDATE
-- can write the new value, and re-added afterwards — narrowing it first
-- would reject every row the update is about to produce.
-- ============================================================================

-- --- quote_request_items.delivery_speed -------------------------------------
alter table public.quote_request_items
  drop constraint if exists quote_request_items_delivery_speed_check;

update public.quote_request_items set delivery_speed = '48h' where delivery_speed = '24h';

alter table public.quote_request_items
  add constraint quote_request_items_delivery_speed_check
  check (delivery_speed in ('48h', '7d'));

-- --- quote_requests.delivery_preference -------------------------------------
alter table public.quote_requests
  drop constraint if exists quote_requests_delivery_preference_check;

update public.quote_requests set delivery_preference = '48h' where delivery_preference = '24h';

alter table public.quote_requests
  add constraint quote_requests_delivery_preference_check
  check (delivery_preference is null or delivery_preference in ('48h', '7d'));

comment on column public.quote_requests.delivery_preference is
  'Fastest delivery requested across the items (''48h'' or ''7d''), denormalised at insert time so the admin list can show and filter on it without joining items.';

-- --- the create RPC denormalises the fastest option --------------------------
-- Only the one expression changes; everything else is byte-identical to
-- 20260827000000 so the two can be diffed.
create or replace function public.gorush_create_quote_request(payload jsonb)
returns jsonb
language plpgsql
as $$
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
$$;

do $$
begin
  begin
    execute 'revoke all on function public.gorush_create_quote_request(jsonb) from anon, authenticated';
  exception when undefined_object then null;
  end;
end;
$$;
