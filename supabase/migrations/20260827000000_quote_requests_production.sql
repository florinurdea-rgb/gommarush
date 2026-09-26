-- ============================================================================
-- Quote requests — production hardening
-- ============================================================================
-- Forward-only and additive. Nothing is dropped: 20260826000000 may already
-- be applied in some environments and may already hold real customer
-- enquiries, so every change here is a widening (new columns, new tables,
-- relaxed-then-migrated CHECK constraints) rather than a rewrite.
--
-- What this adds:
--   1. public_reference   — GR-YYMMDD-NNNN, assigned in-transaction
--   2. request-level fields: notes, delivery_preference, submitted_at
--   3. per-item season
--   4. the full quotation lifecycle, replacing the 3-value status
--   5. real notification state (status/provider/message id/attempts/times)
--   6. quote_request_events — append-only operational log + metrics source
--   7. quote_request_webhook_events — provider webhook idempotency
--   8. realtime broadcast on the existing 'gorush-ops' channel
--   9. indexes matching the admin list's actual query patterns
--
-- Safe to re-run: every statement is guarded.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. public_reference — GR-YYMMDD-NNNN
-- ---------------------------------------------------------------------------
-- A per-day counter rather than a global sequence, so the reference carries
-- the submission date (which is what a salesperson searching for "that
-- request from Tuesday" actually has) and does not leak a running total of
-- how many requests the business has ever received.
--
-- The counter row is locked by ON CONFLICT DO UPDATE, so two concurrent
-- submissions on the same day serialise rather than colliding.
create table if not exists public.quote_request_reference_counter (
  day date primary key,
  last_value integer not null default 0
);

comment on table public.quote_request_reference_counter is
  'Per-day counter backing quote_requests.public_reference (GR-YYMMDD-NNNN). One row per calendar day, Europe/Rome.';

create or replace function public.gorush_next_quote_reference()
returns text
language plpgsql
as $$
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
$$;

alter table public.quote_requests
  add column if not exists public_reference text;

-- Backfill any pre-existing rows deterministically (oldest first) so the
-- column can be made unique and non-null.
do $$
declare
  r record;
  v_day date;
  v_seq integer;
  v_last_day date := null;
begin
  for r in
    select id, created_at
      from public.quote_requests
     where public_reference is null
     order by created_at asc, id asc
  loop
    v_day := (r.created_at at time zone 'Europe/Rome')::date;
    if v_last_day is distinct from v_day then
      v_seq := 0;
      v_last_day := v_day;
    end if;
    v_seq := v_seq + 1;

    update public.quote_requests
       set public_reference = 'GR-' || to_char(v_day, 'YYMMDD') || '-' || lpad(v_seq::text, 4, '0')
     where id = r.id;

    -- Keep the live counter ahead of anything backfilled, or the next real
    -- submission would try to reuse a reference.
    insert into public.quote_request_reference_counter (day, last_value)
    values (v_day, v_seq)
    on conflict (day) do update
      set last_value = greatest(public.quote_request_reference_counter.last_value, excluded.last_value);
  end loop;
end;
$$;

create unique index if not exists quote_requests_public_reference_idx
  on public.quote_requests (public_reference);

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'quote_requests'
       and column_name = 'public_reference' and is_nullable = 'YES'
  ) and not exists (select 1 from public.quote_requests where public_reference is null)
  then
    alter table public.quote_requests alter column public_reference set not null;
  end if;
end;
$$;

comment on column public.quote_requests.request_number is
  'LEGACY (superseded 2026-08-27) by public_reference. Retained so existing rows and any external reference to GR-1000-style numbers still resolve. Not shown in the UI.';

-- ---------------------------------------------------------------------------
-- 2. Request-level fields
-- ---------------------------------------------------------------------------
alter table public.quote_requests
  add column if not exists notes text,
  add column if not exists delivery_preference text,
  add column if not exists submitted_at timestamptz;

update public.quote_requests
   set submitted_at = created_at
 where submitted_at is null;

alter table public.quote_requests
  alter column submitted_at set default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'quote_requests_delivery_preference_check'
  ) then
    alter table public.quote_requests
      add constraint quote_requests_delivery_preference_check
      check (delivery_preference is null or delivery_preference in ('24h', '7d'));
  end if;
end;
$$;

