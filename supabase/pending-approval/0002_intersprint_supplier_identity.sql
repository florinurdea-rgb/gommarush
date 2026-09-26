-- ============================================================================
-- STALE AS OF 2026-09-22 — DO NOT RUN, AND DO NOT "FIX" THE NUMBER.
-- ============================================================================
--
-- The guard below expects exactly 9,559 listings on this supplier. Since the
-- first real Inter-Sprint feed imports (runs ef834c00… PCR and 77b811d4…
-- truck) production holds 13,206. The guard therefore raises and refuses to
-- run, which is the correct failure — but it must NOT be repaired by editing
-- 9559 to 13206.
--
-- The count was never the point. It was a fingerprint tying this supplier row
-- to the specific evidence that proved it is Inter-Sprint (the sysnr MD5
-- match against the August feed). That evidence set has since changed, so a
-- replacement rename operation needs identity RE-VERIFIED against current
-- production first, and a fresh guard derived from that.
--
-- Superseded pending a reverification mission. Left in place as the record of
-- what was proven and when.
--
-- ----------------------------------------------------------------------------
-- ORIGINAL HEADER FOLLOWS
-- ----------------------------------------------------------------------------
--
-- PENDING OWNER APPROVAL — NOT APPLIED TO ANY ENVIRONMENT.
--
-- Renames the supplier record currently called 'asdas' to its real identity.
--
-- WHY THIS IS SAFE TO THE ROW AND STILL NEEDS APPROVAL
--
-- The evidence is deterministic, established in M8: the sorted sysnr set of
-- Inter-Sprint's vrd-pcr feed and the sorted supplier_article_id set of the
-- 9,559 listings on this supplier share the same MD5
-- (4901cdbd6bb6b4a3be9ef1db0ba9314b), the same sum, the same min and max;
-- source_row runs 2..9560 matching the file's data rows exactly; and
-- supplier_item_code reproduces the feed's itemcode byte for byte.
--
-- So the FACT is not in doubt. What needs approval is the ACT: this is a
-- production data mutation, and the correct legal name is a business detail
-- an agent should not choose. Replace the placeholder below before running.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
--   * It does not touch a single listing or product row. supplier_id is
--     already correct on all 9,559 listings — only the NAME was wrong — so
--     re-pointing anything would be a large, risky change to fix a label.
--   * It does not merge or delete the duplicate ZUIN / FINTYRE / CARLINI
--     records (D2). That is a separate decision with different consequences.
--   * It is guarded by the id, not by the name, so re-running it after a
--     rename cannot rename a different supplier by accident.
--
-- BEFORE RUNNING: take a backup, and confirm the row is the one described.
--
--   select id, name, created_at from public.suppliers
--   where id = '4ce0b557-9575-4784-aa80-99e78af4da2f';
--
--   select count(*) from public.supplier_product_listings
--   where supplier_id = '4ce0b557-9575-4784-aa80-99e78af4da2f';   -- expect 9559

begin;

-- Fails loudly rather than silently doing nothing if the row moved or was
-- already renamed by someone else.
do $$
declare
  v_name text;
  v_listings integer;
begin
  select name into v_name from public.suppliers
   where id = '4ce0b557-9575-4784-aa80-99e78af4da2f';

  if v_name is null then
    raise exception 'supplier 4ce0b557-9575-4784-aa80-99e78af4da2f does not exist; do not proceed';
  end if;

  if v_name <> 'asdas' then
    raise exception 'supplier 4ce0b557-9575-4784-aa80-99e78af4da2f is named %, not asdas; re-verify before renaming', v_name;
  end if;

  select count(*) into v_listings from public.supplier_product_listings
   where supplier_id = '4ce0b557-9575-4784-aa80-99e78af4da2f';

  if v_listings <> 9559 then
    raise exception 'expected 9559 listings on this supplier, found %; the evidence no longer matches', v_listings;
  end if;
end $$;

update public.suppliers
   set name = 'REPLACE_WITH_APPROVED_LEGAL_NAME'   -- e.g. 'Inter-Sprint Banden B.V.'
 where id = '4ce0b557-9575-4784-aa80-99e78af4da2f'
   and name = 'asdas';

-- Inspect the result, then COMMIT or ROLLBACK deliberately.
-- select id, name from public.suppliers where id = '4ce0b557-9575-4784-aa80-99e78af4da2f';

commit;
