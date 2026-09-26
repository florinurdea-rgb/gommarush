-- ============================================================================
-- Durable document-analysis queue
-- ============================================================================
-- Analysis used to run inside the HTTP request that uploaded the file, with a
-- provider timeout equal to the route's own budget. When the function was
-- killed, the work vanished: no record of the attempt, no error, nothing to
-- retry, and the operator watching a spinner learned only that it had stopped.
--
-- This makes the work a row. A request enqueues; a scheduled worker leases,
-- runs and completes. A killed worker loses its lease and the job is picked up
-- again, because the row outlives the function.
--
-- Four functions, and the reason each is a function rather than app code:
--
--   gorush_enqueue_document_analysis   file-level idempotency has to be
--     race-safe. Two concurrent uploads of one file must produce one analysis,
--     which needs the uniqueness check and the insert in one statement.
--   gorush_lease_document_analysis     claiming has to be atomic, or two
--     workers run the same job. FOR UPDATE SKIP LOCKED is the only correct
--     way to express that.
--   gorush_store_document_analysis_result  the extracted lines and the
--     analysis status must land together. Separately, a crash between them
--     leaves an analysis that looks complete with lines missing — exactly the
--     silent loss the line table exists to prevent. It also REFUSES a payload
--     whose line count disagrees with its own declared total, so the
--     invariant is enforced by the database and not merely by the caller.
--   gorush_fail_document_analysis      a failure must be persisted before the
--     request returns, with the retry decision made in one place.
--
-- ROLLBACK NOTE: forward-only. To undo, drop the four functions and the
-- columns added below; document_analyses rows remain readable.
-- ============================================================================

-- Retry scheduling. Bounded backoff, and a deterministic validation failure
-- is never retried — see gorush_fail_document_analysis.
alter table public.document_analyses add column if not exists next_attempt_at timestamptz;
alter table public.document_analyses add column if not exists max_attempts integer not null default 3;
alter table public.document_analyses add column if not exists last_error_code text;
alter table public.document_analyses add column if not exists retryable boolean;

create index if not exists document_analyses_claimable_idx
  on public.document_analyses (status, next_attempt_at)
  where status in ('QUEUED', 'EXTRACTING');

-- ---------------------------------------------------------------------------
-- Enqueue, with race-safe file-level idempotency
-- ---------------------------------------------------------------------------
create or replace function public.gorush_enqueue_document_analysis(payload jsonb)
returns jsonb
language plpgsql
as $fn$
declare
  v_source_document_id uuid;
  v_source_hash text;
  v_created_by text;
  v_correlation_id text;
  v_existing_id uuid;
  v_existing_status text;
  v_existing_order_id uuid;
  v_id uuid;
begin
  if payload is null then
    raise exception 'MISSING_PAYLOAD';
  end if;

  v_source_document_id := nullif(payload ->> 'sourceDocumentId', '')::uuid;
  v_source_hash := nullif(payload ->> 'sourceHash', '');
  v_created_by := nullif(payload ->> 'createdBy', '');
  v_correlation_id := nullif(payload ->> 'correlationId', '');

  if v_source_document_id is null then
    raise exception 'MISSING_SOURCE_DOCUMENT';
  end if;
  if v_source_hash is null then
    -- Without the hash there is no file identity and no idempotency. Refusing
    -- is better than accepting a job that can silently duplicate.
    raise exception 'MISSING_SOURCE_HASH';
  end if;

  -- Same bytes seen before? Return that analysis instead of making another.
  -- The filename is deliberately not consulted: the same file arrives under
  -- many names, and a different file can arrive under the same one.
  select a.id, a.status into v_existing_id, v_existing_status
  from public.document_analyses a
  where a.source_hash = v_source_hash
    and a.status <> 'CANCELLED'
  order by a.created_at asc
  limit 1;

  if v_existing_id is not null then
    select i.order_id into v_existing_order_id
    from public.document_import_idempotency i
    where i.document_analysis_id = v_existing_id and i.order_id is not null
    order by i.created_at desc
    limit 1;

    return jsonb_build_object(
      'analysisId', v_existing_id,
      'status', v_existing_status,
      'alreadySeen', true,
      'existingOrderId', v_existing_order_id
    );
  end if;

  insert into public.document_analyses (
    source_document_id, source_hash, status, created_by, correlation_id,
    next_attempt_at
  )
  values (
    v_source_document_id, v_source_hash, 'QUEUED', v_created_by, v_correlation_id,
    now()
  )
  returning id into v_id;

  update public.order_documents
    set source_hash = v_source_hash,
        upload_status = 'UPLOADED'
    where id = v_source_document_id
      and (source_hash is null or source_hash = v_source_hash);

  return jsonb_build_object(
    'analysisId', v_id,
    'status', 'QUEUED',
    'alreadySeen', false,
    'existingOrderId', null
  );
