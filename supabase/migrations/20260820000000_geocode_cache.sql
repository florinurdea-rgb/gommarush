-- Cache for the vehicle board's "Hartă" feature: geocoded delivery
-- addresses, keyed by a normalized address string so a repeat lookup never
-- re-hits the (free, rate-limited) OpenStreetMap Nominatim API.
create table if not exists public.geocode_cache (
  address_key text primary key,
  address_text text not null,
  latitude double precision not null,
  longitude double precision not null,
  created_at timestamptz not null default now()
);

alter table public.geocode_cache enable row level security;
