# GommaRush — Document Scanner (DDT Import) Technical Reference

Generated from a full read of the code. Every threshold, model name, regex and
precedence rule below was taken from the source, not from documentation.

> Companion file: `docs/DDT_SCANNER_DEFECTS.md` is not separate — the defect
> list is section 10 of this document.

---

## 0. Critical context: there are TWO parallel analysis stacks

| Stack | Location | Reached from | Status |
|---|---|---|---|
| **A — multi-DDT** | `src/lib/ddt-import/*` | Dashboard **"Nuovo ordine"** button, and `/admin/orders/import` | **Primary.** |
| **B — single-document** | `src/lib/documents/*` | `/admin/orders/new` page → `POST /api/admin/documents` | Legacy. Also used *as a sub-component* by A's text fallback. |

Stack A calls Stack B's `analyzeDocument()` as its no-AI fallback, so they are
entangled, not independent.

Dashboard call chain:

```
NewOrderLauncher.tsx
 └─ NewOrderModal.tsx
     └─ UploadOrderPanel.tsx        <- the scanner UI
         ├─ uploadDocumentDirect()  -> POST /api/admin/documents/upload-url
         │                          -> browser PUTs bytes to Supabase Storage
         ├─ POST /api/admin/ddt-import/analyze
         └─ POST /api/admin/ddt-import/confirm   (once per selected document)
```

---

## 1. Upload

`src/lib/client/document-upload.ts` -> `POST /api/admin/documents/upload-url`
-> `createUploadSlot()` (`src/lib/server/documents.ts`).

- Server issues a Supabase **signed upload URL**; the browser uploads bytes
  directly. Raw bytes never pass through a serverless function body (Vercel's
  ~4.5 MB request limit).
- Bucket: `order-documents` (private). Path: `YYYY/MM/<uuid>.<ext>` — nothing
  user-controlled reaches the path.
- The browser uses the **anon key**, which has no storage write permission;
  authorization comes solely from the one-time signed token minted server-side
  with the service-role key.
- `MAX_UPLOAD_BYTES = 25 * 1024 * 1024` (25 MB), enforced in the analyze route.
- Accepted: `application/pdf`, `image/jpeg|png|webp|heic|heif`, `.docx`,
  `.xlsx`. The MIME check falls back to file extension, because browsers send
  `application/octet-stream` for HEIC.

## 2. Analyze route

`app/api/admin/ddt-import/analyze/route.ts` — `runtime = "nodejs"`,
**`maxDuration = 170`**. Gated by `runAdminRoute()` (server-side Supabase
session + `ADMIN_ALLOWED_EMAILS`). Receives only a JSON pointer
`{storagePath, fileName, mimeType, fileSize}`, then calls `analyzeDdtUpload()`.

## 3. Orchestration — `src/lib/server/ddt-import.ts::analyzeDdtUpload()`

1. `recordUploadedDocument()` — insert the `order_documents` row **first**, so a
   failing analyzer can never lose the upload.
2. `downloadDocumentBytes(storagePath)` — service-role download.
3. `extractDdtDocuments()` — AI/text extraction.
4. Early return on `unconfigured` (a disclosed state, **not** an error) or
   `failed`.
5. `getRecentFingerprints()` — the **most recent 2000 orders** with a non-null
   fingerprint.
6. Per extracted document:
   - `findOrCreateSupplier()` — memoised in `supplierCache`, keyed on
     `name.trim().toLowerCase()`. **Side effect: creates supplier rows during a
     read-only analyze.**
   - `getExistingOrderIdentities(supplierId)` — memoised in
     `existingOrdersBySupplier`.
   - `processExtractedDocument()` — the deterministic pipeline.
   - `matchCustomerFromDocument()` — skipped when status is `DUPLICATE`.
7. Aggregate `summary` + `logEvent("ddt_upload_analyzed")`.

## 4. Extraction — `src/lib/ddt-import/extractor.ts`

Strict provider order; the first success returns immediately.