exception
  -- Two concurrent uploads of the same bytes: the loser of the unique index
  -- resolves the winner rather than failing the operator's upload.
  when unique_violation then
    select a.id, a.status into v_existing_id, v_existing_status
    from public.document_analyses a
    where a.source_hash = v_source_hash
    order by a.created_at asc
    limit 1;

    if v_existing_id is null then
      raise;
    end if;

    return jsonb_build_object(
      'analysisId', v_existing_id,
      'status', v_existing_status,
      'alreadySeen', true,
      'existingOrderId', null
    );
end;
$fn$;

comment on function public.gorush_enqueue_document_analysis(jsonb) is
  'Enqueues an analysis, returning an existing one for identical bytes. Race-safe: concurrent uploads of one file yield one analysis.';

-- ---------------------------------------------------------------------------
-- Lease one job
-- ---------------------------------------------------------------------------
create or replace function public.gorush_lease_document_analysis(payload jsonb)
returns jsonb
language plpgsql
as $fn$
declare
  v_worker text;
  v_lease_seconds integer;
  v_id uuid;
  v_row public.document_analyses;
begin
  v_worker := coalesce(nullif(payload ->> 'worker', ''), 'worker');
  v_lease_seconds := coalesce((payload ->> 'leaseSeconds')::integer, 240);

  -- SKIP LOCKED is what makes two concurrent workers safe: each takes a
  -- different row instead of blocking on, or duplicating, the same one.
  -- An EXTRACTING row whose lease has expired is reclaimable — that is the
  -- case where a serverless function was killed mid-run.
  select a.id into v_id
  from public.document_analyses a
  where a.status in ('QUEUED', 'EXTRACTING')
    and (a.lease_expires_at is null or a.lease_expires_at < now())
    and (a.next_attempt_at is null or a.next_attempt_at <= now())
    and a.attempts < a.max_attempts
  order by a.created_at asc
  for update skip locked
  limit 1;

  if v_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  update public.document_analyses
    set status = 'EXTRACTING',
        attempts = attempts + 1,
        lease_owner = v_worker,
        lease_expires_at = now() + make_interval(secs => v_lease_seconds)
    where id = v_id
    returning * into v_row;

  return jsonb_build_object(
    'claimed', true,
    'analysisId', v_row.id,
    'sourceDocumentId', v_row.source_document_id,
    'sourceHash', v_row.source_hash,
    'attempts', v_row.attempts,
    'maxAttempts', v_row.max_attempts,
    'correlationId', v_row.correlation_id
  );
end;
$fn$;

comment on function public.gorush_lease_document_analysis(jsonb) is
  'Atomically claims one analysis via FOR UPDATE SKIP LOCKED. Reclaims rows whose lease expired, which is how a killed worker is recovered.';

-- ---------------------------------------------------------------------------
-- Store the result: extraction, every line, and the status, together
-- ---------------------------------------------------------------------------
create or replace function public.gorush_store_document_analysis_result(payload jsonb)
returns jsonb
language plpgsql
as $fn$
declare
  v_id uuid;
  v_status text;
  v_declared_line_count integer;
  v_line jsonb;
  v_inserted integer := 0;