comment on column public.quote_requests.delivery_preference is
  'Fastest delivery requested across the items, denormalised at insert time so the admin list can show and filter on it without joining items.';
comment on column public.quote_requests.notes is
  'Optional free-text note from the customer ("Note aggiuntive"). Never interpreted, only displayed and exported.';

-- ---------------------------------------------------------------------------
-- 3. Per-item season
-- ---------------------------------------------------------------------------
alter table public.quote_request_items
  add column if not exists season text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quote_request_items_season_check') then
    alter table public.quote_request_items
      add constraint quote_request_items_season_check
      check (season is null or season in ('summer', 'winter', 'all_season'));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Quotation lifecycle
-- ---------------------------------------------------------------------------
-- Drop the old 3-value constraint, migrate the data, then re-constrain. The
-- order matters: the UPDATE cannot produce the new values while the old
-- CHECK is still in force.
alter table public.quote_requests drop constraint if exists quote_requests_status_check;

update public.quote_requests set status = 'submitted' where status = 'new';
update public.quote_requests set status = 'reviewing'  where status = 'in_progress';
update public.quote_requests set status = 'sent'       where status = 'offer_sent';

alter table public.quote_requests
  add constraint quote_requests_status_check check (
    status in (
      'submitted', 'reviewing', 'quote_preparing', 'quote_ready',
      'sent', 'accepted', 'rejected', 'expired', 'archived'
    )
  );

alter table public.quote_requests alter column status set default 'submitted';

-- ---------------------------------------------------------------------------
-- 5. Notification state
-- ---------------------------------------------------------------------------
-- Denormalised current state lives on the row because the admin list renders
-- it for every request and a join per row would be an N+1. The full history
-- lives in quote_request_events. Both, deliberately — neither alone answers
-- "what is the state now" and "what happened" at acceptable cost.
alter table public.quote_requests
  add column if not exists notification_status text not null default 'pending',
  add column if not exists notification_provider text,
  add column if not exists provider_message_id text,
  add column if not exists notification_attempts integer not null default 0,
  add column if not exists last_notification_attempt_at timestamptz,
  -- Distinct from the legacy notification_email_sent_at: this one is
  -- provider-agnostic, so a future channel (WhatsApp, SMS) records here too.
  add column if not exists notification_sent_at timestamptz,
  add column if not exists notification_delivered_at timestamptz,
  add column if not exists notification_failed_at timestamptz,
  add column if not exists last_notification_error text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quote_requests_notification_status_check') then
    alter table public.quote_requests
      add constraint quote_requests_notification_status_check
      check (notification_status in ('pending', 'sending', 'sent', 'delivered', 'failed'));
  end if;
end;
$$;

-- Carry the old boolean's meaning forward for any row that predates this.
update public.quote_requests
   set notification_status = case
         when notification_email_sent then 'sent'
         when notification_email_error is not null then 'failed'
         else 'pending'
       end,
       last_notification_error = coalesce(last_notification_error, notification_email_error),
       notification_sent_at = coalesce(notification_sent_at, notification_email_sent_at),
       notification_attempts = case
         when notification_email_sent or notification_email_error is not null then 1 else 0
       end
 where notification_status = 'pending'
   and (notification_email_sent or notification_email_error is not null);

comment on column public.quote_requests.notification_email_sent is
  'LEGACY (superseded 2026-08-27) by notification_status. Kept in sync by the application so nothing that still reads it breaks.';