| Order | Provider | Endpoint | Model | Timeout | Payload |
|---|---|---|---|---|---|
| 1 | Anthropic | `POST /v1/messages`, `anthropic-version: 2023-06-01` | `ANTHROPIC_MODEL` \|\| `claude-sonnet-5`, `max_tokens: 16000` | 170 000 ms | PDF as native `{type:"document",source:{type:"base64"}}`; images as `{type:"image"}` |
| 2 | OpenAI | `POST /v1/responses` | `OPENAI_MODEL` \|\| `gpt-4.1` | 60 000 ms | PDF as `{type:"input_file",filename,file_data}`; images as `{type:"input_image",image_url:"data:..."}` |
| 3 | Text layer | `extractViaTextLayer()` -> Stack B `analyzeDocument()` | none | — | PDF/DOCX text layer, deterministic |

- `isDdtExtractionConfigured()` = either API key present.
- Failures accumulate into `providerFailures[]`, joined into `error`.
- **The text fallback always yields exactly ONE document** regardless of page
  count — multi-DDT splitting requires a working AI provider. This is disclosed
  to the operator in `notes`, never silently assumed.
- Fallback confidence: mean of per-product confidence (default `0.3` each);
  `0.2` when there are no products.

### 4.1 Prompt — `src/lib/ddt-import/prompt.ts`

One shared `DDT_EXTRACTION_SYSTEM_PROMPT` across providers, so the
anti-hallucination rules cannot drift per model. Rules enforced:

- **Document-boundary detection is the model's first job** — one PDF may hold N
  logistics documents, the same DDT repeated, or one continuing across pages.
- Languages: IT / RO / EN / DE, no assumed layout.
- Never infer a partial value (`225/?? R18` -> `aspectRatio: null`).
- `rawDescription` **verbatim**, never rewritten or normalised.
- Never invent a tyre from a PFU/logistics/transport/discount/tax line.
  `itemTypeHint` is a *proposal*; classification happens downstream.
- `quantity: null` if unreadable — **never guessed as 1**.
- `paymentText` copied **verbatim**; the model must not classify it.
- Normalisation of *shape only*: dates -> `YYYY-MM-DD`; decimals -> `.`;
  VAT/fiscal codes copied character-exact.
- Output: JSON only, fixed schema, `confidence` 0–1 per document, `warnings[]`.

### 4.2 Response coercion — `src/lib/ddt-import/coerce.ts`

- `parseModelJson()`: collects all fenced code blocks and uses the **last**;
  falls back to first `{` .. last `}`; throws otherwise.
- `asString` (trim, empty->null), `asNumber` (finite only), `asBoolean`
  (strict), `asStringArray` (filters non-strings).
- `coerceLine()` **drops any line with no `rawDescription`**.
- `itemTypeHint` whitelisted against
  `tyre|tube|wheel|accessory|other|service|fee`, else null.
- `confidence: asNumber(root.confidence) ?? 0.5`.

## 5. Deterministic pipeline — `src/lib/ddt-import/pipeline.ts`

`processExtractedDocument()` is a pure function.
Inputs: `{extracted, supplierId, existingOrders, existingFingerprints}`.

### 5.1 Classification — `src/lib/logistics/ddt-classification.ts`

Types: `TYRE, TUBE, RIM, OTHER_PHYSICAL_ITEM, PFU, LOGISTICS_FEE,
TRANSPORT_FEE, DISCOUNT, VAT, OTHER_FEE, UNKNOWN`.
Physical set = `{TYRE, TUBE, RIM, OTHER_PHYSICAL_ITEM}`.

**Text patterns are evaluated first and always beat the AI hint.** Rule order
matters — PFU is checked first so no broader fee pattern can shadow it:

```
PFU            /\bPFU\b/i  /contr\.?\s*amb\b/i  /contributo\s+ambiental/i
               /eco\s*-?\s*contribut/i  /contributo\s+pneumatic/i
               /\bEPP\d+\b/i  /\bCAP\d+\b/i  /\bETP\d+\b/i  /\bGTP\d+\b/i
LOGISTICS_FEE  /addebito\s+spese\s+logistich/i  /spese\s+logistich/i
               /spese\s+di\s+movimentazione/i  /recupero\s+spese\s+trasport/i
               /\blogistics?\b/i
TRANSPORT_FEE  /spese\s+di\s+trasport/i  /\btrasporto\b/i  /\bshipping\b/i
               /\btransport\s*fee\b/i  /spese\s+accessori/i
DISCOUNT       /\bsconto\b/i  /\bdiscount\b/i
VAT            /\bIVA\b/i  /\bVAT\b/i  /\bbolli\b/i
```

Fallback: `LEGACY_TYPE_MAP[hint]`
(`tyre->TYRE, tube->TUBE, wheel->RIM, accessory|other->OTHER_PHYSICAL_ITEM,
service|fee->OTHER_FEE`) -> else **`UNKNOWN`**. A physical type is never
guessed from nothing.

### 5.2 Line merging — `mergeIdenticalPhysicalLines()`

Merges physical lines identical across a **19-field key**: `lineType, brand,
model, width, aspectRatio, rimDiameter, loadIndex, speedRating, extraLoad,
runFlat, commercial, mudSnow, threePmsf, season, supplierArticleCode,
manufacturerCode, ean, unitPrice, vatPercent` (strings lowercased/trimmed).

Quantities summed; `lineTotal` summed when both present; differing
`rawDescription` joined with `" | "`.
**Lines with `quantity === null` are never merged** — passed through untouched.
Aggregate counts are computed from *all* lines independently, so merging affects
only display and `order_items` shape, never the totals.

### 5.3 Counting — `ddt-lines.ts` + `ddt-calculations.ts`

- `processLines()` splits into `countableLines` and `unreadableQuantityLines`
  (physical AND `quantity === null`). Non-physical lines with a null quantity
  are silently discarded.
- `calculateTyreCount()` = `SUM(quantity WHERE lineType === "TYRE")` — nothing
  else, ever.
- `calculatePhysicalItemCount()` = `SUM(quantity WHERE isPhysicalLine)`.
- `calculateTransportRevenue(tyreCount, ratePerTyre)` =
  `Math.round(n * rate * 100) / 100`.
- `validateTyreCount({tyreCount, physicalItemCount, colli})`:
  `colli === null` -> `OK`; `colli === tyreCount` -> `OK`;
  `colli === physicalItemCount` -> `OK`; else `TYRE_COUNT_REVIEW_REQUIRED`.

### 5.4 Payment — `ddt-payment.ts`

Literal regex on the verbatim `paymentText`; no inference from amount, context
or customer history.

```
cash         /\bCASH\s+AUTISTA\b/i   /\bCONTANTI\b/i
cheque       /\bCONTRASSEGNO\s+ASSEGNO\b/i
bank_receipt /\bRICEVUTA\s+BANCARIA\b/i
```

`paymentMethod` precedence: `bank_receipt` > `cash` > `cheque` > `null`.
Note `cashRequired` and `chequeRequired` are computed independently and can
**both** be true while `paymentMethod` reports only one.

### 5.5 Duplicate detection — `ddt-dedup.ts`

**Layer 1 — exact.** `normaliseDocumentNumber()` =
`trim().toUpperCase().replace(/\s+/g,"")`. `findExactDuplicate()` matches
`supplierId` + normalised number, falling back to normalising the raw
`supplier_document_number` for rows created before that column existed. Backed
by the DB unique index `orders_supplier_doc_number_key`, which is the real
guarantee — the application check alone cannot prevent a race.

**Layer 2 — near-duplicate fingerprint.**

```
sha256( companyKey(supplierName) | companyKey(customerName) | postalCode
        | documentDate | itemSignature | totalTyres )

itemSignature = items.map(`${BRAND}|${SIZE}|${qty}`).sort().join(";")
```

