-- ============================================================================
-- Retire the thermal-label print queue
-- ============================================================================
-- The print_jobs table existed so a separate desktop "GoRush Print Agent"
-- could poll for label jobs and drive a thermal printer. That agent, the
-- admin queue screen, its API route and the label renderer have all been
-- removed from the application; the office prints an order summary straight
-- from the browser instead, which needs no background service.
--
-- THE TABLE IS DELIBERATELY NOT DROPPED.
--
-- print_jobs holds a record of what was physically labelled and when, which
-- is operational history for orders that shipped. Removing a feature is not
-- a reason to destroy the records it produced, and unlike code, a dropped
-- table cannot be restored from git.
--
-- What this migration does instead:
--   * marks the table as deprecated in the data dictionary, so anyone
--     browsing the schema knows nothing writes to it any more;
--   * leaves RLS exactly as it was, so the data stays unreachable from the
--     browser.
--
-- When the business decides the history is no longer needed, dropping it is
-- a one-line follow-up migration:
--
--     drop table if exists public.print_jobs;
-- ============================================================================

do $$
begin
  if to_regclass('public.print_jobs') is not null then
    comment on table public.print_jobs is
      'DEPRECATED (2026-08-28): the thermal-label queue and its desktop Print Agent were removed. Retained for historical labelling records only — no application code reads or writes it. Safe to drop once that history is no longer needed.';
  end if;
end;
$$;