begin
  if payload is null then
    raise exception 'MISSING_PAYLOAD';
  end if;

  v_id := nullif(payload ->> 'analysisId', '')::uuid;
  v_status := nullif(payload ->> 'status', '');
  v_declared_line_count := coalesce((payload ->> 'sourceLineCount')::integer, -1);

  if v_id is null then raise exception 'MISSING_ANALYSIS_ID'; end if;
  if v_status is null then raise exception 'MISSING_STATUS'; end if;
  if v_declared_line_count < 0 then raise exception 'MISSING_SOURCE_LINE_COUNT'; end if;

  -- Re-running a completed job must not duplicate its lines. The delete makes
  -- the whole function replayable: a worker that died after inserting some
  -- lines can run again and land in the same state.
  delete from public.document_extracted_lines where document_analysis_id = v_id;

  for v_line in select * from jsonb_array_elements(coalesce(payload -> 'lines', '[]'::jsonb))
  loop
    insert into public.document_extracted_lines (
      document_analysis_id, source_document_index, source_page, source_line_index,
      raw_description, raw_values_json, normalized_values_json,
      ai_item_type_hint, deterministic_classification, final_classification,
      classification_source, field_confidences_json,
      validation_status, validation_issues_json, resolution_action
    )
    values (
      v_id,
      coalesce((v_line ->> 'sourceDocumentIndex')::integer, 0),
      (v_line ->> 'sourcePage')::integer,
      (v_line ->> 'sourceLineIndex')::integer,
      v_line ->> 'rawDescription',
      v_line -> 'rawValues',
      v_line -> 'normalizedValues',
      nullif(v_line ->> 'aiItemTypeHint', ''),
      nullif(v_line ->> 'deterministicClassification', ''),
      nullif(v_line ->> 'finalClassification', ''),
      nullif(v_line ->> 'classificationSource', ''),
      v_line -> 'fieldConfidences',
      coalesce(nullif(v_line ->> 'validationStatus', ''), 'PENDING'),
      v_line -> 'validationIssues',
      coalesce(nullif(v_line ->> 'resolutionAction', ''), 'UNRESOLVED')
    );
    v_inserted := v_inserted + 1;
  end loop;

  -- THE INVARIANT, enforced here rather than trusted from the caller.
  --
  -- If the application dropped a line anywhere between extraction and this
  -- call, the counts disagree and the whole transaction rolls back. An
  -- analysis can therefore never be marked complete while holding fewer lines
  -- than the document produced.
  if v_inserted <> v_declared_line_count then
    raise exception 'LINE_COUNT_MISMATCH: declared % but stored %',
      v_declared_line_count, v_inserted;
  end if;

  update public.document_analyses
    set status = v_status,
        raw_extraction = coalesce(payload -> 'rawExtraction', raw_extraction),
        normalized_extraction = coalesce(payload -> 'normalizedExtraction', normalized_extraction),
        source_document_count = coalesce((payload ->> 'sourceDocumentCount')::integer, source_document_count),
        page_count = coalesce((payload ->> 'pageCount')::integer, page_count),
        provider = coalesce(nullif(payload ->> 'provider', ''), provider),
        model = coalesce(nullif(payload ->> 'model', ''), model),
        prompt_version = coalesce(nullif(payload ->> 'promptVersion', ''), prompt_version),
        schema_version = coalesce(nullif(payload ->> 'schemaVersion', ''), schema_version),
        validator_version = coalesce(nullif(payload ->> 'validatorVersion', ''), validator_version),
        latency_ms = coalesce((payload ->> 'latencyMs')::integer, latency_ms),
        input_tokens = coalesce((payload ->> 'inputTokens')::integer, input_tokens),
        output_tokens = coalesce((payload ->> 'outputTokens')::integer, output_tokens),
        warnings = coalesce(
          (select array_agg(value::text) from jsonb_array_elements_text(coalesce(payload -> 'warnings', '[]'::jsonb)) as value),
          warnings
        ),
        error_summary = nullif(payload ->> 'errorSummary', ''),
        -- The lease is released on completion so nothing reclaims a finished job.
        lease_owner = null,
        lease_expires_at = null,
        version = version + 1,
        completed_at = case when v_status in ('READY', 'NEEDS_REVIEW', 'DUPLICATE', 'FAILED') then now() else completed_at end
    where id = v_id;

  if not found then
    raise exception 'ANALYSIS_NOT_FOUND';
  end if;

  return jsonb_build_object('analysisId', v_id, 'status', v_status, 'storedLines', v_inserted);
end;
$fn$;

comment on function public.gorush_store_document_analysis_result(jsonb) is
  'Atomically stores the extraction, every source line and the status. REFUSES a payload whose stored line count differs from its declared count, so the accounting invariant is a database guarantee.';

-- ---------------------------------------------------------------------------
-- Record a failure
-- ---------------------------------------------------------------------------
create or replace function public.gorush_fail_document_analysis(payload jsonb)
returns jsonb
language plpgsql
as $fn$
declare
  v_id uuid;
  v_retryable boolean;
  v_code text;
  v_message text;
  v_row public.document_analyses;
  v_backoff_seconds integer;
  v_will_retry boolean;
begin
  v_id := nullif(payload ->> 'analysisId', '')::uuid;
  if v_id is null then raise exception 'MISSING_ANALYSIS_ID'; end if;

  v_retryable := coalesce((payload ->> 'retryable')::boolean, false);
  v_code := nullif(payload ->> 'errorCode', '');
  v_message := left(coalesce(payload ->> 'errorSummary', ''), 2000);

  select * into v_row from public.document_analyses where id = v_id;
  if not found then raise exception 'ANALYSIS_NOT_FOUND'; end if;

  -- A deterministic validation failure is never retried: the same input will
  -- fail identically and the retries only delay the operator seeing it.
  v_will_retry := v_retryable and v_row.attempts < v_row.max_attempts;

  -- Bounded exponential backoff: 60s, 240s, 540s.
  v_backoff_seconds := 60 * (v_row.attempts * v_row.attempts);

  update public.document_analyses
    set status = case when v_will_retry then 'QUEUED' else 'FAILED' end,
        last_error_code = v_code,
        error_summary = v_message,
        retryable = v_retryable,
        lease_owner = null,
        lease_expires_at = null,
        next_attempt_at = case when v_will_retry then now() + make_interval(secs => v_backoff_seconds) else null end,
        completed_at = case when v_will_retry then null else now() end,
        version = version + 1
    where id = v_id;

  return jsonb_build_object(
    'analysisId', v_id,
    'willRetry', v_will_retry,
    'attempts', v_row.attempts,
    'nextAttemptInSeconds', case when v_will_retry then v_backoff_seconds else null end
  );
end;
$fn$;

comment on function public.gorush_fail_document_analysis(jsonb) is
  'Persists a failure before the request returns. Retries only transient errors, with bounded backoff; a deterministic validation error goes straight to FAILED.';
