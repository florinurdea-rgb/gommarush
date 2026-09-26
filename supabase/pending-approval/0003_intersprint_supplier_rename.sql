-- PENDING OWNER APPROVAL — NOT APPLIED TO ANY ENVIRONMENT.
--
-- Renames supplier 4ce0b557-9575-4784-aa80-99e78af4da2f to 'Inter-Sprint'.
--
-- REPLACES 0002, which guarded on an exact listing count of 9,559. That count
-- was mutable and went stale the moment the first real feed imported (13,206
-- and rising). This version guards on PROVENANCE, which does not change when a
-- feed runs.
--
-- WHY THIS SUPPLIER, ON EVIDENCE RE-ESTABLISHED 2026-09-22:
--
--   * exactly ONE supplier has an Inter-Sprint import run (adapter
--     'intersprint-feed' or 'isb') — this one;
--   * exactly ONE supplier holds any 'ISB:'-prefixed listing key — this one;
--   * ALL of its listings are 'ISB:'-keyed, none are anything else;
--   * no supplier is already called Inter-Sprint, so no collision is possible.
--
-- WHY 'Inter-Sprint' AND NOT A LEGAL ENTITY NAME:
-- nothing in this repository establishes one, and a supplier label does not
-- require one. Do not substitute an invented 'B.V.'/'N.V.' form.
--
-- PROPERTIES:
--   * IDEMPOTENT — re-running after success is a no-op, not an error.
--   * ROLLBACKABLE — one column on one row; the rollback is at the bottom.
--   * NARROW — touches no listing, product, identifier, price or order row.
--     supplier_id was always correct; only the label was wrong.
--
-- BEFORE RUNNING: take a backup, and read the verification block's output.

begin;

do $$
declare
  v_id          constant uuid := '4ce0b557-9575-4784-aa80-99e78af4da2f';
  v_target      constant text := 'Inter-Sprint';
  v_name        text;
  v_isb_keys    integer;
  v_other_keys  integer;
  v_runs        integer;
  v_rival_keys  integer;
  v_rival_runs  integer;
  v_collision   integer;
begin
  select name into v_name from public.suppliers where id = v_id;

  if v_name is null then
    raise exception 'supplier % does not exist; stop and re-verify identity', v_id;
  end if;

  -- Idempotency: already done is success, not failure.
  if v_name = v_target then
    raise notice 'supplier % is already named %; nothing to do', v_id, v_target;
    return;
  end if;

  -- Provenance, not counts.
  select count(*) into v_isb_keys
    from public.supplier_product_listings
   where supplier_id = v_id and supplier_listing_key like 'ISB:%';

  select count(*) into v_other_keys
    from public.supplier_product_listings
   where supplier_id = v_id and supplier_listing_key not like 'ISB:%';

  select count(*) into v_runs
    from public.catalogue_import_runs
   where supplier_id = v_id and adapter in ('intersprint-feed', 'isb');

  -- Nothing else may look like Inter-Sprint.
  select count(distinct supplier_id) into v_rival_keys
    from public.supplier_product_listings
   where supplier_listing_key like 'ISB:%' and supplier_id <> v_id;

  select count(distinct supplier_id) into v_rival_runs
    from public.catalogue_import_runs
   where adapter in ('intersprint-feed', 'isb') and supplier_id <> v_id;

  select count(*) into v_collision
    from public.suppliers where name = v_target and id <> v_id;

  if v_isb_keys = 0 then
    raise exception 'supplier % holds no ISB: listing keys; this is not the Inter-Sprint row', v_id;
  end if;
  if v_other_keys > 0 then
    raise exception 'supplier % holds % non-ISB listing keys; it is not exclusively Inter-Sprint', v_id, v_other_keys;
  end if;
  if v_runs = 0 then
    raise exception 'supplier % has no Inter-Sprint import run; provenance is not established', v_id;
  end if;
  if v_rival_keys > 0 or v_rival_runs > 0 then
    raise exception 'another supplier also carries Inter-Sprint evidence (% by key, % by run); identity is no longer unique', v_rival_keys, v_rival_runs;
  end if;
  if v_collision > 0 then
    raise exception 'a different supplier is already named %; merge first', v_target;
  end if;

  raise notice 'verified: % ISB listings, % Inter-Sprint runs, no rival, no collision. Renaming % -> %',
    v_isb_keys, v_runs, v_name, v_target;

  update public.suppliers set name = v_target where id = v_id;
end $$;

-- Inspect, then COMMIT or ROLLBACK deliberately.
--   select id, name, updated_at from public.suppliers
--    where id = '4ce0b557-9575-4784-aa80-99e78af4da2f';
--
-- ROLLBACK AFTER COMMIT, if ever needed:
--   update public.suppliers set name = 'asdas'
--    where id = '4ce0b557-9575-4784-aa80-99e78af4da2f' and name = 'Inter-Sprint';

commit;
