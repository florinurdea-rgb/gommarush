-- GommaRush offer-request MVP schema.
-- Run this once in the Supabase SQL Editor (or via `supabase db push`).
-- Safe to re-run: every statement is idempotent (create-if-not-exists /
-- guarded do-blocks), except the base `create table`, which will simply
-- no-op if the table already exists.

create extension if not exists pgcrypto;

create sequence if not exists public.client_offer_request_sequence;

create table if not exists public.client_offer_requests (
  id uuid primary key default gen_random_uuid(),

  request_number text not null unique default (
    'GR-' ||
    extract(year from now())::integer::text ||
    '-' ||
    lpad(
      nextval('public.client_offer_request_sequence')::text,
      6,
      '0'
    )
  ),

  company_name text,

  contact_value text not null,

  contact_type text not null check (
    contact_type in ('email', 'phone')
  ),

  delivery_preference text not null default 'any' check (
    delivery_preference in (
      'any',
      '24_hours',
      '48_hours',
      '7_days'
    )
  ),

  tyres jsonb not null,

  customer_message text,

  status text not null default 'new' check (
    status in (
      'new',
      'reviewing',
      'quoted',
      'sent',
      'accepted',
      'rejected',
      'expired',
      'converted_to_order',
      'cancelled'
    )
  ),

  internal_notes text,

  notification_email_status text not null default 'pending' check (
    notification_email_status in (
      'pending',
      'sent',
      'failed'
    )
  ),

  notification_email_id text,
  notification_email_sent_at timestamptz,
  notification_email_error text,

  idempotency_key text unique,

  source text not null default 'website',

  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Validates the `tyres` jsonb array: must be a non-empty array of at most
-- 20 items, each with width/profile/rim/season/quantity within realistic
-- bounds. Mirrors the Zod schema in src/lib/validation/offer-request.ts —
-- keep both in sync if the rules ever change.
create or replace function public.is_valid_tyre_request(items jsonb)
returns boolean
language plpgsql
immutable
as $$
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
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'valid_client_offer_request_tyres'
  ) then
    alter table public.client_offer_requests
    add constraint valid_client_offer_request_tyres
    check (public.is_valid_tyre_request(tyres));
  end if;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists client_offer_requests_set_updated_at
on public.client_offer_requests;

create trigger client_offer_requests_set_updated_at
before update on public.client_offer_requests
for each row
execute function public.set_updated_at();

create index if not exists client_offer_requests_created_at_idx
on public.client_offer_requests(created_at desc);

create index if not exists client_offer_requests_status_idx
on public.client_offer_requests(status);

create index if not exists client_offer_requests_company_name_idx
on public.client_offer_requests(company_name);

create index if not exists client_offer_requests_contact_value_idx
on public.client_offer_requests(contact_value);

create index if not exists client_offer_requests_request_number_idx
on public.client_offer_requests(request_number);

create index if not exists client_offer_requests_tyres_gin_idx
on public.client_offer_requests
using gin (tyres);

-- Row Level Security: enabled with NO policies. This deliberately blocks
-- every anon/authenticated request from PostgREST (select/insert/update/
-- delete all deny-by-default once RLS is on and no policy grants them).
-- The only way to read or write this table is the service-role key,
-- which is confined to server-side code (see src/lib/supabase/server-admin.ts)
-- and bypasses RLS by design. A future admin dashboard should add its own
-- Supabase-Auth-scoped policies rather than opening this table up broadly.
alter table public.client_offer_requests enable row level security;