Compared against the 2000 most recent fingerprints. A match is **never** an
automatic skip or import — it becomes `POSSIBLE_DUPLICATE` for a human.

**Layer 3 — file hash.** `source_hash` = SHA-256 of the uploaded bytes,
recorded on the order and checked at analyze time. An identical file re-uploaded
under a different name is reported informationally in `notes`; it never blocks.

### 5.6 Status derivation

`importableItemCount` = physical lines with `quantity !== null`.

**Blocking** (`blocked = true`; the order genuinely cannot be created):
`!supplier.name` · `!customer.companyName` · `importableItemCount === 0`

**Review** (informational only):
`!document.documentNumber` · `unreadableQuantityLines.length > 0` ·
`tyreCountValidation === "TYRE_COUNT_REVIEW_REQUIRED"` ·
`unclassifiedLines > 0`

**Precedence (first match wins):**

```
exactDuplicate      -> DUPLICATE
fingerprintMatch    -> POSSIBLE_DUPLICATE
blocked             -> NEEDS_REVIEW
reviewIssues > 0    -> NEEDS_REVIEW
!phone || !postal   -> READY_MISSING_OPTIONAL
otherwise           -> READY
```

`blocked` is **orthogonal** to `status`: a `NEEDS_REVIEW` document can still be
confirmable.

## 6. Customer matching — `src/lib/logistics/customer-matching.ts`

Normalisation keys: `companyKey()` strips punctuation then iteratively removes
trailing legal forms (up to 3-word tails, longest first, so
`"Rossi Gomme S.r.l."` keys the same as `"ROSSI GOMME SRL"`); plus
`identifierKey()`, `postalKey()`, `streetKey()`.

`tokenSimilarity(a,b)` = `sharedTokens / max(|A|,|B|)`.

**Thresholds:** `NAME_MATCH_THRESHOLD = 0.99` ·
`NAME_REVIEW_THRESHOLD = 0.5` · `LOCATION_MATCH_THRESHOLD = 0.75`

```
best.score < 0.5                        -> new_customer      (review)
!companyConfirmed                        -> possible_match    (review)
   companyConfirmed = identifierConfirmed (vat|fiscal|supplier_code)
                      OR score >= 0.99
loc.score >= 0.75 && differences == 0    -> match_confirmed   (no review)
loc.score >= 0.75 && differences > 0     -> possible_match    (review)
no extracted address -> primary location -> match_confirmed / new_location
otherwise                                -> new_location      (review)
```

`LocationResolution` in
`use_existing | use_for_this_order_only | add_as_new_location | update_existing_location`.

### 6.1 UI gating — `client-helpers.ts`

`buildCustomerResolution()` returns a payload **only** for `match_confirmed` and
`new_customer`. `possible_match` / `new_location` -> `null` -> not
auto-confirmable.

```
canAutoConfirmDdtDocument  = status not in {DUPLICATE, POSSIBLE_DUPLICATE}
                             && !blocked && resolution !== null
canForceConfirmDdtDocument = status in {DUPLICATE, POSSIBLE_DUPLICATE}
                             && !blocked && resolution !== null
```

**The server confirm route does not gate on document status at all** — only the
DB unique constraint actually stops a duplicate insert. The checkbox state is a
UI-only safety rail.

## 7. Confirm — `confirmDdtDocument()` + `app/api/admin/ddt-import/confirm/route.ts`

1. `resolveCustomerForOrder()` — customer/location per the admin's resolution.
2. Lines with `quantity === null` are **dropped** (`droppedLineCount`), never
   defaulted to 0 or 1.
3. Physical lines mapped via `LINE_TYPE_TO_ITEM_TYPE`
   (`TYRE->tyre, TUBE->tube, RIM->wheel, OTHER_PHYSICAL_ITEM->other`);
   unmapped -> dropped.