-- ---------------------------------------------------------------------------
-- 6. quote_request_events — append-only operational log
-- ---------------------------------------------------------------------------
-- This is what makes §34 answerable: did it arrive, when, was it saved, did
-- the mail send, was it delivered, why not, how many retries, how long did
-- each stage take. Rows are never updated or deleted.
create table if not exists public.quote_request_events (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid references public.quote_requests(id) on delete cascade,

  event_type text not null,
  -- Small, non-PII detail (error codes, provider ids, counts). The customer's
  -- own data is never copied in here — it is already in quote_requests.
  meta jsonb not null default '{}'::jsonb,
  -- Server-side stage timing, for the p50/p95 view.
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists quote_request_events_request_idx
  on public.quote_request_events (quote_request_id, created_at desc);
create index if not exists quote_request_events_type_time_idx
  on public.quote_request_events (event_type, created_at desc);

-- ---------------------------------------------------------------------------
-- 7. Webhook idempotency
-- ---------------------------------------------------------------------------
-- A provider will redeliver the same event; the unique key is what makes
-- processing it twice a no-op instead of double-counting a delivery.
create table if not exists public.quote_request_webhook_events (
  provider text not null,
  event_id text not null,
  event_type text,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

-- ---------------------------------------------------------------------------
-- 8. Realtime — reuse the existing 'gorush-ops' broadcast channel
-- ---------------------------------------------------------------------------
create or replace function public.gorush_broadcast_quote_request_change()
returns trigger language plpgsql as $$
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
$$;

drop trigger if exists quote_requests_broadcast_change on public.quote_requests;
create trigger quote_requests_broadcast_change
  after insert or update on public.quote_requests
  for each row execute function public.gorush_broadcast_quote_request_change();

-- ---------------------------------------------------------------------------
-- 9. Indexes for the admin list's real query patterns
-- ---------------------------------------------------------------------------
-- Deliberately narrow: status/created_at/notification_status are the filters
-- the UI actually offers, and the two lower() indexes back the search box's
-- prefix matching. No speculative indexes.
create index if not exists quote_requests_notification_status_idx
  on public.quote_requests (notification_status);
create index if not exists quote_requests_status_created_idx
  on public.quote_requests (status, created_at desc);
create index if not exists quote_requests_company_lower_idx
  on public.quote_requests (lower(company_name) text_pattern_ops);
create index if not exists quote_requests_email_lower_idx
  on public.quote_requests (lower(contact_email) text_pattern_ops);

alter table public.quote_request_events enable row level security;
alter table public.quote_request_webhook_events enable row level security;
alter table public.quote_request_reference_counter enable row level security;

-- ---------------------------------------------------------------------------
-- 10. gorush_create_quote_request — replaced, same transactional guarantee
-- ---------------------------------------------------------------------------
-- Still one plpgsql body = one transaction: either the request, all of its
-- items and its 'request_persisted' event exist, or none of them do.
--
-- Still SECURITY INVOKER: Postgres grants EXECUTE to PUBLIC by default, so
-- SECURITY DEFINER would hand the anon key a write path straight through RLS.
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

  -- Replay of an already-accepted submission: return the original untouched.
  -- This is the database-level half of idempotency; the disabled button is
  -- only cosmetic and is never relied on.
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

  -- Fastest delivery across the items, denormalised onto the request.
  select case when bool_or(coalesce(item->>'delivery_speed', '') = '24h') then '24h' else '7d' end
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

-- ---------------------------------------------------------------------------
-- 11. gorush_record_notification — one atomic attempt record
-- ---------------------------------------------------------------------------
-- Incrementing the attempt counter and writing the outcome must be a single
-- statement, or two concurrent retries both read 3 and both write 4.
create or replace function public.gorush_record_notification(
  p_request_id uuid,
  p_status text,
  p_provider text default null,
  p_message_id text default null,
  p_error text default null,
  p_count_attempt boolean default true,
  p_duration_ms integer default null
)
returns jsonb
language plpgsql
as $$
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
$$;

-- ---------------------------------------------------------------------------
-- 12. gorush_log_quote_event — events with no request row yet
-- ---------------------------------------------------------------------------
-- Submission attempts that never became a request (validation failures,
-- persistence failures) still need to be counted, or the reliability metric
-- silently only ever sees successes.
create or replace function public.gorush_log_quote_event(
  p_event_type text,
  p_request_id uuid default null,
  p_meta jsonb default '{}'::jsonb,
  p_duration_ms integer default null
)
returns void
language plpgsql
as $$
begin
  insert into public.quote_request_events (quote_request_id, event_type, meta, duration_ms)
  values (p_request_id, p_event_type, coalesce(p_meta, '{}'::jsonb), p_duration_ms);
end;
$$;

do $$
begin
  begin
    execute 'revoke all on function public.gorush_create_quote_request(jsonb) from anon, authenticated';
    execute 'revoke all on function public.gorush_record_notification(uuid, text, text, text, text, boolean, integer) from anon, authenticated';
    execute 'revoke all on function public.gorush_log_quote_event(text, uuid, jsonb, integer) from anon, authenticated';
    execute 'revoke all on function public.gorush_next_quote_reference() from anon, authenticated';
  exception when undefined_object then null;
  end;
end;
$$;
