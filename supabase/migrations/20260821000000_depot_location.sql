-- The warehouse's own coordinates, used as every vehicle's departure point
-- on the "Hartă" route view (src/components/logistics/RouteStopsModal.tsx).
-- Same app_settings key/value store as transport_rate_per_tyre — changeable
-- without a redeploy. The app also defaults to this exact value in code
-- (see getDepotLocation() in src/lib/server/settings.ts), so the map still
-- shows a departure point even before this migration has run.
insert into public.app_settings (key, value)
values ('depot_location', '{"lat": 45.508255, "lng": 11.511971}'::jsonb)
on conflict (key) do nothing;