4. `items.length === 0` -> throws `NOTHING_IMPORTABLE` (server-side backstop
   mirroring the pipeline's `blocked`).
5. `createOrder(...)` — the **atomic** `gorush_create_order` RPC: order +
   `order_items` + `inventory_units` in one transaction. **PFU/fee lines are
   never passed to it**, so they can never become inventory.
6. `writeDocumentCharges()` — upsert on `(order_id, line_number)`, therefore
   idempotent and safe on retry. Called from both the create and the recovery
   path.
7. `advanceDdtOrderToStored()` — `expected -> stored`, writes the DDT columns,
   updates `inventory_units`, appends `order_status_history`
   (`notes: "ddt_import_received"`). Guarded by `.eq("status","expected")`, so
   it is idempotent and never rolls a progressed order backward. Falls back to a
   status-only update on `isMissingSchemaError`.

**Idempotency:** `findExistingOrder()` pre-check (normalised column, with a
500-row raw-number fallback) returns the existing order via
`recoverExistingOrder()`. On Postgres `23505` it re-resolves the race winner; if
the constraint name matches a document-number index it returns
**409 `ALREADY_IMPORTED`**. The pre-check is skipped for
`DUPLICATE`/`POSSIBLE_DUPLICATE`, which keep the explicit human
"Aggiungi di nuovo" path.

## 8. Database

`supabase/migrations/20260819000000_ddt_import_system.sql`:

- `orders +=` `normalized_document_number, tracking_number, giro, agent,
  carrier, cash_required, cheque_required, tyre_count, physical_item_count,
  transport_rate_snapshot, transport_revenue, source_hash, fingerprint,
  extraction_confidence numeric(4,3)`
- `order_items +=` `manufacturer_code, ean, commercial_c, mud_snow, three_pmsf`
- New tables: `document_charges`, `app_settings`
- Indexes: `orders_supplier_doc_number_key` (unique), `orders_fingerprint_idx`,
  `orders_source_hash_idx`, `document_charges_order_idx`

`supabase/migrations/20260901000000_document_pipeline_core.sql`:

- `orders` order-type columns; `document_analyses`; `document_extracted_lines`;
  `document_party_mappings`; `document_import_idempotency`;
  `order_documents.source_hash` (unique); `document_charges_order_line_key`
  unique index on `(order_id, line_number)`, which makes charge writes
  idempotent.

`supabase/migrations/20260902000000_document_analysis_queue.sql`:

- Retry columns on `document_analyses`, plus four functions:
  `gorush_enqueue_document_analysis` (race-safe file idempotency),
  `gorush_lease_document_analysis` (`FOR UPDATE SKIP LOCKED`),
  `gorush_store_document_analysis_result` (atomic result + lines, and it
  REFUSES a payload whose line count disagrees with its declared total), and
  `gorush_fail_document_analysis` (bounded backoff; deterministic errors are
  never retried).

## 8a. Asynchronous processing

`/api/cron/document-analysis` is the worker, scheduled every two minutes by
`vercel.json` and authorised by `Authorization: Bearer $CRON_SECRET`. With
`CRON_SECRET` unset the route refuses everything rather than defaulting open.
It drains at most three jobs per invocation — an unbounded drain would be
killed mid-job, which is the failure the queue exists to remove.

`/api/admin/ddt-import/status?analysisId=` is what the review UI polls. It
returns the status and the line tally only, never the raw extraction.

Provider budgets now fit inside the route's: Anthropic 110s, OpenAI 40s, job
step 150s, lease 300s. The lease deliberately outlives the run, so a killed
invocation cannot hold a row locked longer than it actually ran.

## 9. Test coverage

`ddt-pipeline` · `ddt-calculations` · `ddt-dedup` · `customer-matching` ·
`product-normalise` · `ddt-classification` · `ddt-payment` ·
`ddt-unconfigured`.

**Untested:** both AI providers, `coerce.ts`, `extractor.ts` fallback ordering,
the analyze route, and the confirm route's idempotency/race paths.

---

## 10. Defects and improvement targets

### Fixed in `20260831000000_ddt_scanner_fixes` (see git history)

1. **`source_hash` was written nowhere.** Declared and indexed, zero writes.
   File-level dedup did not exist despite the schema implying it. Now computed
   at analyze time, surfaced as an informational note, and persisted.
2. **`UNKNOWN` lines vanished silently.** Not physical, not a charge — excluded
   from `physicalItems`, `charges`, `order_items` AND `document_charges`, with no
   counter and no warning. Now counted as `unclassifiedLines` and reported.
3. **`TEXT_NOTE` was unreachable** — declared in the union, never returned.
   Removed.
4. **Anthropic timeout equalled the route's `maxDuration`** (170 s vs 170 s).
   Zero headroom: Vercel killed the function before the provider timeout could
   produce a recordable error, so the OpenAI fallback never ran on a slow call.
   Now 110 s / 40 s, leaving margin for the fallback chain.
5. **OpenAI `file_data` was bare base64.** The Responses API expects a data URI,
   so provider 2 was almost certainly dead for PDFs — the input that matters.
6. **VAT regexes were case-inconsistent** — `/\bIVA\b/` and `/\bVAT\b/` lacked
   the `/i` every other pattern had, so lowercase `iva` was not classified.
7. **`document_charges` was written outside the order transaction** and its
   failure only logged, so an order could exist with its fee lines silently
   missing. Now an idempotent upsert, called from the recovery path too, and
   failures are surfaced.

### Open — design risks

8. **`findOrCreateSupplier()` writes during analyze.** A cancelled or abandoned
   preview permanently creates supplier rows. This is the likely origin of the
   junk suppliers in production (`"asdas"`, `"Name"`) and the near-duplicates
   (`FIN TYRE SPA` / `FINTYRE SPA`, `ZUIN GOMME` x3). Supplier resolution should
   move to confirm time, or analyze should resolve read-only and defer creation.
9. **`totalTyres` is inside the fingerprint.** A re-scan that reads one quantity
   differently produces a different hash, so the near-duplicate check misses
   precisely the case it exists for.
10. **The fingerprint window is 2000 orders** and the limit is silent. Older
    duplicates are invisible.
11. **`expected -> stored` on confirm.** Scanning a document marks the goods
    physically stored and in the warehouse. Document arrival is not goods
    arrival.
12. **`confidence ?? 0.5`** — a model omitting the field scores mid-range rather
    than low, and nothing in the pipeline consumes `confidence` for gating
    anyway. It is written uniformly to every `order_items.confidence`.
13. **`parseModelJson()` takes the *last* fenced block.** Two JSON blocks in one
    response silently selects the second.
14. **`OTHER_PHYSICAL_ITEM` comes only from the AI hint** (`accessory`/`other`)
    and feeds `physicalItemCount`, which feeds `validateTyreCount`. An AI hint
    therefore influences a supposedly deterministic validation.
15. **Dropped lines leave no persistent record.** `droppedLineCount` reaches the
    UI and the log, never the order.
16. **`/\btrasporto\b/i` is broad** enough to reclassify a product line whose
    description merely mentions transport.
17. **Per-line AI confidence is discarded**; only the document-level value is
    kept.

### Open — capability available but unwired

18. **No EAN validation.** `src/lib/catalogue/gtin.ts` has full GTIN-8/12/13/14
    check-digit validation with leading-zero recovery. `order_items.ean` is
    populated straight from AI output with no check at all.
19. **No catalogue cross-check.** `catalogue_products` / `product_identifiers`
    now exist and could validate extracted brand/size/EAN against known SKUs and
    resolve `UNKNOWN` lines deterministically. Entirely unused by this pipeline.
    This is the single largest available accuracy win.
20. **`product-normalise.ts`** (484 lines, 16 tests, size and load-index
    regexes, 47 known brands) is used by Stack B but **not** by Stack A — Stack A
    trusts the AI's field decomposition instead of verifying it against a
    deterministic parser it already owns.
