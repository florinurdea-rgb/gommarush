-- Baseline correction (applied to staging as migration baseline_04_function_fidelity_fix).
--
-- is_valid_tyre_request was initially captured from this repository's
-- 20260804000000_client_offer_requests.sql rather than from production. The two
-- are semantically identical but textually different: production keeps the
-- season check on a single line, the repository spreads it over five.
--
-- Precedence (CLAUDE.md section 0): a proven production fact outranks the
-- repository. Replaced with production's exact prosrc.
--
-- NOTE: 20260921120000_baseline_02_functions.sql has also been corrected, so a
-- fresh rebuild from the baseline no longer needs this file. It is retained
-- because it IS in the staging ledger, and the repository must mirror it.
set search_path = "$user", public, extensions;

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

    if item->>'season' not in ('summer', 'winter', 'all_season') then
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
