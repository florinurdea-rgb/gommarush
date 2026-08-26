-- ============================================================================
-- Retire the /get-offer flow (client_offer_requests)
-- ============================================================================
-- The older public quote form at /get-offer, its API route, its UI components
-- and its admin query layer have been removed from the application. The new
-- /richiedi-offerta flow (quote_requests + quote_request_items) replaces it.
--
-- THE TABLE IS DELIBERATELY NOT DROPPED.
--
-- client_offer_requests holds real customer enquiries — company names, contact
-- details and the tyres they asked for. Removing a feature is not a reason to
-- destroy the business records it produced, and unlike code, a dropped table
-- cannot be restored from git. It stays readable in the Supabase dashboard for
-- as long as those enquiries have any commercial or legal value.
--
-- What this migration does instead:
--   * marks the table and its sequence as deprecated in the data dictionary,
--     so anyone browsing the schema knows nothing writes to it any more;
--   * leaves RLS exactly as it was (on, no policies), so the data stays
--     unreachable from the browser.
--
-- No application code reads or writes this table after this change. When the
-- business decides the historical enquiries are no longer needed, dropping it
-- is a one-line follow-up migration:
--
--     drop table if exists public.client_offer_requests;
--     drop sequence if exists public.client_offer_request_sequence;
-- ============================================================================

do $$
begin
  if to_regclass('public.client_offer_requests') is not null then
    comment on table public.client_offer_requests is
      'DEPRECATED (2026-08-26): the /get-offer flow this served was removed and replaced by quote_requests + quote_request_items. Retained for historical customer enquiries only — no application code reads or writes it. Safe to drop once those records are no longer needed.';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1 from pg_class
     where relkind = 'S' and relname = 'client_offer_request_sequence'
  ) then
    comment on sequence public.client_offer_request_sequence is
      'DEPRECATED (2026-08-26): fed client_offer_requests.request_number. No longer advanced by any code path.';
  end if;
end;
$$;
