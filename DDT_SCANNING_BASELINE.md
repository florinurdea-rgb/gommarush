# GoRush / GommaRush — Invoice/DDT Scanning & Order-Creation: Full Technical Baseline

Analysis-only. No code was changed while producing this document. Every claim is tagged:
**VERIFIED IN CODE** (read directly, file:line/function cited), **VERIFIED IN LIVE DB** (confirmed against production via Supabase MCP), **INFERRED** (deduced from surrounding code but not directly observed), or **UNKNOWN** (could not be determined from the repo).

---

## 1. User flow — every way an order can be created from a document

The audit's suspicion is **confirmed**: there are **two separate, fully live, parallel single/multi-document import implementations**, not one.

### Flow A — "Comandă nouă" modal → multi-DDT pipeline (primary, newer)

| Step | File |
|---|---|
| Entry point | `NewOrderLauncher.tsx` ("+ Comandă nouă" button on `/admin`) → `NewOrderModal.tsx` → "Încarcă document" step |
| Upload component | `src/components/logistics/UploadOrderPanel.tsx` |
| Upload mechanism | `uploadDocumentDirect()` in `src/lib/client/document-upload.ts` — signed URL, direct-to-Storage |
| Analysis endpoint | `POST /api/admin/ddt-import/analyze` (`app/api/admin/ddt-import/analyze/route.ts`) |
| Extraction impl | `analyzeDdtUpload()` in `src/lib/server/ddt-import.ts` → `extractDdtDocuments()` in `src/lib/ddt-import/extractor.ts` |
| Review screen | Inline document cards inside `UploadOrderPanel.tsx` (checkbox per document, expandable detail) |
| Validation | `processExtractedDocument()` in `src/lib/ddt-import/pipeline.ts` (deterministic, runs server-side during analyze) |
| Confirm | `POST /api/admin/ddt-import/confirm` → `confirmDdtDocument()` in `src/lib/server/ddt-import.ts` |
| DB write | `gorush_create_order` RPC + `document_charges` insert + status advance to `stored` |

Also reachable directly at `/admin/orders/import` → `DdtImportFlow.tsx`, which is the **same** analyze/confirm API pair, just a full-page layout with per-document confirm buttons instead of a batch checkbox list. **VERIFIED IN CODE**: `app/admin/(secure)/orders/import/page.tsx` → `DdtImportFlow.tsx`.

A "NEEDS_REVIEW" document in either surface can be routed to `OrderReviewForm.tsx` pre-filled via `ddtDocumentToAnalysisResult()` (`src/lib/ddt-import/to-analysis-result.ts`) for manual completion — "Editează și finalizează".

### Flow B — `/admin/orders/new` → single-document analyzer (older, still live)

| Step | File |
|---|---|
| Entry point | Direct navigation to `/admin/orders/new`, and a fallback link from Flow A's "unconfigured" state (`DdtImportFlow.tsx:208-213`, "Completează comanda manual →") |
| Page | `app/admin/(secure)/orders/new/page.tsx` → `NewOrderFlow.tsx` |
| Upload mechanism | Same `uploadDocumentDirect()` helper (shared) |
| Analysis endpoint | `POST /api/admin/documents` (`app/api/admin/documents/route.ts`) — **a different route from Flow A** |
| Extraction impl | `analyzeStoredDocument()` in `src/lib/server/documents.ts` → `analyzeDocument()` in `src/lib/documents/index.ts` → `AnthropicDocumentAnalyzer` (`src/lib/documents/anthropic-analyzer.ts`) or the deterministic text parser |
| Review screen | `OrderReviewForm.tsx` (same component both flows ultimately use) |
| Validation | None of the DDT-specific deterministic layer (`ddt-classification.ts`, `ddt-calculations.ts`, `ddt-dedup.ts`, `ddt-payment.ts`) runs in this flow at all — see §48 |
| Confirm | `POST /api/admin/orders` (the plain order-creation route, shared with manual entry) |
| DB write | `gorush_create_order` RPC only — no `document_charges`, no fingerprint, no `tyre_count`/`transport_revenue` snapshot |

**VERIFIED IN CODE**: `src/components/logistics/NewOrderFlow.tsx:61` calls `fetch("/api/admin/documents", ...)`; `UploadOrderPanel.tsx:75` calls `fetch("/api/admin/ddt-import/analyze", ...)`. Two different route handlers, two different extraction pipelines, one shared final review form and one shared final order-creation route.

This is a real, present-day duplication — not a leftover the prior audit merely predicted. Both paths are reachable from the live UI today.

---

## 2. Every document-processing code path — file inventory

### `src/lib/documents/*` — the OLDER, single-document pipeline (Flow B)
| File | Purpose | Live caller |
|---|---|---|
| `analyzer.ts` | `DocumentAnalyzer` interface, `AnalysisResult`/`ExtractedProductLine` types, `emptyResult()`, `isSupportedUpload()`, MIME/size constants | Everything below, plus shared by Flow A's coercion in `anthropic-provider` (no — Flow A has its own types, see §2 next block). Actually shared with `text-fallback.ts` (Flow A's fallback wraps Flow B's analyzer) |
| `anthropic-analyzer.ts` | `AnthropicDocumentAnalyzer` — single-document vision call to Claude | `index.ts` |
| `pdf-text.ts` | Hand-rolled PDF/DOCX text-layer extractor, no dependency | `index.ts`, and re-used by Flow A's `text-fallback.ts` |
| `text-invoice-parser.ts` | Deterministic regex-based parser for extracted PDF text | `index.ts` |
| `index.ts` | `analyzeDocument()` — orchestrates text-layer-first, then AI, then unconfigured | `src/lib/server/documents.ts`, `src/lib/ddt-import/text-fallback.ts` |

### `src/lib/ddt-import/*` — the NEWER, multi-document pipeline (Flow A)
| File | Purpose | Live caller |
|---|---|---|
| `types.ts` | `ExtractedDocument`/`ExtractedLine`/`ExtractionResult` — a **different, richer type system** than `analyzer.ts`'s (see §12) | Everything below |
| `prompt.ts` | `DDT_EXTRACTION_SYSTEM_PROMPT` — shared by both AI providers | `anthropic-provider.ts`, `openai-provider.ts` |
| `anthropic-provider.ts` | Multi-document Claude extraction | `extractor.ts` |
| `openai-provider.ts` | Multi-document GPT-4.1 extraction (OpenAI Responses API) | `extractor.ts` |
| `text-fallback.ts` | Wraps the OLD `analyzeDocument()` (§2 above) as a last resort when no AI key is set or all AI providers fail | `extractor.ts` |
| `coerce.ts` | Shared JSON→typed coercion for both AI providers | `anthropic-provider.ts`, `openai-provider.ts` |
| `extractor.ts` | `extractDdtDocuments()` — provider fallback chain orchestration | `src/lib/server/ddt-import.ts` |
| `pipeline.ts` | `processExtractedDocument()` — the deterministic classification/counting/dedup/status engine | `src/lib/server/ddt-import.ts` |
| `client-helpers.ts` | Client-safe (no `server-only`) shared UI logic: status labels, `canAutoConfirmDdtDocument()`, `buildCustomerResolution()` | `UploadOrderPanel.tsx`, `DdtImportFlow.tsx` |
| `to-analysis-result.ts` | Converts a `ProcessedDocumentWithMatch` into the OLD pipeline's `AnalysisResult` shape, purely to reuse `OrderReviewForm.tsx` for "Editează și finalizează" | `NewOrderModal.tsx` |

### `src/lib/logistics/ddt-*.ts` — deterministic business rules, used ONLY by Flow A
| File | Purpose |
|---|---|
| `ddt-classification.ts` | `classifyLine()` — regex-based PFU/fee/tyre/tube/rim classification, always overrides the AI's `itemTypeHint` |
| `ddt-lines.ts` | `processLines()` — separates countable vs. unreadable-quantity lines |
| `ddt-calculations.ts` | `calculateTyreCount()`, `calculatePhysicalItemCount()`, `calculateTransportRevenue()`, `validateTyreCount()` — all pure arithmetic over already-classified lines, never an AI-reported total |
| `ddt-payment.ts` | `detectPaymentSignals()` — regex-only, no AI, no inference |
| `ddt-dedup.ts` | `normaliseDocumentNumber()`, `findExactDuplicate()`, `computeOrderFingerprint()`, `buildItemSignature()` |

### `src/lib/logistics/product-normalise.ts` — shared by BOTH pipelines
Used directly by Flow B's `anthropic-analyzer.ts` and `text-invoice-parser.ts` to fill gaps the AI/regex left null, and by `OrderReviewForm.tsx` (`mergeIdenticalProductLines`) for both flows' review screen.

### `src/lib/logistics/customer-matching.ts` — shared by BOTH pipelines
Pure matcher, called via `src/lib/server/customers.ts::matchCustomerFromDocument()` from both `/api/admin/documents` (Flow B) and `/api/admin/ddt-import/analyze` (Flow A).

### Server orchestration
| File | Purpose |
|---|---|
| `src/lib/server/documents.ts` | Storage (`storeOrderDocument`, `createUploadSlot`, `recordUploadedDocument`, `downloadDocumentBytes`), plus `analyzeStoredDocument()` (Flow B only) |
| `src/lib/server/ddt-import.ts` | `analyzeDdtUpload()`, `confirmDdtDocument()`, `advanceDdtOrderToStored()` (Flow A only) |
| `src/lib/server/customers.ts` | Customer/location CRUD + `matchCustomerFromDocument()` + `resolveCustomerForOrder()` (shared) |
| `src/lib/server/reference.ts` | `findOrCreateSupplier()` (shared), `listDrivers`/`listVehicles`/`listSuppliers` |
| `src/lib/server/orders.ts` | `createOrder()` — the single `gorush_create_order` RPC wrapper both flows ultimately call |
| `src/lib/server/settings.ts` | `getTransportRatePerTyre()` / `setTransportRatePerTyre()` — Flow A only |

### API routes
`app/api/admin/documents/upload-url/route.ts` (shared, step 1 for both flows) · `app/api/admin/documents/route.ts` (Flow B step 2) · `app/api/admin/ddt-import/analyze/route.ts` (Flow A step 2) · `app/api/admin/ddt-import/confirm/route.ts` (Flow A step 3) · `app/api/admin/orders/route.ts` (final order creation, shared by Flow B and manual entry) · `app/api/admin/orders/[id]/document-url/route.ts` (view original, shared).

### Not part of document extraction (ruled out despite keyword matches)
`src/lib/tyre-lookup/*` and `app/api/tyre-lookup/route.ts` — a separate public-facing "identify a tyre by barcode" AI feature (`/cauta-cauciuc`), architecturally similar (Anthropic call + honesty-rule coercion) but entirely unrelated to order creation. Not analyzed further per the brief's scope.

---

## 3. End-to-end architecture — actual implementation, both branches

```
Browser (file input)
  │
  ├─ POST /api/admin/documents/upload-url  (shared step 1)
  │     createUploadSlot() → Supabase Storage signed upload URL
  │
  ├─ Browser uploads bytes DIRECTLY to Supabase Storage
  │     (uploadDocumentDirect() — raw bytes never touch a Next.js route)
  │
  ├──────────────────────┬───────────────────────────────────────────
  │  FLOW A (multi-DDT)  │  FLOW B (single-document, older)
  │  UploadOrderPanel /  │  NewOrderFlow.tsx
  │  DdtImportFlow.tsx   │
  ▼                      ▼
POST /api/admin/         POST /api/admin/documents
  ddt-import/analyze       │
  │                        ├─ recordUploadedDocument() (order_documents row)
  ├─ analyzeDdtUpload()    ├─ downloadDocumentBytes()
  │   ├─ recordUploadedDocument()
  │   ├─ downloadDocumentBytes()
  │   ├─ extractDdtDocuments()
  │   │    ├─ ANTHROPIC_API_KEY set? → extractViaAnthropic()
  │   │    │     success → return
  │   │    │     fail → next provider
  │   │    ├─ OPENAI_API_KEY set?    → extractViaOpenAI()
  │   │    │     success → return
  │   │    │     fail → next
  │   │    └─ textFallback() → extractViaTextLayer()
  │   │          → analyzeDocument()  ◄── calls into FLOW B'S own
  │   │              (pdf-text.ts /       pipeline as a last resort!
  │   │               text-invoice-parser.ts,
  │   │               NO AI here)
  │   │
  │   ├─ per extracted document:
  │   │    findOrCreateSupplier()
  │   │    processExtractedDocument()  ◄── deterministic core (§15-16)
  │   │      classifyLine() → PFU/fee/tyre/tube/rim
  │   │      calculateTyreCount() / calculatePhysicalItemCount()
  │   │      detectPaymentSignals()
  │   │      normaliseDocumentNumber() + findExactDuplicate()
  │   │      computeOrderFingerprint() + fingerprint lookup
  │   │      → status: READY | READY_MISSING_OPTIONAL |
  │   │                NEEDS_REVIEW | POSSIBLE_DUPLICATE | DUPLICATE
  │   │    matchCustomerFromDocument()  ◄── shared with Flow B
  │   │
  │   └─ return { documents[], summary, unconfigured, notes }
  │
  ▼ (review UI: per-document card, checkbox, expand)
  │
  POST /api/admin/ddt-import/confirm  (per selected document)
    ├─ findExistingOrder()  (idempotency / retry recovery)
    ├─ resolveCustomerForOrder()
    ├─ createOrder() → gorush_create_order RPC
    ├─ document_charges insert (PFU/fee lines, non-atomic — see §34)
    └─ advanceDdtOrderToStored()  (expected → stored, order_status_history)
                                       │
                        analysis (analyzeStoredDocument())
                          ├─ analyzeDocument()
                          │    ├─ text layer usable? → parseInvoiceText()
                          │    │    (pdf-text.ts / text-invoice-parser.ts)
                          │    ├─ AI configured? → AnthropicDocumentAnalyzer
                          │    │    (single request, single document assumed)
                          │    └─ neither → emptyResult("unconfigured")
                          └─ matchCustomerFromDocument()  ◄── shared
                        │
                        return { documentId, analysis, customerMatch }
                        │
                        ▼ (review UI: OrderReviewForm.tsx, fully editable)
                        │
                        POST /api/admin/orders  (shared with manual entry)
                          ├─ findOrCreateSupplier()
                          ├─ resolveCustomerForOrder()
                          └─ createOrder() → gorush_create_order RPC
                               (NO document_charges, NO fingerprint,
                                NO tyre_count/transport_revenue write)
  │
  ▼ (both flows converge here)
Database: orders / order_items / inventory_units / order_status_history
          (+ document_charges, only from Flow A's confirm path)
```

Both flows share: upload-url issuance, Storage, `customer-matching.ts`, `product-normalise.ts` (partially), `OrderReviewForm.tsx`, and the final `gorush_create_order` RPC. They diverge completely on: extraction provider code, output schema, deterministic validation (Flow B has none of the PFU/dedup/tyre-count layer), and multi-document support (Flow B always assumes exactly one order per upload).

---

## 4. Document upload logic

**VERIFIED IN CODE**, `src/lib/server/documents.ts` + `src/lib/client/document-upload.ts`:

- **Accepted MIME types**: `SUPPORTED_UPLOAD_MIME_TYPES` in `src/lib/documents/analyzer.ts:13-22` — `application/pdf`, `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`, `.docx` (`vnd.openxmlformats...wordprocessingml.document`), `.doc` (`application/msword`, accepted by MIME but never actually parsed — no `.doc` binary-format reader exists anywhere in the repo; it would fall through to "unconfigured/failed").
- **Extension fallback**: `isSupportedUpload()` (`analyzer.ts:155-161`) also accepts by file extension when the MIME type is missing/wrong — explicitly for HEIC, which browsers report inconsistently.
- **Max file size**: `MAX_UPLOAD_BYTES = 25 * 1024 * 1024` (25 MB), `analyzer.ts:35`. Enforced server-side in both `/api/admin/documents/route.ts:38` and `/api/admin/ddt-import/analyze/route.ts:31` — **not** enforced at the Storage-upload step itself (the signed-URL upload has no size limit set at `createUploadSlot()` time), only afterward when `analyze`/`documents` is called with the already-uploaded file's reported size. **VERIFIED IN CODE**: a file could be uploaded to Storage and only rejected on the *next* call, leaving an orphaned oversized object in the bucket (see §41).
- **Max page count**: **NOT IMPLEMENTED**. No code anywhere checks PDF page count before sending it to a vision model.
- **Signed URL / direct-to-Storage upload**: `createUploadSlot()` (`documents.ts:104-115`) calls `supabase.storage.from(BUCKET).createSignedUploadUrl()`; the browser then calls `supabase.storage.from(bucket).uploadToSignedUrl(...)` directly (`document-upload.ts:69-71`). The Next.js server **never receives the raw file bytes on upload** — confirmed by the explicit comment at `documents.ts:94-103` explaining this was built specifically to work around Vercel's few-MB serverless request-body cap, after the old multipart-form flow silently failed on real scanned DDTs.
- **Storage bucket/path**: bucket `order-documents` (private — `BUCKET` const, `documents.ts:18`). Path is `storagePathFor()` (`documents.ts:28-33`): `{year}/{month}/{randomUUID()}.{extension}` — extension taken from the filename via regex, defaulting to `.bin`. The original filename is never used as the storage key (avoids collisions/traversal).
- **Security**: bucket has RLS/no public access; every read goes through `createSignedUrl()` with a short expiry (`getDocumentDownloadUrl()`, default 300s, `documents.ts:247-264`). The anon key used for the direct browser upload has no Storage write permission of its own — authorization is entirely the one-time signed token (`document-upload.ts:12-16` comment).
- **Metadata persisted**: `order_documents` row — `source_type`, `storage_bucket`, `storage_path`, `original_filename` (truncated to 255 chars), `mime_type`, `file_size`, `extraction_status`, `uploaded_by_label`. **VERIFIED IN DB** via `20260819000000_ddt_import_system.sql` is NOT where this table is defined (it pre-exists from an earlier migration not read in this pass) — table existence and columns confirmed by `getOrderDocument()`'s select list in `documents.ts:228-239`.
- **Filename handling**: no sanitization beyond a 255-char truncation; the raw filename is stored as `original_filename` but never used to build the storage path (see above) — so a filename with path-traversal characters or NUL bytes cannot escape the bucket structure, though it is still stored verbatim as metadata (not rendered unescaped anywhere observed).
- **Duplicate filenames**: never collide — the storage path is always a fresh `randomUUID()`, independent of filename.
- **Retry behaviour on upload**: **NOT IMPLEMENTED**. `uploadDocumentDirect()` makes one `fetch` for the slot and one Storage upload call; any failure throws `DocumentUploadError` and the UI shows a generic error (`UploadOrderPanel.tsx:96-100`, `NewOrderFlow.tsx:85-89`) with a manual "try again" (re-select the file) as the only recovery.
- **Timeout on upload itself**: none explicit — relies on the browser's/Supabase JS client's own fetch timeout behaviour (**UNKNOWN** exact value, likely no client-side timeout at all, i.e., can hang indefinitely on a bad connection).
- **Malformed/corrupt uploads**: nothing validates the file is actually a well-formed PDF/image at upload time. A corrupt PDF passes the MIME/extension check, uploads successfully, and only fails later inside `extractContentStreams()` (caught, falls through to `{text:"", usable:false}`) or inside the AI provider (which will usually still return *something*, possibly a failure JSON, possibly a hallucinated-empty response — see §41 for the risk this creates).
- **HEIC handling**: accepted for upload and for the Anthropic vision call (`IMAGE_MIME_TYPES` includes none of `image/heic` in either `anthropic-analyzer.ts:27` or `anthropic-provider.ts:18` — **VERIFIED IN CODE**: `image/heic`/`image/heif` are accepted at upload but **not** in either provider's `imageMimeTypes` list, meaning a HEIC upload reaches `anthropic-analyzer.ts`'s explicit `UNSUPPORTED_FOR_VISION` branch, or (Flow A) the same file-type check in `anthropic-provider.ts:19-27`/`openai-provider.ts:38-48` returns `UNSUPPORTED_FILE_TYPE`. A HEIC photo — the single most likely capture format for someone photographing a DDT on a phone — currently cannot be AI-analyzed by either flow. It falls through to the text-layer path, which will also fail (HEIC has no text layer), ending in `unconfigured`/`failed` with a fully manual form.
- **DOCX handling**: text-layer only (`extractDocxText()`, `pdf-text.ts:222-272`), never sent to a vision model in either flow (`.docx`'s MIME type is not in either provider's image/PDF branches, so it always takes the "unsupported" path unless the text layer is usable).
- **PDF handling**: see §6.
- **Images (JPEG/PNG/WEBP/GIF)**: sent natively as `type: "image"` content blocks to Claude in both flows; OpenAI's Responses API in Flow A uses `input_image` with a `data:` URL.

---

## 5. File-type detection

**NOT based on**: magic-byte/content sniffing of any kind, and **not AI-based** (no model call is ever used to *decide* the file type — only to *read* it once the type is already known).

**Actually based on**: MIME type string first, filename extension as fallback. Every branch point uses the same pattern, e.g. `anthropic-provider.ts:17`: `input.mimeType === "application/pdf" || input.fileName.toLowerCase().endsWith(".pdf")`. Identical pattern repeated independently in `openai-provider.ts:38`, `documents.ts:sourceTypeFor()` (lines 20-25), and `index.ts:52,61-64`.

**Scanned PDF vs. text PDF**: this distinction **does exist**, but only as a binary "does the extracted text look real" gate, not a stated classification. `extractPdfText()` (`pdf-text.ts:200-215`) always runs its extraction attempt regardless of whether the PDF is a scan or a text document; `looksLikeUsableText()` (`pdf-text.ts:181-192`) then decides post-hoc: length ≥ 40 chars, ≥85% of characters "readable" (letters/digits/common punctuation), ≥20 actual letters. A scanned PDF with no embedded text layer produces an empty/near-empty extraction and fails this gate, so it is treated the same as "no text layer" — there's no separate signal distinguishing "this is a scan" from "this is a text PDF with a broken/CID-encoded font" (both degrade identically to `usable: false`).

**Unsupported types**: any MIME/extension not in `SUPPORTED_UPLOAD_MIME_TYPES`/`SUPPORTED_UPLOAD_EXTENSIONS` is rejected at the `/api/admin/documents` and `/api/admin/ddt-import/analyze` route level with `415 UNSUPPORTED_FILE_TYPE`, before any bytes are downloaded for analysis (`analyze/route.ts:32`, `documents/route.ts:39`).

---

## 6. PDF processing — traced precisely

**Is text extracted first?** Yes, in both flows, always, before any AI call is attempted — `index.ts:52-60` (Flow B) and (indirectly, only in the fallback path) `text-fallback.ts` (Flow A). **Important asymmetry**: Flow A's *primary* path (AI configured) does **NOT** try text extraction first — it goes straight to `extractViaAnthropic()`/`extractViaOpenAI()` with the raw PDF bytes (`extractor.ts:76-86`). Text extraction in Flow A only happens as the final fallback, after both AI providers have been tried and failed, or when no AI key exists at all (`extractor.ts:88`, `textFallback()`). Flow B, by contrast, *always* tries text extraction first regardless of whether AI is configured, and only calls the AI provider if the text parse found zero product lines or wasn't "usable" (`index.ts:73-99`).

**Library**: none — hand-rolled, dependency-free (`pdf-text.ts:1-19` explicitly documents this as a deliberate serverless-bundle-size tradeoff versus pdf.js).

**Page boundaries preserved in text extraction?** No — `extractContentStreams()` concatenates every content stream it finds across the whole PDF into one text blob (`pdf-text.ts:84-120`, then joined at `extractPdfText():208-211`). There is no per-page text array, no page-number tagging on any extracted string.

**Tables preserved?** No structural table model exists; `textFromStream()` (`pdf-text.ts:123-170`) only recognizes text-showing operators (`Tj`, `TJ`, `'`, `"`) and line-break operators (`TD`, `Td`, `T*`, `ET`) — a PDF table's columnar layout is flattened into whatever left-to-right, top-to-bottom order the content stream happens to emit its text-showing calls in, which is usually but not always reading order.

**Does it rasterize pages?** No. **NOT IMPLEMENTED** anywhere in the repo — no image-conversion library, no `pdf-to-image`/`pdftoppm`/canvas-based rendering of any kind. PDFs are handled exactly two ways: (a) the hand-rolled text extractor above, or (b) the raw PDF bytes are base64-encoded and sent whole to the AI provider's native PDF/`document` content-block support (`anthropic-analyzer.ts:221-225`, `anthropic-provider.ts:31-32`) — the *model itself* does any rasterization/vision internally; the application never renders a PDF page to a bitmap.

**Resolution, if rasterized?** N/A — see above.

**Are all pages converted / are only some pages used?** The whole PDF file (every page) is sent as one `document` content block in a single API call — there is no per-page splitting, no page-count cap, no "only send the first N pages" logic anywhere (`anthropic-provider.ts:47-57`, `anthropic-analyzer.ts:254-270`). A 50-page PDF and a 2-page PDF are submitted identically.

**Are PDF bytes sent directly to the model? Base64?** Yes to both — `document.bytes.toString("base64")` (`anthropic-analyzer.ts:218`), `input.bytes.toString("base64")` (`anthropic-provider.ts:30`, `openai-provider.ts:51`).

**Is OCR performed separately?** No — see §8.

**Does the system detect embedded text vs. none?** Indirectly, via the `usable`/`streamCount` result of `extractPdfText()` — but this is a binary usability gate, not an explicit "has text layer: yes/no" flag surfaced anywhere in the UI or stored on the document row.

**Does it detect poor text quality specifically (as distinct from "no text")?** No distinct signal — both cases collapse to `usable: false` (see §5).

**Does it know which page a field came from?** Only partially, and only via the AI's own self-report: `ExtractedDocument.document.sourcePageStart`/`sourcePageEnd` (`types.ts:52-53`) are fields the *model* is asked to fill in (`prompt.ts:39`), never independently verified or derived by the application — they are exactly as reliable (or not) as any other AI-extracted field, i.e., not authoritative, and the deterministic pipeline (`pipeline.ts`) never reads or validates them. The text-extraction path (`pdf-text.ts`) has zero page awareness at all — a document number found via regex could theoretically come from any page, and the application has no way to know which one.

---

## 7. Image processing

**Formats supported**: JPEG, PNG, WEBP, GIF for AI vision (`IMAGE_MIME_TYPES` in both `anthropic-analyzer.ts:27` and `anthropic-provider.ts:18`/`openai-provider.ts:39`); upload accepts JPEG/PNG/WEBP/HEIC/HEIF (HEIC/HEIF are accepted at upload but not by either vision provider — see §4).

For every item below, checked directly against the codebase — **NOT IMPLEMENTED** unless stated otherwise:

- **Resizing**: NOT IMPLEMENTED. The raw uploaded bytes are base64-encoded and sent as-is.
- **Compression**: NOT IMPLEMENTED.
- **Rotation correction**: NOT IMPLEMENTED.
- **EXIF rotation handling**: NOT IMPLEMENTED — no EXIF parsing anywhere in the repo. A phone photo taken in portrait but stored with an EXIF rotation flag is sent to the model exactly as the raw bytes encode it; whether the model's own vision pipeline respects EXIF orientation is outside this application's control and unverified.
- **Cropping**: NOT IMPLEMENTED.
- **Contrast/sharpening adjustment**: NOT IMPLEMENTED.
- **Perspective correction** (e.g. a photographed DDT held at an angle): NOT IMPLEMENTED.
- **Image quality validation** (blur detection, too-dark, etc.): NOT IMPLEMENTED — no check ever rejects or flags a low-quality image before sending it to the model.
- **Resolution requirements / max dimensions**: NOT IMPLEMENTED — no width/height check exists; only the overall 25 MB file-size cap applies (§4).
- **Token/cost implications**: not computed or estimated anywhere — see §39/§40 (NOT OBSERVABLE).

In short: an image upload is base64-encoded and forwarded to the vision model completely unprocessed. All quality handling is fully delegated to the model.

---

## 8. OCR

Searched for: Tesseract, Google Vision, AWS Textract, Azure Document Intelligence, Google Document AI, OCR.Space, PaddleOCR, and any generic "ocr" import — **none found** anywhere in `package.json`, `src/`, or `app/`.

**There is no dedicated OCR layer; visual text extraction is being delegated entirely to the multimodal model** (Claude's native vision, and — in Flow A only — GPT-4.1's native vision/file understanding via the Responses API). The only "text extraction" code that is not a model call is the deterministic PDF/DOCX text-*layer* extractor (`pdf-text.ts`), which reads text that was already digitally embedded in the file — it performs no optical recognition of pixels at all, and therefore cannot do anything with a scanned image or a photograph.

---

## 9. AI providers — full inventory

### Provider 1 — Anthropic, Flow B (single-document)

| Field | Value |
|---|---|
| File | `src/lib/documents/anthropic-analyzer.ts` |
| Model | `process.env.ANTHROPIC_MODEL` (trimmed) or default |
| Default model | `"claude-sonnet-5"` (`DEFAULT_MODEL`, line 24) |
| API endpoint | `https://api.anthropic.com/v1/messages` (plain `fetch`, not the SDK — deliberate, per file comment, to keep the serverless bundle small) |
| Timeout | 90,000 ms (`REQUEST_TIMEOUT_MS`, line 25), via `AbortController` |
| Retry behaviour | None — a single attempt, any failure returns `status: "failed"` |
| Auth env var | `ANTHROPIC_API_KEY` (trimmed before use — comment notes a stray whitespace char pasted into Vercel's env UI would otherwise silently break every call) |
| Max tokens | 8,000 (`max_tokens`, line 256) |
| Temperature | Not set (uses the API default) |
| Structured output mode | None — free-text response constrained only by prompt instruction ("Return ONLY a JSON object") |
| JSON mode/schema | No `response_format`/tool-use JSON schema enforcement — pure prompt-level instruction, parsed by a hand-rolled `parseModelJson()` with markdown-fence stripping and brace-matching fallback |
| Images/documents passed | One PDF (`type: "document"`) or one image (`type: "image"`) per call — never more than one file |
| Prompt | `SYSTEM_PROMPT` constant, lines 35-58 — single-document schema |
| Fallback behaviour | None within this file — the caller (`index.ts`) is what falls back to the text parse |
| Error behaviour | HTTP non-200 → `status:"failed"` with response body (first 200 chars) as error detail; empty response text → `"failed"`/`EMPTY_RESPONSE`; thrown exception (including abort/timeout) → `"failed"` with the error message, distinguishing timeout via `error.name === "AbortError"` |
| Cost-sensitive logic | None |
| Provider usage logged | `logEvent("document_analysed", { provider, productCount })` (line 304) — no token/cost data |
| Latency logged | No |
| Token usage logged | No |
| Cost logged | No |

### Provider 2 — Anthropic, Flow A (multi-document)

| Field | Value |
|---|---|
| File | `src/lib/ddt-import/anthropic-provider.ts` |
| Model | `process.env.ANTHROPIC_MODEL` or default |
| Default model | `"claude-sonnet-5"` (same env var and default as Provider 1 — the two Anthropic call sites are **not unified**, they duplicate the constant independently) |
| API endpoint | Same `v1/messages`, plain `fetch` |
| Timeout | **170,000 ms** (`REQUEST_TIMEOUT_MS`, line 10) — nearly double Provider 1's 90s, and matched to the route's own `maxDuration = 170` (`analyze/route.ts:10`) |
| Retry behaviour | None |
| Auth env var | `ANTHROPIC_API_KEY` (same var as Provider 1 — **both single- and multi-document Anthropic paths share one key/quota**, not trimmed here unlike Provider 1 (**VERIFIED IN CODE**: `anthropic-provider.ts` receives `apiKey` as a parameter already resolved by the caller, `extractor.ts:72` does `.trim()` before passing it, so the net effect is the same, just structured differently) |
| Max tokens | **16,000** — double Provider 1's cap, reflecting the multi-document JSON envelope's larger expected size |
| Temperature | Not set |
| Structured output mode | None — same free-text + prompt-instruction approach as Provider 1 |
| JSON mode/schema | Same hand-rolled `parseModelJson()`/coercion pattern, but implemented separately in `coerce.ts` (shared with Provider 3, not with Provider 1) |
| Images/documents passed | One PDF or image per call (still one file, but the model is asked to find *multiple logistics documents within* that one file) |
| Prompt | `DDT_EXTRACTION_SYSTEM_PROMPT` from `prompt.ts` — the multi-document schema (see §11) |
| Fallback behaviour | None within this file — orchestrated by `extractor.ts` |
| Error behaviour | Same shape as Provider 1: HTTP error, empty response, thrown/aborted exception all map to `status:"failed"` with a specific `error` string |
| Cost-sensitive logic | None |
| Logged | `logEvent("ddt_extraction_completed", { provider: "anthropic", documentCount })` — no token/latency/cost |

### Provider 3 — OpenAI, Flow A only (no OpenAI provider exists for Flow B)

| Field | Value |
|---|---|
| File | `src/lib/ddt-import/openai-provider.ts` |
| Model | `process.env.OPENAI_MODEL` or default |
| Default model | `"gpt-4.1"` |
| API endpoint | `https://api.openai.com/v1/responses` (the Responses API, not Chat Completions) |
| Timeout | 60,000 ms — the **shortest** of the three, despite being the *second* provider tried in the fallback chain (i.e., a document that fails Anthropic after nearly 3 minutes gets only 1 more minute on OpenAI before the whole analyze call gives up — see §10/§37 for the compounding-timeout risk) |
| Retry behaviour | None |
| Auth env var | `OPENAI_API_KEY` |
| Max tokens | `max_output_tokens: 16000` |
| Temperature | Not set |
| Structured output mode | `text: { format: { type: "json_object" } }` — **this is the one provider that actually uses the API's native JSON-mode enforcement**, unlike both Anthropic call sites which rely purely on prompt instruction |
| JSON mode/schema | Native `json_object` mode (guarantees syntactically valid JSON, but not schema-conformant — the coercion layer in `coerce.ts` still validates every field) |
| Images/documents passed | PDF via `input_file` with raw base64 `file_data`; image via `input_image` with a `data:` URL |
| Prompt | Same `DDT_EXTRACTION_SYSTEM_PROMPT`, passed as `instructions` (Responses API's system-role equivalent) |
| Fallback behaviour | None within this file |
| Error behaviour | HTTP non-200 → `failed` with up to 800 chars of the response body (4x more than the Anthropic paths' 200-char cap); empty `output_text` → `"failed"`/`OPENAI_EMPTY_RESPONSE`; **zero documents parsed from an otherwise-valid response → explicitly treated as a failure** (`OPENAI_NO_DOCUMENTS`, lines 110-118) — this is the **one place in the entire codebase** where "technically valid JSON but a poor/empty extraction" is deliberately turned into a fallback-triggering failure rather than being accepted as a shrugging success (see §10's critical distinction) |
| Cost-sensitive logic | None |
| Logged | `logEvent("ddt_extraction_completed", { provider: "openai", model, documentCount })` |

### Provider 4 — the text-only fallback (not a model call, but the terminal step of the AI chain)

`src/lib/ddt-import/text-fallback.ts` — wraps the entirely separate Flow-B `analyzeDocument()` pipeline. Not a "provider" in the API sense; included here because it is a formal step in Flow A's provider-order chain (§10) and can itself invoke Provider 1 (Flow B's Anthropic analyzer) if AI keys exist but both Provider 2 and 3 already failed — a genuinely confusing cross-pipeline dependency (see §48/§50).

---

## 10. Provider order / fallback chain

**Flow A** (`extractor.ts:67-89`), exact order:

```
ANTHROPIC_API_KEY set?
   yes → extractViaAnthropic()
           status === "analysed" → RETURN (no further provider tried)
           else → record failure, continue
   no  → skip

OPENAI_API_KEY set?
   yes → extractViaOpenAI()
           status === "analysed" → RETURN
           else → record failure, continue
   no  → skip

textFallback()
   → extractViaTextLayer() → analyzeDocument() [Flow B's own pipeline]
       found real data (products/supplier/customer)?
         yes → status: "analysed" (one document only, notes disclose
               that AI splitting wasn't available)
         no, but at least one AI key was configured →
               status: "failed", error = joined provider failure strings
         no AI key at all →
               status: "unconfigured"
```

**Flow B** (`index.ts:46-121`), a **different** order — text-first, not AI-first:

```
PDF or DOCX? → extract text layer, if usable → textResult (parseInvoiceText)

configured analyzer exists (only Anthropic — no OpenAI in this flow)?
   no  → if textResult exists, return it (with an "AI not configured" note
         prepended); else return emptyResult("unconfigured")
   yes → call it
           status === "analysed" → return it (carrying over textResult's
                 extractedText field as diagnostic-only context)
           else (failed) → if textResult exists, return textResult with
                 an extra note that AI failed; else return the AI failure
```

Note the asymmetry already flagged in §6: Flow B tries text first and only calls AI if the text parse is empty/thin; Flow A tries AI first and only falls back to text (via Flow B's own logic) as the last resort. **Two different philosophies coexist in the same application for what is conceptually the same decision.**

**What counts as "failure" triggering fallback to the next provider:**
- HTTP non-200 response — yes, always triggers fallback.
- Timeout / `AbortError` — yes.
- Invalid/unparseable JSON — yes, `parseModelJson()` throws, which propagates out of `extractViaAnthropic`/`extractViaOpenAI` as an uncaught exception into their own `try/catch`, converting it into `status: "failed"`.
- Schema failure (e.g. a required field wrong type) — **no**, `coerceExtractionEnvelope()`/`coerceDocument()`/`coerceLine()` never throw on a wrong-typed field; every `asString`/`asNumber`/`asBoolean` coercion silently degrades an unexpected type to `null` (`coerce.ts:10-26`). A response with every field wrong-typed still coerces to a "successful" `ExtractedDocument` full of nulls.
- Incomplete data (some fields missing/null) — **no**, not a failure signal at the provider level. This becomes `NEEDS_REVIEW`/`READY_MISSING_OPTIONAL` **downstream** in `pipeline.ts`, never causes a fallback to the next AI provider.
- **Zero tyre lines / zero documents extracted** — **provider-dependent, and this is the critical inconsistency the brief specifically asks about**:
  - **OpenAI (Flow A)**: explicitly checked and treated as failure — `if (documents.length === 0) return { status: "failed", ..., error: "OPENAI_NO_DOCUMENTS" }` (`openai-provider.ts:110-118`). This *does* cause fallback to the text layer.
  - **Anthropic (both flows)**: **not checked at all**. `extractViaAnthropic()` returns `status: "analysed"` as long as *any* valid JSON came back and parsing didn't throw — even if `documents: []` or a document with `lines: []`. Since Anthropic is tried *first* in Flow A's chain, and a successful (even if empty) Anthropic response causes an immediate `return` (`extractor.ts:78`), **OpenAI and the text fallback are never even attempted** if Anthropic returns a syntactically valid but substantively empty result. The single-document Flow B analyzer (`anthropic-analyzer.ts`) has the identical gap — `coerceResult()` never checks `products.length` before returning `status: "analysed"`.
- Low confidence — **never** checked as a fallback trigger anywhere, by either provider or either flow. A document/line with `confidence: 0.05` is treated identically to one with `confidence: 0.95` for the purpose of deciding whether extraction "succeeded" — confidence only affects downstream review-flagging (`ExtractedProductLine.reviewFields`), never provider retry/fallback logic.
- Provider SDK/network exception — yes, always triggers fallback (caught in each provider's own `try/catch`).

**Direct answer to the brief's key question**: the system accepts the first *syntactically valid* JSON response as success for both Anthropic call sites (both flows), regardless of extraction quality — a technically valid but empty/poor Anthropic response is **never** retried against another provider. Only OpenAI, and only in Flow A, and only for the specific case of zero documents parsed, treats a poor-but-valid result as a failure worth falling back from. This is inconsistent across providers and flows, and because Anthropic is always tried first in Flow A, this gap is the one that matters most in practice (OpenAI's stricter check is effectively unreachable whenever Anthropic is configured and returns anything parseable).

---

## 11. Prompts — complete semantic structure

### Flow B system prompt (`src/lib/documents/anthropic-analyzer.ts:35-58`)

- **Role/system instruction**: "You extract structured data from tyre-industry supplier documents (invoices, delivery notes, DDT) for a logistics system." Explicitly notes documents may be Italian, Romanian, English or German with completely different layouts.
- **Task instruction**: return ONLY a JSON object matching an inline schema (single document: `supplier`/`customer`/`payment`/`products[]`/`fieldConfidence`/`notes`).
- **Anti-hallucination rules**: "NEVER invent a value... use null and add its name to that line's reviewFields... A wrong-but-plausible value is far worse than null: these are matched against real customer records." — single unified rule, no per-field variants.
- **Null/missing-value rule**: same sentence as above, applies uniformly.
- **Supplier extraction**: implicit in the schema only — no dedicated instruction paragraph beyond "the issuer is the supplier."
- **Document-number extraction**: no dedicated instruction (contrast Flow A, which has one — see below).
- **Dates**: "Dates are always YYYY-MM-DD... convert the format, never the value" with three example source formats.
- **Customer**: one explicit rule distinguishing the *final recipient* ("Destinatario / Luogo di consegna / Spett.le / Ship to") from the document issuer.
- **Destination**: folded into the same customer rule, not separate.
- **Tyre-line extraction**: "A tyre size like 225/55 R18 means width 225, aspectRatio 55, rimDiameter 18."
- **Quantity**: no dedicated rule beyond the general null/no-invention rule and the schema's `quantity: number|null`.
- **Tyre specifications**: covered only by the one size-decomposition sentence; no separate load-index/speed-rating/XL/run-flat instruction (those fields exist in the schema but the prompt gives the model no guidance on recognizing them).
- **Charges**: one rule — "Include EVERY line, including fees: PFU / contributo ambientale / eco-tax => itemType 'fee'; trasporto / spedizione / transport => itemType 'fee'; montaggio / servizio => itemType 'service'." This is the model's *own* classification hint (`itemType`), which the deterministic layer in Flow A would override — but **Flow B has no deterministic override layer at all** (§16), so for Flow B this AI-provided classification is never re-checked by code.
- **Payment**: "cashOnDelivery is true only when the document actually says contrassegno / cash on delivery / ramburs" — narrower and more literal than Flow A's payment handling (which additionally instructs the model to copy the raw text verbatim rather than classify it itself).
- **Document splitting / multiple documents / page handling**: **absent entirely** — the schema has no `pageCount`, no per-document array; Flow B's prompt has zero awareness that a PDF might contain more than one logistics document.
- **Confidence**: "confidence is 0-1 per product line. Be honest: low confidence is useful, false confidence is not."
- **Warnings**: `notes: [string]` in the schema, no dedicated instruction paragraph on when to populate it (contrast Flow A's explicit "add a note to warnings" instruction).
- **JSON-only rule**: "Return ONLY a JSON object, no prose, no markdown fences."
- **Numeric decimal-separator rule**: present — "." is always the output separator even when the source used ",".
- **Text-field fidelity rule**: "Every text field... is copied exactly as printed, just trimmed — never translate, reformat, re-case, or re-group it."

### Flow A system prompt (`src/lib/ddt-import/prompt.ts:6-67`) — shared verbatim by both Anthropic and OpenAI

- **Role/system instruction**: same opening sentence as Flow B, plus an entirely additional first paragraph: "A single uploaded PDF may contain MULTIPLE separate logistics documents... Your first job is to determine document boundaries."
- **Anti-hallucination rules**: a longer, more itemized block than Flow B's single sentence — six explicit bullet points (never infer/guess/complete a partial value; if unclear return null; `rawDescription` must be verbatim; never invent a tyre from a fee line; quantity null-not-guessed; uncertain → null + warning, never silently pick).
- **Document-number extraction**: has a dedicated rule Flow B lacks — "The DDT/document number (supplier_document_number) is the PRIMARY identifier... never confuse it with an unrelated order/reference number."
- **PFU-specific rule**: explicitly calls out that "PFU/environmental-levy quantities frequently repeat the tyre quantity on the same document; do not let that make you report a higher tyre count anywhere" — a specific, named failure mode Flow B's prompt never mentions.
- **Payment**: **structurally different philosophy** from Flow B — instructs the model to copy `paymentText` **verbatim, uninterpreted**: "a deterministic rule downstream reads this text" (matches `detectPaymentSignals()` in `ddt-payment.ts`, §27). Flow B instead asks the model to directly classify `cashOnDelivery: boolean` itself — Flow A never trusts the model with this classification, Flow B always does.
- **Tyre-line classification vs. finality**: explicit statement that the model's `itemTypeHint` is a *hint*, not authoritative — "Classify every line's likely nature via itemTypeHint, but do not decide finality — a downstream deterministic step makes the real classification." Flow B's prompt has no equivalent disclaimer (and indeed has no deterministic override layer to defer to).
- **Standard-format normalisation block**: a dedicated, more detailed section than Flow B's scattered rules — tyre size decomposition, dates, numeric decimal separator, VAT/fiscal-code exact-copy rule (Flow B has no explicit VAT-copy rule), general text-field fidelity.
- **Confidence**: "per document: be honest. Low confidence is useful signal, false confidence is not" — document-level only in this prompt's own wording (though the schema also carries no per-line confidence field at all — see §12, Flow A's `ExtractedLine` has no `confidence` field, only `ExtractedDocument.confidence`).
- **Document splitting**: the prompt's entire premise — `sourcePageStart`/`sourcePageEnd`/`colli` per document, `pageCount` at the envelope level.
- **JSON-only rule**: identical framing to Flow B.

### Contradictions between the two prompts

1. **Payment classification ownership** is inverted: Flow B has the AI decide `cashOnDelivery: boolean` directly; Flow A explicitly forbids the AI from interpreting payment text and requires verbatim copy for a separate deterministic classifier. Two different products would report different `cashOnDelivery` values for the *identical* document depending on which flow processed it, if the deterministic and AI classifications ever disagree.
2. **Line-classification authority** is inverted: Flow B's `itemType` from the AI is used as-is by `OrderReviewForm.tsx`'s default state (nothing recomputes it); Flow A's `itemTypeHint` is explicitly demoted to a hint that `classifyLine()` can and does override (text patterns win, per `ddt-classification.ts:106-114`). The same PFU line described identically in a document could be classified as a physical "fee"-typed *product* by Flow B (still becomes an inventory unit if `itemType` isn't literally `"fee"`/`"service"` — see §16's `is_physical` derivation) versus correctly excluded as a `document_charges` row by Flow A.
3. **Confidence granularity** differs: Flow B has *both* per-line confidence (`ExtractedProductLine.confidence`) and a header `fieldConfidence` map; Flow A has *only* a document-level `confidence` float, no per-line field, no `fieldConfidence` map at all — despite Flow A's `ProcessedDocumentWithMatch.extracted.confidence` being the single number copied onto *every* line by `to-analysis-result.ts:40` when converting a Flow-A document back into the Flow-B `AnalysisResult` shape for the shared review form. This means a line the model was actually unsure about and one it was fully confident about display identically once routed through "Editează și finalizează."

---

## 12. Output schema — exact, from the actual types

### Flow B — `AnalysisResult` (`src/lib/documents/analyzer.ts:98-115`)

| Field | Type | Required? | Nullable? | Source | Used downstream? |
|---|---|---|---|---|---|
| `status` | `"analysed"\|"unconfigured"\|"failed"` | yes | no | code | gates review UI, error display |
| `provider` | `string` | yes | no | code | shown as "Sursă:" on review screen |
| `supplier.name` | `string?` | no | yes | AI/regex | `supplier_name` in create-order payload |
| `supplier.vatNumber` | `string?` | no | yes | AI/regex | `supplier_vat_number` |
| `supplier.fiscalCode` | `string?` | no | yes | AI only (regex parser doesn't set it) | not sent to order-creation payload (dropped — see §33) |
| `supplier.documentNumber` | `string?` | no | yes | AI/regex | `supplier_document_number` |
| `supplier.documentDate` | `string?` (YYYY-MM-DD) | no | yes | AI/regex | `supplier_document_date` |
| `supplier.orderReference` | `string?` | no | yes | AI/regex | `supplier_reference` |
| `customer.companyName` | `string?` | no | yes | AI/regex | customer matching + `customer_name` |
| `customer.supplierCustomerCode` | `string?` | no | yes | AI/regex | matching + remembered ref |
| `customer.vatNumber` | `string?` | no | yes | AI/regex | matching |
| `customer.fiscalCode` | `string?` | no | yes | AI only | matching (identifier match) |
| `customer.deliveryRecipient` | `string?` | no | yes | AI/regex | `delivery_name`/recipient field |
| `customer.addressLine1/2` | `string?` | no | yes | AI/regex | address snapshot |
| `customer.postalCode/city/province/country` | `string?` | no | yes | AI/regex | address snapshot + location matching |
| `payment.paymentMethod` | `string?` | no | yes | AI/regex | `payment_method` |
| `payment.cashOnDelivery` | `boolean?` | no | yes | AI/regex | `requires_payment_on_delivery` (form default) |
| `payment.amountToCollect` | `number?` | no | yes | AI/regex | `amount_to_collect` |
| `payment.collectionMethod` | `string?` | no | yes | AI/regex | `collection_method` |
| `payment.currency` | `string?` | no | yes | AI/regex | `currency` |
| `products[].rawDescription` | `string` | **yes** (a line without it is filtered out) | no | AI/regex | `order_items.raw_description`, `description` fallback |
| `products[].itemType` | `string?` | no | yes | AI, backfilled by `normaliseProduct()` | `order_items.item_type` **directly, no override** |
| `products[].brand/model` | `string?` | no | yes | AI, backfilled | `order_items.brand/model` |
| `products[].width/aspectRatio/rimDiameter` | `number?` | no | yes | AI, backfilled | `order_items` structured tyre fields |
| `products[].loadIndex/speedRating` | `string?` | no | yes | AI, backfilled | `order_items` |
| `products[].extraLoad/runFlat` | `boolean?` | no | yes | AI, backfilled | `order_items` |
| `products[].quantity` | `number?` | no | yes | AI | `order_items.quantity` (form defaults to 1 if null — see §14, a real behavioral gap) |
| `products[].unitPrice/taxRate/pfuFee/logisticsFee` | `number?` | no | yes | AI | `order_items` |
| `products[].reviewFields` | `string[]` | no | — (empty array default) | code (AI + normaliser gap-fill) | drives the warning-highlighted UI row |
| `products[].confidence` | `number?` | no | yes (defaults to 0.5 in coercion) | AI (Flow B AI path) / capped ≤0.6 (regex path) | shown but not gating |
| `fieldConfidence` | `Record<string,number>` | no | — | AI only | shown, never enforced |
| `notes` | `string[]` | yes | — | code + AI | shown as bullet list on review |
| `extractedText` | `string?` | no | yes | text-layer extraction only | diagnostic only, truncated to 20,000 chars |
| `error` | `string?` | no | yes | code | not shown to end user directly (logged) |

### Flow A — `ExtractedDocument`/`ExtractedLine` (`src/lib/ddt-import/types.ts:11-85`)

| Field | Type | Required? | Nullable? | Source | Used downstream? |
|---|---|---|---|---|---|
| `supplier.name` | `string\|null` | no | yes | AI | `findOrCreateSupplier()` |
| `supplier.vatNumber` | `string\|null` | no | yes | AI | supplier lookup key |
| `document.documentNumber` | `string\|null` | no | yes | AI | dedup primary key (`normaliseDocumentNumber`), `supplier_document_number` |
| `document.documentType` | `string\|null` | no | yes | AI | **captured but never used anywhere downstream** — not read by `pipeline.ts`, not persisted to any column (dead field, see §33) |
| `document.documentDate` | `string\|null` | no | yes | AI | `supplier_document_date`, fingerprint input |
| `document.supplierOrderReference` | `string\|null` | no | yes | AI | `supplier_reference` |
| `document.trackingNumber/giro/agent/carrier` | `string\|null` | no | yes | AI | **persisted** to `orders.tracking_number/giro/agent/carrier` via `advanceDdtOrderToStored()` — the only fields in this whole system that reach the DB through a path *other* than `gorush_create_order`'s payload |
| `document.sourcePageStart/sourcePageEnd` | `number\|null` | no | yes | AI (unverified, see §6) | **never used** — not persisted, not shown in UI (dead field) |
| `document.colli` | `number\|null` | no | yes | AI | `validateTyreCount()` cross-check only, never persisted |
| `customer.*` (11 fields incl. `phone`) | `string\|null` each | no | yes | AI | matching + address snapshot; `phone` specifically is **captured but never mapped into the create-order payload's address object** (`ddt-import.ts`'s `resolveCustomerForOrder()` call omits `phone` — dead field for this flow, see §33) |
| `paymentText` | `string\|null` | no | yes | AI (verbatim only) | `detectPaymentSignals()` input |
| `lines[].rawDescription` | `string` | **yes** | no | AI | `order_items.raw_description` |
| `lines[].itemTypeHint` | enum\|null | no | yes | AI | input to `classifyLine()`, overridable |
| `lines[].supplierArticleCode` | `string\|null` | no | yes | AI | `order_items.supplier_sku` |
| `lines[].manufacturerCode` | `string\|null` | no | yes | AI | **captured, never persisted** — `order_items.manufacturer_code` column exists (added by the DDT migration) but `confirmDdtDocument()`'s item-mapping never writes it (dead field, see §33) |
| `lines[].ean` | `string\|null` | no | yes | AI | **same gap** — `order_items.ean` column exists, never written |
| `lines[].brand/model` | `string\|null` | no | yes | AI | `order_items.brand/model` |
| `lines[].width/aspectRatio/rimDiameter` | `number\|null` | no | yes | AI | `order_items` |
| `lines[].loadIndex/speedRating` | `string\|null` | no | yes | AI | `order_items` |
| `lines[].extraLoad/runFlat` | `boolean\|null` | no | yes | AI | `order_items` |
| `lines[].commercial/mudSnow/threePmsf` | `boolean\|null` | no | yes | AI | **all three captured, none ever persisted** — `order_items.commercial_c/mud_snow/three_pmsf` columns exist from the migration, `confirmDdtDocument()`'s item map never sets them (dead fields, see §33) |
| `lines[].season` | `string\|null` | no | yes | AI | **captured, never persisted** to `order_items.season` in the DDT confirm path (the column exists and IS used by the manual/Flow-B create path via `orderItemInputSchema`, just not wired from Flow A's extraction) |
| `lines[].quantity` | `number\|null` | no | yes | AI | tyre-count/physical-item-count arithmetic; a `null` line is **dropped entirely** at confirm time, never defaulted to 1 (see §14 — the one place this system gets the "don't guess 1" rule fully right end-to-end) |
| `lines[].unitWeight` | `number\|null` | no | yes | AI | **captured, never used anywhere** (no matching DB column at all — fully dead) |
| `lines[].unitPrice` | `number\|null` | no | yes | AI | `order_items.unit_price` |
| `lines[].lineTotal` | `number\|null` | no | yes | AI | used only to sum merged-duplicate lines (`pipeline.ts:146-149`), **never persisted** to any column (`order_items.line_subtotal`/`line_total` are DB columns but `confirmDdtDocument()`'s item map never sets them from `lineTotal`) |
| `lines[].vatPercent` | `number\|null` | no | yes | AI | `order_items.vat_percent` (mapped as `tax_rate` in the item payload) |
| `confidence` | `number` | yes (defaults 0.5) | no | AI | copied onto every line when converted for "Editează" (§11); **never persisted to `order_documents.extraction_confidence`** for Flow A specifically — that column is only ever written by Flow B's `analyzeStoredDocument()` (see §31) |
| `warnings` | `string[]` | yes | — | AI | becomes `doc.reasons` seed content, shown in UI |

---

## 13. Raw response parsing — traced

Both flows implement **independent, near-duplicate** JSON-extraction functions:

- Flow B: `parseModelJson()`, `anthropic-analyzer.ts:60-77`.
- Flow A: `parseModelJson()`, `coerce.ts:35-52` (a different function, same name, unrelated import graph — not shared).

Both follow the identical algorithm: trim the response text → look for a ```` ```json ... ``` ```` fence (Flow A's regex additionally handles *multiple* fences and keeps the *last* one, `coerce.ts:38-41`; Flow B's only matches if the **entire** trimmed string is one fenced block, `anthropic-analyzer.ts:63`, so a fence with leading/trailing prose outside it would fail Flow B's regex and fall through to the brace-matching fallback instead) → `JSON.parse()` the candidate → on failure, find the first `{` and last `}` in the text and `JSON.parse()` that substring → on failure, throw.

**Markdown-fence removal**: as above, both flows handle it, with the noted regex difference.

**Malformed JSON recovery**: the brace-slice fallback is the only recovery mechanism; there is no JSON5/jsonrepair-style tolerant parser, no retry-with-a-different-prompt, nothing beyond "find outermost braces."

**Schema validation**: **none, in the JSON-Schema sense** — no Zod/ajv/io-ts validation of the parsed object's shape before coercion. Coercion (`coerceResult()`/`coerceDocument()`/`coerceLine()`) is itself the only validation, and it is permissive-by-default (§10, §14): every field access is `(value ?? {})`-guarded and every wrong type silently becomes `null`/`false`/`[]`, never a thrown error. A response with `products` as a string instead of an array degrades to `products: []`.

**Numeric conversion**: Flow B's `asNumber()` (`anthropic-analyzer.ts:85-92`) is more permissive than Flow A's `asNumber()` (`coerce.ts:16-18`): Flow B additionally accepts a *string* number and strips non-numeric characters before `Number()`-coercing it (`value.replace(/[^0-9.-]/g, "")`) — so `"4 pcs"` → `4`, `"€12.50"` → `12.50`, but `"1.234,56"` (a European-formatted number sent as a string, which the prompt explicitly forbids but nothing enforces) → `1.234` after stripping the comma, which is **wrong by a factor of 1000** if the model ever violates its own formatting instruction and returns a raw string in this shape. Flow A's `asNumber()` is strict — only accepts an actual JSON `number`, any string (even `"4"`) becomes `null`.

**Date conversion**: **no dedicated date-parsing/validation exists in either coercion layer** — `documentDate`/etc. pass through `asString()` unchanged; the "must be YYYY-MM-DD" rule is enforced **only by prompt instruction**, never verified or reformatted in code. A model that returns `"31/12/2026"` despite the instruction is stored and used as-is (it would fail the `isoDate` Zod regex at the `/api/admin/orders` boundary only if it reaches that route directly as the top-level `supplier_document_date` — Flow A's confirm path passes it straight into the RPC's `::date` cast, which would throw a Postgres error rather than a clean validation message; see §36).

**Trimming**: every `asString()` in both coercion layers trims and converts empty-string to `null`.

**Null handling**: consistent — `null`/`undefined`/wrong-type all collapse to `null` (or `[]` for arrays, `false`/`null` for booleans depending on the helper).

**Arrays**: `Array.isArray()` guarded everywhere; a non-array `lines`/`products`/`documents` value becomes `[]`.

**Missing fields**: absent key ≡ `undefined` ≡ same as present-but-null, handled identically by the `??`-defaulted destructuring.

**Unexpected/extra fields**: silently ignored (no `.strict()`-equivalent anywhere in this parsing path — contrast the Zod schemas at the HTTP-route boundary, §36, which *do* use `.strict()`).

**Invalid quantities**: see §14/§18.

---

## 14. Coercion logic — field by field, traced to actual code

| Model returns | Flow B (`anthropic-analyzer.ts` `asNumber`/`asString`/`asBoolean`) | Flow A (`coerce.ts` `asNumber`/`asString`/`asBoolean`) |
|---|---|---|
| Wrong type generally (e.g. number where string expected) | `asString`: not a string → `null`. `asNumber`: number passes through; non-number/non-finite → `null` unless it's a coercible string (see below) | Same `asString` behaviour. `asNumber`: **only** accepts an actual finite JS number — a JSON string "4" is `null`, no coercion attempt at all |
| Empty string `""` | `asString` → `null` (trimmed-empty check) | Same |
| The literal string `"null"` | **Not treated as null** — `asString("null")` returns the string `"null"` (four characters), since it doesn't match JS `null`/`undefined` and isn't empty after trim. This is a **real bug surface**: if a model ever emits the string `"null"` instead of the JSON literal `null` (rare but not impossible, especially in less disciplined provider output), the field is saved as the literal text "null" rather than being treated as missing | Identical behaviour, identical gap |
| The literal string `"N/A"` | Same — stored verbatim as the string `"N/A"`, not normalized to null anywhere in either coercion layer | Same |
| Malformed/garbage value | Falls through to `null` for numbers; stored verbatim for strings (no format validation at coercion time — e.g. an obviously-invalid VAT number is stored exactly as returned) | Same |
| Decimal comma (`"4,5"` as a string) | `asNumber("4,5")` → `value.replace(/[^0-9.-]/g, "")` strips the comma entirely (not converts it) → `"45"` → **`45`, not `4.5`** — a genuine, verified numeric corruption bug in Flow B's string-number coercion path, though the prompt instructs the model to always use "." and never emit a raw comma-decimal string in the first place, so this only fires if the model disobeys | `asNumber` rejects any string outright → `null`. Flow A is *safer* here purely because it's stricter, not because it handles the comma correctly |
| Decimal point (`"4.5"` as a string) | `asNumber("4.5")` → strips nothing (already valid) → `4.5` — correct | `null` (string rejected regardless of validity) |
| Quantity as text (`"4"`) | `asNumber("4")` → `4` — coerces correctly | `null` — Flow A silently loses a quantity the model returned as a numeric string, even though it's unambiguous |
| Quantity as `"4 pcs"` | `asNumber("4 pcs")` → strip non-digits → `"4"` → `4` — coerces correctly by accident of the strip-then-parse approach | `null` |
| Negative quantity | **No sign check anywhere in either coercion layer.** A negative `quantity`/`unitPrice` passes through as-is at the coercion stage. The **first** place a negative number is ever rejected is the Zod schema at `/api/admin/orders` (`orderItemInputSchema.quantity: z.number().int().min(1).max(500)`, `validation/logistics.ts:52`) — but that schema only runs for the **manual/Flow-B save path**. Flow A's `confirmDdtDocument()` → `createOrder()` path calls `gorush_create_order` **directly via RPC, bypassing `createOrderSchema`/`orderItemInputSchema` entirely** (confirmed: `ddt-import.ts`'s `confirmDdtDocument()` builds the RPC payload itself and calls `createOrder()`, which does not re-validate against the Zod item schema — see §36). A negative quantity extracted by AI in Flow A would reach `gorush_create_order`'s SQL, which does `greatest(coalesce((v_item->>'quantity')::integer, 1), 1)` (the migration's own `gorush_create_order` body, confirmed in this session's stand-removal migration work) — **this `greatest(...,1)` floor actually saves the day here**: a negative or zero quantity is clamped up to 1 inside the RPC itself, silently. That is itself a different, quieter problem: a genuinely negative/zero AI-misread quantity becomes a **silent 1**, deep in SQL, invisible to the review screen (which already showed and let the admin edit the pre-clamped value) |
| Zero quantity | Passed through by both coercion layers (zero is a valid finite number). Same RPC-level `greatest(...,1)` clamp applies as above for Flow A's direct-RPC path; the Zod schema's `min(1)` would reject it outright (400 `VALIDATION_FAILED`) for the manual/Flow-B path |
| Currency symbol in a number string (`"€12.50"`) | `asNumber` strips it via the same non-digit regex → `12.50` — correct by construction | `null` |
| Thousands separator (`"1,234.56"`) | Strip regex removes the comma → `"1234.56"` → `1234.56` — correct, coincidentally, only because it strips rather than parses positionally | `null` |
| Boolean as string (`"true"`) | `asBoolean` only accepts an actual JS boolean → `null` for a string `"true"` in both flows | Same |

**Summary**: Flow B's regex-strip approach to numeric coercion is more forgiving for well-behaved American-format numeric strings but has a **specific, real corruption bug** for decimal-comma strings (divides nothing, multiplies effectively by ~10-1000x depending on digit count, since it just deletes the comma instead of substituting it). Flow A is strict-typed and simply drops any numeric value the model expresses as a string, silently losing otherwise-recoverable data. Neither flow validates sign or realistic bounds before the RPC layer.

---

## 15. Deterministic validation — every rule, individually

All of the following exist **only in Flow A** (`src/lib/ddt-import/pipeline.ts` + `src/lib/logistics/ddt-*.ts`). **Flow B has zero deterministic validation rules of this kind** — see §16 for what that means concretely.

**Rule 1 — PFU/fee line classification always overrides the AI hint**
Input: `rawDescription` text + AI's `itemTypeHint`.
Logic: `classifyLine()` (`ddt-classification.ts:106-114`) checks `rawDescription` against `PFU_PATTERNS`/`LOGISTICS_FEE_PATTERNS`/`TRANSPORT_FEE_PATTERNS`/`DISCOUNT_PATTERNS`/`VAT_PATTERNS` **first**, in that priority order; only if none match does it fall back to the AI's hint, then to `"UNKNOWN"`.
Result: `ClassifiedLineType`.
Blocking or warning: neither directly — feeds into whether the line becomes a `physicalItems` entry or a `charges` entry, which in turn affects `tyreCount`/`blocked` status.
Code: `src/lib/logistics/ddt-classification.ts`.

**Rule 2 — tyre_count is computed, never trusted from the AI**
Input: classified+quantified lines.
Logic: `calculateTyreCount()` = `SUM(quantity WHERE lineType === "TYRE")`, nothing else, ever (`ddt-calculations.ts:18-22`).
Result: integer.
Blocking: no — informational, but this integer is what the tyre-count-vs-colli cross-check (Rule 4) and the transport-revenue calculation (Rule 5) both build on.
Code: `src/lib/logistics/ddt-calculations.ts`.

**Rule 3 — physical vs. non-physical line separation**
Input: classified lines.
Logic: `isPhysicalLine()` — `TYRE`/`TUBE`/`RIM`/`OTHER_PHYSICAL_ITEM` are physical; everything else (`PFU`/`LOGISTICS_FEE`/`TRANSPORT_FEE`/`DISCOUNT`/`VAT`/`OTHER_FEE`/`TEXT_NOTE`/`UNKNOWN`) is not.
Result: routes a line to `physicalItems[]` (→ becomes an `order_item` + inventory units) or `charges[]` (→ becomes a `document_charges` row only).
Blocking: indirectly — zero physical items with a readable quantity is one of the three hard-blocking conditions (Rule 8).
Code: `ddt-classification.ts:29-33`, applied in `pipeline.ts:171-172`.

**Rule 4 — tyre count vs. "colli" (declared package count) cross-check**
Input: `tyreCount`, `physicalItemCount`, `colli` (AI-extracted, never trusted alone).
Logic: `validateTyreCount()` — `OK` if `colli === null`, or `colli === tyreCount`, or `colli === physicalItemCount`; otherwise `TYRE_COUNT_REVIEW_REQUIRED`.
Result: `"OK" | "TYRE_COUNT_REVIEW_REQUIRED"`.
Blocking or warning: **warning only** — explicitly never blocks (`pipeline.ts:245-247`, confirmed by the dedicated test `"requires review when the difference can't be explained"` asserting `blocked` stays `false`).
Code: `src/lib/logistics/ddt-calculations.ts:46-55`.

**Rule 5 — transport revenue is computed in code from a stored rate, never AI-derived**
Input: `tyreCount`, `ratePerTyre` (from `app_settings`, defaulting to €2.00 if the row is missing).
Logic: `Math.round(tyreCount * ratePerTyre * 100) / 100` (explicit cent-rounding to avoid floating-point drift).
Result: numeric revenue, snapshotted onto the order at confirm time (`transport_rate_snapshot`/`transport_revenue`) so a later rate change never rewrites historical numbers.
Blocking: no.
Code: `src/lib/logistics/ddt-calculations.ts:31-35`.

**Rule 6 — payment signals are regex-literal, never inferred**
Input: `paymentText` (AI-copied verbatim, never AI-classified).
Logic: `detectPaymentSignals()` — three fixed regex sets (`CASH AUTISTA`/`CONTANTI`, `CONTRASSEGNO ASSEGNO`, `RICEVUTA BANCARIA`); no fuzzy matching, no inference from amount/context/customer history.
Result: `{ cashRequired, chequeRequired, paymentMethod }`.
Blocking: no — purely informational, written to `orders.cash_required`/`cheque_required`/`payment_method`.
Code: `src/lib/logistics/ddt-payment.ts`.

**Rule 7 — exact duplicate detection (supplier + normalized document number)**
Input: `supplierId`, `normalizedDocumentNumber` (only computed when `documentNumber` is non-null).
Logic: `findExactDuplicate()` — linear scan of `existingOrders` for a matching `(supplierId, normalizedDocumentNumber)` pair, falling back to normalizing the candidate's *raw* `supplier_document_number` if its `normalized_document_number` column is null (handles pre-migration rows).
Result: the matching order or `null`.
Blocking or warning: **this is the one thing that can make status `DUPLICATE`** — takes precedence over everything else including the fingerprint check (Rule 8) and even over `blocked`-triggering conditions (a duplicate is reported as `DUPLICATE` even if the document also happens to be missing a supplier, per the `if (exactDuplicate) { status = "DUPLICATE" }` branching order in `pipeline.ts:253-255`, which runs before the `blocked` check). Not itself a hard block at the application layer — a human can force-confirm via "Adaugă din nou" (§28) — but the **database's own unique index** (`orders_supplier_doc_number_key`) is the real, unconditional backstop (§28).
Code: `src/lib/logistics/ddt-dedup.ts:44-58`.

**Rule 8 — near-duplicate fingerprint (fuzzy)**
Input: normalized supplier/customer name, postal code, document date, an order-independent item signature, tyre count — all hashed with SHA-256.
Logic: `computeOrderFingerprint()`; compared against `existingFingerprints` (the 2,000 most recent orders' fingerprints, fetched once per upload batch and cached across documents from the same supplier within that batch — `ddt-import.ts:184` `getRecentFingerprints(limit=2000)`).
Result: matched order id or `null`.
Blocking or warning: warning only (`POSSIBLE_DUPLICATE`) — **never an automatic skip or auto-import block**, explicitly requires a human "Adaugă din nou" decision.
Code: `src/lib/logistics/ddt-dedup.ts:71-97`.

**Rule 9 — the three hard-blocking conditions**
Input: `extracted.supplier.name`, `extracted.customer.companyName`, `importableItemCount` (physical items with a non-null quantity).
Logic: `blockingIssues` array populated with any of "Furnizor neidentificat" / "Client neidentificat" / "Niciun produs cu cantitate citibilă" — **these three, and only these three, ever set `blocked = true`**.
Result: `blocked: boolean`.
Blocking: **yes, always** — `canAutoConfirmDdtDocument()` and `canForceConfirmDdtDocument()` both hard-require `!doc.blocked` regardless of `status`.
Code: `pipeline.ts:233-236`.

**Rule 10 — unreadable-quantity lines force review but never block (unless they're the *only* line)**
Input: physical lines with `quantity === null`.
Logic: `processLines()` separates them into `unreadableQuantityLines`, entirely excluded from `countableLines` (never merged, never defaulted to 1).
Result: if `unreadableQuantityLines.length > 0`, added to `reviewIssues` → forces `NEEDS_REVIEW`, but does **not** set `blocked` unless it also means `importableItemCount === 0` (Rule 9).
Code: `src/lib/logistics/ddt-lines.ts`.

**Rule 11 — identical physical lines merge, quantities summed**
Input: physical lines matching on every structured field except quantity/free-text.
Logic: `mergeIdenticalPhysicalLines()` in `pipeline.ts:120-156` — a JSON-stringified composite key over brand/model/size/load/speed/XL/run-flat/commercial/mud-snow/3PMSF/season/SKU/manufacturer-code/EAN/price/VAT; a line with `quantity === null` is never merged (kept standalone, so it can't silently absorb into another line's readable quantity or vice versa).
Result: fewer, quantity-summed physical items.
Blocking: no — affects what the review screen and eventual `order_items` show, not the aggregate `tyreCount`/`physicalItemCount` totals (those are computed from *all* matching lines regardless of merge).
Code: `pipeline.ts:83-156`.

**Rule 12 — optional-field completeness downgrades READY → READY_MISSING_OPTIONAL**
Input: `customer.phone`, `customer.postalCode`.
Logic: if either is missing and no other issue exists, status becomes `READY_MISSING_OPTIONAL` rather than `READY`.
Blocking: no — `canAutoConfirmDdtDocument()` treats both the same (only checks `!blocked` + a resolvable customer decision), so this distinction is cosmetic/informational only in practice.
Code: `pipeline.ts:266-274`.

### What Flow B has instead: nothing structurally equivalent

Flow B's only quasi-deterministic layer is `normaliseProduct()` (`src/lib/logistics/product-normalise.ts`) — but this is a **gap-filler**, not a **validator**: it only ever fills a `null` the AI left, never overrides or re-checks a value the AI *did* provide (`coerceResult()` in `anthropic-analyzer.ts:122-148` uses `asString(line.itemType) ?? local.itemType` — the AI's non-null value always wins). There is no equivalent to `classifyLine()`'s "text pattern always overrides the AI" rule, no duplicate detection of any kind (no fingerprint, no document-number uniqueness check beyond whatever the database's own unique index catches at insert time — but Flow B's create path doesn't even normalize the document number before that check, unlike Flow A), no tyre-count-vs-colli cross-check, no payment-text-verbatim-then-classify separation. A PFU line extracted through Flow B and left with the AI's own `itemType` (which the Flow-B prompt does correctly instruct the model to set to `"fee"`) is trusted as-is — but if the model mis-tags it as `"tyre"` (no code checks), Flow B has no second line of defense, whereas Flow A's `classifyLine()` would catch the literal word "PFU" in the description regardless of what the model said.

---

## 16. Tyre-line classification — deep inspection

**Flow A's classifier** (`src/lib/logistics/ddt-classification.ts`) is entirely regex/keyword-based, no AI, no heuristic scoring — a line either matches a fee pattern (checked in a fixed priority order: PFU → logistics fee → transport fee → discount → VAT) or it doesn't, and if it doesn't, the AI's `itemTypeHint` is used as-is, then `"UNKNOWN"` as the final fallback (never a guessed physical type from nothing).

**Italian terminology actually recognised** (verified against the regex source, `ddt-classification.ts:40-70`):

| Category | Patterns |
|---|---|
| PFU | `PFU` (word boundary), `contr.amb`/`contributo ambientale`, `eco-contribut`, `contributo pneumatic`, plus four supplier-specific alphanumeric codes: `EPP\d+`, `CAP\d+`, `ETP\d+`, `GTP\d+` |
| Logistics fee | `addebito spese logistiche`, `spese logistiche`, `spese di movimentazione`, `recupero spese trasporto`, generic `logistics` |
| Transport fee | `spese di trasporto`, `trasporto`, `shipping`, `transport fee`, `spese accessori` |
| Discount | `sconto`, `discount` |
| VAT | `IVA`, `VAT`, `bolli` |

Cross-checked against the brief's example list — `PFU` ✓, `CONTRIBUTO PFU` ✓ (matches the `contributo pneumatic` and bare `PFU` patterns both), `TRASPORTO` ✓, `PORTO` — **not matched by any pattern** (a common Italian shipping term, absent from `TRANSPORT_FEE_PATTERNS`; a line reading only "PORTO" would fall through to the AI's hint or `UNKNOWN`), `SPESE` — only matched as part of longer compound phrases (`spese di trasporto`, `spese logistiche`, `spese accessori`); a bare `SPESE` alone matches none of the fee regexes, `SERVIZIO`/`SERVICE` — **not in `ddt-classification.ts` at all** (it's classified only by the AI's `itemTypeHint`, since this classifier has no service-detection pattern of its own — though `product-normalise.ts`'s separate `SERVICE_HINTS` array *does* recognize `servizio`/`serviciu`/`manodopera`/`labour`/`service`, but that module is **not** what Flow A's `classifyLine()` uses), `SCONTO` ✓, `PNEUMATICO`/`PNEUMATICI`/`GOMME` — **none of these are physical-type-detection patterns in `ddt-classification.ts`**, because that file has no positive tyre-detection regex at all — it only detects *fees*; everything that isn't a fee falls to the AI's hint. The actual tyre-size-based detection (`SIZE_PATTERN`) lives only in the separate `product-normalise.ts` module, which Flow A's pipeline does **not** call at all (confirmed: `pipeline.ts` never imports `product-normalise.ts`; only `OrderReviewForm.tsx` and Flow B's `text-invoice-parser.ts`/`anthropic-analyzer.ts` do).

**This is a real, verified gap**: Flow A has no independent tyre-detection logic — it relies entirely on the AI's `itemTypeHint` for anything that isn't a recognized fee pattern. If the AI mislabels a genuine tyre line as `itemTypeHint: null` or an unrecognized value, `classifyLine()` returns `"UNKNOWN"` (not a fee, not a physical type), which is excluded from `physicalItems` (since `UNKNOWN` isn't in `PHYSICAL_LINE_TYPES`) — a real tyre could silently vanish from the order rather than being miscounted, which is arguably safer than the reverse but is still a data-loss failure mode with no test coverage for it (the test suite only covers `itemTypeHint: "tyre"` explicitly present, or an explicit fee pattern; there's no test for "no hint, no fee match, description clearly says PNEUMATICO").

**Flow B's `product-normalise.ts`**, by contrast, *does* have positive multi-language hint lists (`TUBE_HINTS`, `WHEEL_HINTS`, `FEE_HINTS` — includes `pfu`/`contributo`/`eco`/`ecotassa`/`smaltimento`/`taxa`/`taxă`/`fee`/`spese`/`trasporto`/`transport`/`spedizione`/`shipping`/`porto`/`iva` — **this list does include "porto"**, unlike Flow A's regex set — and `iva`, `SERVICE_HINTS`, `ACCESSORY_HINTS`) plus a genuine tyre-size regex (`SIZE_PATTERN`) as the strongest positive signal for "this is a tyre." This module is more linguistically complete than Flow A's classifier for fee-word coverage, but — as noted in §15 — it is only ever used to *fill gaps*, never to *override* what the AI already said, so it cannot correct a wrong AI classification the way Flow A's `classifyLine()` can.

---

## 17. Tyre size parsing

Two independent size parsers exist:

**`product-normalise.ts`'s `parseTyreSize()`** (used by Flow B's regex parser and as the AI-gap-filler in both `anthropic-analyzer.ts` and Flow B's text parser): `SIZE_PATTERN = /\b(\d{3})\s*[/\-]\s*(\d{2})\s*(?:Z?R|R|-)\s*(\d{2}(?:[.,]\d)?)\b/i` — matches `205/55 R16`, `225/45R17`, `225-55-18`. **Explicitly handles the `Z?R` speed-symbol-prefixed rim marker** (e.g. `225/45 ZR17`), and the rim group accepts a decimal (`(?:[.,]\d)?`) for commercial sizes like `R17.5`. Sanity-bounded: width 100–500, aspect-ratio 20–100, rim 10–30 — values outside these ranges are rejected as "not a tyre size, a coincidence" (`product-normalise.ts:219-221`).

Tested against the brief's example list:
- `205/55 R16` ✓, `225/45R17` ✓ (no-space form), `225/45 ZR17` ✓ (Z-prefix), `315/80 R22.5` ✓ (decimal rim within the 10–30 bound) — all match.
- `185 R14C` and `195/75 R16C` — **these do NOT match `SIZE_PATTERN`** as written: the regex requires the `width/aspectRatio` two-number form (`\d{3}\s*[/\-]\s*\d{2}`); a **commercial single-number size like `185 R14`** (no aspect ratio, a legitimate van-tyre notation) has no aspect-ratio group to match at all — **confirmed gap, not handled**. The trailing `C` (commercial-load marking) also isn't captured or detected anywhere as a distinct boolean (there's no `commercial`/`isCommercial` output from this parser at all — contrast Flow A's `ExtractedLine.commercial` field, which exists in the *type* but is only ever populated by the AI, never derived deterministically, and — per §12 — never even persisted to the DB).

**`ExtractedLine.width/aspectRatio/rimDiameter`** (Flow A): purely AI-extracted, no deterministic parser cross-checks or re-derives them from `rawDescription` at all — Flow A trusts the model's own decomposition entirely for these three fields (the prompt does instruct the model to always split the size out, §11, but nothing in `pipeline.ts` or `coerce.ts` verifies the split against the raw text).

**Load index / speed rating** (`parseLoadSpeed()`, `product-normalise.ts:226-244`): searches only the text *after* the matched size (to avoid misreading the size's own digits), pattern `/\b(\d{2,3})(?:\s*\/\s*(\d{2,3}))?\s*([A-Z])\b/` — handles single (`98V`) and dual (`103/101T`) load-index forms, returns `{loadIndex, speedRating}` or both-null if no size was found first (load/speed parsing is size-dependent by design).

**XL / Extra Load**: `detectExtraLoad()` — regex `/\b(XL|EXTRA\s*LOAD|REINFORCED)\b/`, boolean-or-null (never `false` — absence of the marker is "unknown," not "confirmed standard load," a deliberate honesty choice).

**Run-flat**: `detectRunFlat()` — recognizes the generic term plus **brand-specific run-flat codes**: `RUN FLAT`, `RUNFLAT`, `ROF` (Continental), `RFT` (Bridgestone), `ZP` (Michelin Zero Pressure), `SSR` (self-supporting), `DSST` (Dunlop), `MOE` (Michelin), `EMT` (Goodyear), `SEAL`, `RSC` (BMW designation).

**Model** (`product-normalise.ts:305-316`): derived by stripping the detected brand, the size pattern, the load/speed pattern, and known technical-marking tokens (`XL`, `RUN FLAT`, `ROF`, `RFT`, `ZP`, `SSR`, `DSST`, `MOE`, `FR`, `MFS`) from the raw text, leaving whatever's left as a best-effort "model" string — explicitly documented as noisy/unauthoritative (`"Often noisy, so it is never treated as authoritative"`, line 304).

**Brand**: `detectBrand()` — a fixed 44-entry known-brand list (Michelin, Pirelli, Continental, Bridgestone, Goodyear, Dunlop, Hankook, Yokohama, Toyo, Nokian, Vredestein, Falken, Kumho, Nexen, Maxxis, Kleber, BFGoodrich, Firestone, Sava, Fulda, Uniroyal, Semperit, Barum, Matador, Debica, Riken, Tigar, Kormoran, Apollo, Ceat, GT Radial, Linglong, Sailun, Triangle, Windforce, Petlas, Lassa, Laufenn, Rotalla, Imperial, Nankang, Zeetex, Kenda, CST, Vittoria, Schwalbe) — matched longest-first so multi-word brands (e.g. "GT Radial") aren't shadowed by a shorter false match; an unrecognized brand is left `null` for a human to fill in, never guessed.

**EAN / manufacturer code**: `ExtractedLine.ean`/`manufacturerCode` exist as AI-extractable fields in Flow A's type (§12) but there is **no deterministic parser** for either anywhere in the codebase, and — as noted in §12 — neither is ever persisted even when the AI does supply them.

**Season**: `ExtractedLine.season` (AI-only, free string, no enum/parser); `product-normalise.ts` has no season detection at all.

**Conclusion for the brief's explicit question**: the system does extract *some* structured tyre characteristics (width/aspect-ratio/rim, load/speed via the AI in both flows and via `parseTyreSize()`/`parseLoadSpeed()` deterministically in Flow B; XL and run-flat deterministically via keyword regex in Flow B only), but it does **not** keep only a free-text description — structured fields are a first-class part of both `order_items` and the review UI. However, coverage is uneven: commercial (C-suffix) single-number sizes are not deterministically parsed at all, EAN/manufacturer-code/season are captured by the AI schema but architecturally dead (never reach the database), and Flow A has no deterministic size/brand parser of its own to cross-check or correct the AI's structured output the way Flow B's `normaliseProduct()` gap-fills (never overrides) it.

---

## 18. Quantity extraction

**AI-only, text-parser-only, or cross-checked?** Both, per flow, never cross-checked against each other (the two flows never run side-by-side on the same document).

- **Flow A (AI, both providers)**: `ExtractedLine.quantity: number|null` — a pure model output, `asNumber()`-coerced (strict — a numeric-*string* quantity is silently dropped to `null`, per §14). No regex-based quantity extraction exists in this flow at all; the model is the sole source.
- **Flow B AI path**: same shape, but `anthropic-analyzer.ts`'s `asNumber()` is the *permissive* variant — accepts a numeric string and strips non-digit characters (§14), so `"Q.tà: 4"` embedded oddly inside a JSON string field would still coerce if the model ever returned quantity as a string rather than a number (deviating from its own JSON-number instruction).
- **Flow B deterministic/regex path** (`text-invoice-parser.ts:217-221`, only reached when no AI is configured or text-extraction is tried standalone): two patterns tried in order — a labelled form `/(?:q\.?t[àa]?|qty|pz|pezzi|buc)\s*[:.]?\s*(\d{1,3})\b/i` (covers `Q.tà`, `QTA`, `Quantità`, `qty`, `PZ`, `pezzi`, and the Romanian `buc`) and a fallback "leading number before a word" form `/^\s*(\d{1,3})\s+[A-Za-z]/`. **`NR` (a common Italian quantity abbreviation, listed explicitly in the brief) is not in this pattern set** — a line quantified only as "NR 4" would not match either regex and would report `quantity: null`.

**Specific formats checked against actual code**:
- `Q.tà` / `QTA` / `Quantità` — ✓ matched by Flow B's regex label group.
- `PZ` / `PZ.` — ✓ (`pz` in the alternation; the optional trailing `.` is covered by the `[:.]?` separator group, not the label itself, but functionally works since the period is just consumed as a separator).
- `NR` — **not matched**, confirmed gap.
- `units` (English) — not in the label list; only reachable via the generic "leading number + word" fallback pattern if `units` happens to be the next word, e.g. `"4 units"` would match the fallback `^\s*(\d{1,3})\s+[A-Za-z]` pattern coincidentally, but a mid-line `"... 4 units ..."` would not.
- `4,00` (comma as decimal, meaning integer 4) — the quantity regexes only ever capture `\d{1,3}` (digits only, no comma/decimal group at all) — so `"4,00"` would match just the leading `4` correctly by accident (the regex stops at the first non-digit), giving the right answer for this specific case, but `"4.000"` (a thousand-separator meaning 4000, or a European decimal meaning 4) would **also** just capture `4` — silently wrong if `4.000` meant "four thousand," silently right if it meant "4,000 formatted with a thousands separator for a whole number four."
- Negative quantities — not specifically rejected by either flow's extraction regex/AI-coercion (see §14's negative-quantity row — the RPC's `greatest(...,1)` floor is the only place a negative is ever actually corrected, and it does so by silently forcing `1`, not by flagging).
- Returns — no distinct handling; a return-document's negative-quantity convention (if any suppliers use one) is not specifically recognized anywhere.
- Zero quantities — same as negative: passed through by coercion, floored to 1 by the RPC in Flow A's direct-RPC path, rejected by the `min(1)` Zod schema in the manual/Flow-B path.
- Missing quantities — the one case handled *well and consistently*: both flows represent this as `null`, and Flow A's pipeline explicitly never merges, never counts, and never silently defaults a `null` quantity to 1 anywhere before the RPC boundary (§15 Rule 10). This is the single most carefully-implemented rule in the entire system.
- Multiline rows (a product description wrapping across two physical lines in the source PDF, with the quantity only appearing once): **not specifically handled** — the AI is expected to correctly associate the wrapped description with its quantity as part of normal vision/text understanding; there is no code-level line-joining/wrapping-detection logic in either flow.

**What happens when quantity is genuinely unreadable**: consistent and correct across the write path — `null` propagates through coercion, through `processLines()` (Flow A) as an `unreadableQuantityLines` entry (never counted, never merged), and at `confirmDdtDocument()` time such a line is **dropped from the items array entirely** rather than saved with a guessed value (`ddt-import.ts`: `droppedLineCount = processed.physicalItems.filter((line) => line.raw.quantity === null).length`, and the `items` array passed to `createOrder()` explicitly `.filter((line) => line.raw.quantity !== null)` beforehand). The admin is told via `droppedLineCount` in the confirm response and a UI message to add the line manually from the order page afterward.

---

## 19. Price / financial extraction

**What's extracted**: `unitPrice` (both flows), `lineTotal` (Flow A only, as a type field), `taxRate`/`vatPercent` (both, different field names), `pfuFee`/`logisticsFee` (Flow B's `ExtractedProductLine` has explicit `pfuFee`/`logisticsFee` number fields — Flow A has no equivalent per-line fee-amount fields; PFU/fee *amounts* in Flow A live only inside `document_charges.unit_amount/total_amount`, populated at confirm time from the *charge line's own* `unitPrice`/`lineTotal`, not from a dedicated PFU-fee field on the tyre line itself), invoice-level total (**not extracted or tracked anywhere in either flow** — no `documentTotal`/`invoiceTotal` field exists in either `AnalysisResult` or `ExtractedDocument`), transport revenue (Flow A only, **code-computed**, never AI-extracted — §15 Rule 5).

**What's ignored**: any invoice-level subtotal/total/VAT-summary line the source document prints — neither flow's prompt asks for it, neither type has a field for it, so even if the model happened to notice it, there's nowhere for it to go.

**What's persisted**: `order_items.unit_price`, `.vat_percent`, `.line_subtotal` (computed in `gorush_create_order`'s SQL as `unit_price * quantity`, **not** from any AI-provided `lineTotal`), `.environmental_fee`/`.logistics_fee` (from Flow B's `ExtractedProductLine.pfuFee`/`.logisticsFee` — but only reachable via the manual/Flow-B `orderItemInputSchema`, which does have `pfu_fee`/`logistics_fee` fields; Flow A's `confirmDdtDocument()` item-mapping, checked directly, does **not** set `pfu_fee`/`logistics_fee` on the physical order_items it creates, since Flow A's PFU lines are routed to `document_charges` instead, never to a tyre line's own fee fields — so these two columns are, in practice, **only ever populated by the manual/Flow-B path**, never by Flow A). `document_charges.unit_amount`/`.total_amount` (Flow A confirm only, from each charge line's `raw.unitPrice`/`raw.lineTotal`). `orders.transport_rate_snapshot`/`.transport_revenue` (Flow A confirm only).

**What's used for order creation**: `unit_price`, `vat_percent` (both reach `gorush_create_order`'s item payload). `lineTotal` is used only internally by `mergeIdenticalPhysicalLines()` to sum merged duplicate lines' totals (§15 Rule 11) — it is **read but never written anywhere**, a genuinely dead field at the persistence layer.

**What's only shown in review**: nothing extra beyond what's listed — the review screen (`OrderReviewForm.tsx`) shows exactly the same `unitPrice`/`taxRate` fields that get saved; there's no "shown but discarded" financial field in the UI.

**Decimal-comma support**: at the AI-extraction level, both prompts instruct the model to always normalize to a `.`-separated JSON number, so in the happy path this is a non-issue. At the coercion level, per §14: Flow B's string-quantity coercion actively **corrupts** a raw decimal-comma string if one ever slips through (strips the comma rather than converting it); Flow A simply drops such a string to `null`. Flow B's *deterministic* text-parser (`text-invoice-parser.ts`'s `parseAmount()`, lines 96-102) is the **one place in the whole codebase that correctly handles Italian-format amounts**: `AMOUNT_PATTERN = /(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|\d+[.,]\d{2})/` recognizes `1.234,56` (thousands-dot, decimal-comma) and converts properly (strips `.`/space thousands separators, converts the decimal `,` to `.`) — this logic is **not reused anywhere else**, including not by either AI-coercion path.

**Arithmetic reconciliation**: **NOT IMPLEMENTED** — nothing anywhere sums the extracted line totals and compares them against a document-level total (there being no document-level total extracted at all, per above, this couldn't be checked even if the code wanted to). The only cross-check of any kind in the entire system is the tyre-count-vs-colli check (§15 Rule 4), which is a unit-count reconciliation, not a financial one.

---

## 20. Document type handling

**NOT IMPLEMENTED as an explicit classification.** Neither flow's type system has a `documentCategory`/`invoiceType` enum distinguishing invoice / DDT / delivery note / credit note / packing list / order confirmation / sales receipt / unknown. Flow A's `ExtractedDocument.document.documentType` is a free-text `string|null` the AI can populate (the prompt schema allows it, `prompt.ts:36`), but — confirmed in §12 — **this field is captured and never read anywhere downstream**; it doesn't gate any logic, doesn't affect classification, isn't shown in the review UI's document cards (`DdtImportFlow.tsx`'s `DocumentCard` shows document number, customer, supplier, tyre count, status — never `documentType`), and isn't persisted.

**The system assumes every uploaded document is a DDT/invoice/delivery-note that should become an order.** There is no "this looks like a credit note, do NOT create a positive order" safeguard — a credit note (which would logically represent a *return* or a *deduction*) extracted through either pipeline would be processed identically to a normal delivery document: its lines classified as tyres/fees, its quantities summed positively, and (if it passes the READY gate) an order created for what the system would treat as an incoming delivery. Confirmed by absence: no keyword search for "nota di credito"/"credit note"/"reso" anywhere in `ddt-classification.ts`, `ddt-payment.ts`, or either prompt.

---

## 21. Multi-document PDF logic

**Only Flow A supports this at all.** Flow B's entire type system and API contract assume exactly one order's worth of data per upload — there is no array of documents anywhere in `AnalysisResult`.

**Is page grouping AI-decided, based on document numbers, page headers, deterministic, or unsupported?**
**Entirely AI-decided**, with no deterministic verification. The prompt's opening paragraph (`prompt.ts:6`) instructs the model to determine document boundaries itself: "Your first job is to determine document boundaries: how many distinct logistics documents actually exist in this file, and which pages belong to each." The model returns a `documents[]` array directly; `coerceExtractionEnvelope()` just maps over whatever array length the model chose to return (`coerce.ts:133-137`) — there is no independent boundary-detection heuristic (no document-number-change detection, no page-header-pattern matching, no whitespace/layout-gap heuristic) anywhere in the application code that could catch or correct a wrong AI split. The `sourcePageStart`/`sourcePageEnd` fields the model is asked to report (§6/§12) are captured but never validated against the actual PDF's page count, never cross-checked for gaps or overlaps between documents, and never surfaced in the UI.

**Failure cases, as actually implemented**:
- **Under-splitting** (model reports 1 document when the PDF contains 3): the pipeline sees one `ExtractedDocument`, processes it normally; the other two DDTs' data is either silently absorbed into the one reported document's line list (if the model merged their content) or lost entirely (if the model only read the first document's pages) — no code path detects this happened.
- **Over-splitting** (model reports 3 when there's really 1 continuing document): three separate `ExtractedDocument` entries are processed independently; if they share the same `documentNumber`, the *second and third* would each be checked against `existingOrders` from the *same upload batch* — but `existingOrders`/`existingFingerprints` are fetched **once per supplier at the start of `analyzeDdtUpload()`** (`ddt-import.ts:190,209-213`, cached in `existingOrdersBySupplier`) and **not updated as documents within the same batch are processed** — so two same-DDT-number "documents" from an over-split single PDF would **both** independently compute `exactDuplicate: null` against the pre-upload database state (neither is in the DB yet) and **both** show as `READY`/confirmable, risking the admin importing the same physical document twice as two orders if they don't notice the duplicate document numbers. This is a genuine, verified gap in the within-batch duplicate protection (distinct from the well-covered *across-uploads* duplicate protection in §28).
- **No AI configured**: multi-document splitting degrades to "always exactly one document" — `textFallback()`'s comment (`text-fallback.ts:15-20`) states this outright: "without AI, there's no reliable way to detect where one logistics document ends and the next begins... a text-only pass is always treated as exactly ONE document, however many pages the upload has." This is disclosed to the admin via a note in the response, not silently assumed.

---

## 22. Multi-customer documents

**Not specifically handled as a distinct case.** If a single logistics document (one DDT, not a multi-DDT PDF) somehow lists multiple end customers — an edge case the prompt doesn't address at all — the schema has exactly one `customer` object per `ExtractedDocument`/`AnalysisResult`; the model would have to pick one (unclear which, no instruction), and any secondary customer's data would either be dropped or bleed into the wrong fields depending on how the model resolves the ambiguity. No code path creates multiple orders from one extracted document, no human-review flag exists specifically for "this document might have more than one customer," and no test covers this scenario. This is architecturally distinct from — and not solved by — Flow A's multi-*document* (multi-DDT) splitting, which operates at the whole-document level, not within a single document's customer field.

---

## 23. Customer extraction — exact field inventory

Both flows extract the same conceptual set, with different field names (see the tables in §12 for the authoritative per-flow list). Summarized:

- Company: `companyName` (both).
- Name/recipient: `deliveryRecipient` (both) — this is the *ship-to* contact/company name specifically, kept distinct from `companyName`.
- VAT: `vatNumber` (both).
- Fiscal code: `fiscalCode` (Flow A always; Flow B AI path only — the deterministic text-parser has no fiscal-code extraction, only VAT via a shared regex that also matches `codice fiscale`, see §26).
- Customer code (the supplier's own reference for this customer): `supplierCustomerCode` (both) — the single most valuable field for automated future-matching (§24).
- Street: `addressLine1`/`addressLine2` (both).
- Postal code: `postalCode` (both).
- City: `city` (both).
- Province: `province` (both).
- Country: `country` (both).
- Phone: `phone` (Flow A only — Flow A extracts it but, per §12, never actually forwards it into the create-order address payload, so it is captured and then dropped; Flow B has no customer-phone field at all in its schema).

**How the system distinguishes supplier vs. invoice-to vs. ship-to vs. final delivery recipient**: the schema itself only models **two** parties — `supplier` (the document issuer) and `customer` (explicitly documented, in both prompts, as "the final recipient of the goods," identified via Destinatario/Luogo di consegna/Spett.le/Ship to markers). **There is no separate "invoice-to" (billing) party modeled anywhere** — if a document's billing address differs from its delivery address (a common transport-invoice scenario the brief specifically flags as important), the system has no field to hold the billing address at all; only the ship-to/delivery address is captured, and it is that same address that becomes both the order's delivery snapshot *and* (via `matchCustomerFromDocument()`) the basis for which `customers`/`customer_locations` row gets matched or created — meaning a customer's *billing* identity (their legal entity, VAT, invoicing address) and their *delivery* identity (a specific branch/warehouse) are conflated into one `customer_location` match/create decision with no billing-specific handling anywhere in the pipeline.

---

## 24. Customer matching — the algorithm, exact order and thresholds

Implemented once, shared by both flows, in `src/lib/logistics/customer-matching.ts` (pure, dependency-free) + `src/lib/server/customers.ts::matchCustomerFromDocument()` (the DB-querying wrapper that narrows candidates before calling the pure matcher).

**Candidate narrowing (SQL, before the pure matcher runs)** — `matchCustomerFromDocument()`, `customers.ts:228-296`:
1. If `supplierId` + `extractedCustomer.supplierCustomerCode` are both present, look up `supplier_customer_refs` for a previously-learned `customer_id` for that exact code (case-insensitive `ilike`).
2. Build an `OR` filter: first significant word (≥3 chars) of the company name (`name ilike %word%`), and/or the VAT number with any 2-letter country prefix stripped (`vat_number ilike %digits%`), and/or the id from step 1 if found.
3. Query `customers` with that combined filter, capped at 50 rows; then query `customer_locations` for exactly those candidate customers' ids.

**The pure decision** — `matchCustomer()`, `customer-matching.ts:321-441`, exact order:

1. **Company scoring** (`rankCustomerCandidates()`): for every candidate, score = `1` if `identifiersMatch()` on VAT or fiscal code (digit-only comparison, country-prefix-agnostic — §26 detail), else `1` if the id matches the learned `supplierRefCustomerId`, else `tokenSimilarity(companyKey(extracted), companyKey(stored))` — a simple shared-token-count ratio (not Levenshtein, not any real string-distance metric) over `companyKey()`-normalized names (accents stripped, legal-form suffixes like `srl`/`spa`/`gmbh`/`ltd` etc. stripped from up to 3 trailing words). Candidates sorted by score descending.
2. **No candidate, or best score < `NAME_REVIEW_THRESHOLD` (0.5)** → `new_customer`, `requiresReview: true`.
3. Otherwise, locations for that best customer are scored (`rankLocationCandidates()`): `score = postalMatch(0 or 1) * 0.4 + streetTokenSimilarity * 0.4 + cityTokenSimilarity * 0.2` — postcode-exact-or-nothing, street and city both token-overlap ratios (via `streetKey()`, which additionally strips common street-type words like `via`/`viale`/`str`/`strada`/`piazza`/`corso` before comparing).
4. **Company confirmed** (`identifierConfirmed` — VAT/fiscal/supplier-code match — **or** `companyScore >= NAME_MATCH_THRESHOLD` (**0.99**, i.e. functionally an exact token-set match)):
   - Best location score `>= LOCATION_MATCH_THRESHOLD` (**0.75**) **and zero field differences** → `match_confirmed`, `requiresReview: false` (the only fully-silent outcome).
   - Best location score `>= 0.75` but *some* differences → `possible_match` (same physical place, differing detail — offers `use_existing`/`use_for_this_order_only`/`update_existing_location`/`add_as_new_location`).
   - No location scored high enough, but the extracted document actually has *no* address at all → falls back to the customer's primary location (or first) as `match_confirmed` if one exists, else `new_location` requiring review.
   - No location scored high enough and the document *does* have address data → `new_location`, `requiresReview: true`.
5. **Company only resembles** (score ≥0.5 but <0.99, no identifier match) → `possible_match`, always `requiresReview: true`, offering `use_for_this_order_only`/`add_as_new_location`/`update_existing_location` (deliberately **not** `use_existing`, since the company itself isn't confirmed).

**Exact thresholds, restated**: `NAME_MATCH_THRESHOLD = 0.99`, `NAME_REVIEW_THRESHOLD = 0.5`, `LOCATION_MATCH_THRESHOLD = 0.75`. All three are hardcoded constants, not configurable, not derived from any empirical calibration documented in the repo (no comment cites a false-positive/negative rate).

**Auto-match vs. human confirmation**: only `match_confirmed` (identifier or near-perfect name match + a location scoring ≥0.75 with zero differences) is treated as auto-confirmable by `canAutoConfirmDdtDocument()`; every other outcome (`possible_match`, `new_customer`, `new_location`) requires the admin to act, though `new_customer` *can* still auto-confirm if `buildCustomerResolution()` can build a valid "create new customer + new location" payload from what was extracted (§28) — "requires review" in this module's own vocabulary is a UI-highlighting signal, not always a hard block on auto-confirm.

---

## 25. Supplier matching

**Two independent supplier-lookup functions exist, used by different flows** — another instance of the duplication pattern:

- `findOrCreateSupplier()` (`src/lib/server/reference.ts:264-300`) — used by **Flow A only** (`ddt-import.ts`'s `analyzeDdtUpload()`). Order: exact VAT match (digit-only, country-prefix-stripped, `ilike`) → exact name match (`ilike`, case-insensitive but not fuzzy) → create new.
- `findOrCreateSupplier()` in the same file is **also** the one Flow B's `/api/admin/orders` route calls when `supplier_id` is absent (`app/api/admin/orders/route.ts:35-41`) — so this part is actually **shared**, not duplicated; the duplication is in the *extraction* layer feeding into it (§2), not the supplier-lookup itself.

**Can documents create suppliers automatically?** Yes, always, no confirmation step, no review gate — the file's own comment states this is a deliberate asymmetry versus customers: "Suppliers are operational reference data rather than customer master data, so auto-creating one from a document is safe — unlike customers, where a wrong guess corrupts delivery addresses" (`reference.ts:258-263`).

**Based on what**: `name` (required — a document with no readable supplier name blocks the whole document per §15 Rule 9, so a supplier is never created from an empty name) + optional `vat_number`.

**Risks**: a slightly-misspelled or OCR'd-wrong supplier name with no matching VAT creates a **duplicate supplier record** silently (the name match is exact `ilike`, not fuzzy/token-based like the customer matcher's `companyKey()`+`tokenSimilarity()` — so "Carlini Gomme Srl" vs "Carlini Gomme S.r.l." would **not** match by name and, absent a VAT number to match on, would create a second supplier row). No duplicate-protection UI exists for suppliers the way it does for customers (no `possible_match`/review flow) — a wrong auto-create is invisible until someone notices two supplier rows in the "Furnizori" admin screen.

---

## 26. Address matching

**Handled entirely within the customer-matching module** (`customer-matching.ts`, §24) — there is no separate address-matching system.

Edge cases, checked against actual code:
- **Customer has multiple branches**: handled — `rankLocationCandidates()` scores *all* of the matched customer's locations and picks the best; `locationCandidates[]` is returned in full (not just the winner) so a UI *could* offer a picker, though `OrderReviewForm.tsx`'s actual rendering only shows the single best match plus a resolution radio group, not a full list of alternative branches to choose from (a real UX gap for "same company, different branch" — the admin sees only the auto-picked best branch, with no way to instead pick a *different* known branch without falling back to "add as new location").
- **Billing address differs from destination**: **not modeled** — see §23, there is no billing-address field at all.
- **Same company/city, different branch**: covered by the scoring above (postal+street carry 80% combined weight specifically so city-only similarity, at 20%, isn't enough to falsely confirm a different branch in the same city) — but see the UX gap just noted.
- **Missing street number**: not specifically handled — `streetKey()` only strips common street-type *words* (via/viale/str/strada/piazza/corso/n/nr/no), not numbers; a missing house number would just mean a slightly-lower token-overlap score, degrading gracefully rather than failing outright.
- **Abbreviated Italian addresses** (`V.` for `Via`, `P.zza` for `Piazza`): **partially handled** — `streetKey()`'s stripped-word list includes bare `v` and `p` as tokens (`["via", "viale", "v", "str", "strada", "piazza", "p", "corso", "n", "nr", "no"]`, `customer-matching.ts:187`), so `"V. Roma 12"` and `"Via Roma 12"` would both reduce to `"roma 12"` after tokenization+stripping — but only for these specific abbreviation forms; something like `"V.le"` (viale) written with a stray period wouldn't cleanly split into a separate stripped token depending on the tokenizer's whitespace-only split (`.split(" ")`), so `"V.le Roma"` might survive as one token `"v.le"` that doesn't match `"viale"`.
- **c/o (care-of) addressing**: not specifically handled — no stripping/recognition of "c/o"/"presso" patterns; would just become part of the address-line token comparison, likely lowering match confidence rather than causing an error.
- **Industrial park / zona industriale addresses**: not specifically handled — same as above, degrades to lower token-overlap rather than a hard failure.
- **Delivery note has only a customer code, no address at all**: handled by the fallback branch (§24 step 4's "no extracted address" case) — falls back to the customer's primary/first known location if the company itself is confirmed, otherwise flags for review.

---

## 27. Payment extraction

**Two philosophically different extraction approaches, per flow — already detailed in §11's contradiction #1, restated here with full mechanism:**

- **Flow A**: the AI is instructed to copy raw payment-related text verbatim into `paymentText`, making zero classification decisions itself. `detectPaymentSignals()` (`ddt-payment.ts`) then applies exactly three regexes: `CASH_PATTERNS = [/\bCASH\s+AUTISTA\b/i, /\bCONTANTI\b/i]`, `CHEQUE_PATTERNS = [/\bCONTRASSEGNO\s+ASSEGNO\b/i]`, `BANK_RECEIPT_PATTERNS = [/\bRICEVUTA\s+BANCARIA\b/i]`. Output: `{ cashRequired: boolean, chequeRequired: boolean, paymentMethod: "cash"|"cheque"|"bank_receipt"|null }`. Explicitly literal — "Nu deduce payment dacă documentul nu îl spune" (file header comment) — no inference from amount, customer history, or context.
- **Flow B**: the AI is asked to directly output `cashOnDelivery: boolean` itself (no verbatim-text intermediate step, no separate deterministic classifier at all in this flow); the deterministic text-parser fallback (`text-invoice-parser.ts:316-330`) uses its own, broader `COD_LABELS` list — `["contrassegno", "contanti alla consegna", "cash on delivery", "c/assegno", "ramburs"]` — a superset that includes `contrassegno` bare (Flow A's cheque pattern requires the fuller `CONTRASSEGNO ASSEGNO` phrase specifically) and the Romanian `ramburs`, which Flow A's payment module doesn't recognize at all.

**Brief's example terms, checked**:
- `COD` (as a bare abbreviation) — not matched by either flow's patterns.
- `contrassegno` (bare) — matched by Flow B's text-parser `COD_LABELS`; **not** matched by Flow A's `CHEQUE_PATTERNS` (which requires `CONTRASSEGNO ASSEGNO` together) nor by Flow A's `CASH_PATTERNS`.
- `bonifico` (bank transfer) — **not recognized by any pattern in either flow** — a bank-transfer instruction is silently un-detected (falls through to `paymentMethod: null`, no `notes` warning specific to this either).
- `pagato` (paid) — not recognized anywhere.
- `cash` — matched only as part of `CASH AUTISTA` in Flow A, or as part of `cash on delivery` in Flow B's text parser; a bare "CASH" alone matches neither.
- `rimessa diretta` — not recognized by any pattern.
- `30 gg` (30-day terms) — not recognized as a payment-terms signal by either flow's payment detector, though Flow A's `BANK_RECEIPT_PATTERNS` would catch "RICEVUTA BANCARIA 30 GG" specifically because it matches on the "RICEVUTA BANCARIA" prefix regardless of what follows.

**Structured conversion vs. plain text storage**: the system does convert to a structured state (`cashRequired`/`chequeRequired`/`paymentMethod` enum, or `cashOnDelivery` boolean) rather than just storing free text — but per the term-coverage gaps just listed, a meaningful fraction of real-world Italian payment instructions (`bonifico`, `pagato`, bare `contrassegno` in Flow A, `30 gg` terms in general) are silently un-detected and default to "no special payment instruction," which is a **false negative that could mean a COD delivery gets treated as prepaid** — a real operational risk, not just a data-quality nicety.

---

## 28. Duplicate detection — full map

**Exact document number** (Flow A only): `normaliseDocumentNumber()` — `raw.trim().toUpperCase().replace(/\s+/g, "")`. Tested against the brief's exact examples:
- `INV-001` → `INV-001` (hyphen preserved — this normalizer does **not** strip punctuation, only whitespace and case).
- `INV001` → `INV001` — **stays a distinct string from `INV-001`** (the hyphen is not stripped), so these two would be treated as **different** document numbers despite plausibly being the same invoice referenced two different ways. This is a real, verified gap: the normalizer handles whitespace/case noise but not punctuation noise.
- `001/2026` → `001/2026` (slash preserved).
- `0001-2026` → `0001-2026` (leading zero preserved — `001/2026` and `0001-2026` would **not** be recognized as the same number even if they represent the same document, both because of the leading-zero difference and the `/` vs `-` separator difference).

**Supplier + document number**: `findExactDuplicate()` requires **both** to match (`ddt-dedup.ts:44-58`) — scoped per-supplier by design, so two different suppliers legitimately using the same numbering scheme never collide.

**Fingerprint**: exact formula — `computeOrderFingerprint()` (`ddt-dedup.ts:86-97`): SHA-256 of `companyKey(supplierName) | companyKey(customerName) | postalCode.trim().toUpperCase() | documentDate | itemSignature | totalTyres`, joined with `|`. `itemSignature` = `buildItemSignature()`: for each physical item, `BRAND|SIZE|QUANTITY` (brand/size uppercased-trimmed), **sorted alphabetically** (making it item-order-independent) and joined with `;`.

**Customer/items/date similarity**: this **is** the fingerprint mechanism — there is no separate "similarity score" beyond the exact-match SHA-256 (a fingerprint either matches exactly or it doesn't; there's no fuzzy/Levenshtein comparison of fingerprints, no partial-match tier between "exact fingerprint hit" and "no match at all").

**DB unique constraints**: `orders_supplier_doc_number_key` — a **partial unique index** on `(supplier_id, normalized_document_number) WHERE normalized_document_number IS NOT NULL` (`20260819000000_ddt_import_system.sql:62-64`). This is the real, unconditional backstop — the application-level `findExactDuplicate()` check is a pre-check for a *better error message*, not the actual guarantee; a race between two simultaneous imports of the same document is caught by this index (confirmed by the explicit `pgError?.code === "23505"` handling in `app/api/admin/ddt-import/confirm/route.ts:148-174`, which recovers gracefully by looking up and returning the winning order rather than surfacing a raw constraint-violation error).

**Application warnings**: `POSSIBLE_DUPLICATE` status (fingerprint match, no exact DDT-number match) — never blocks, always requires the explicit "Adaugă din nou" UI action (`DuplicateImportDialog.tsx`, invoked from both `UploadOrderPanel.tsx` and `DdtImportFlow.tsx`).

**Explicit duplicate override**: `canForceConfirmDdtDocument()` (`client-helpers.ts:102-108`) — allows re-confirming a `DUPLICATE`/`POSSIBLE_DUPLICATE` document as long as it isn't independently `blocked` and a customer resolution can still be built. The server-side confirm route **does not itself gate on `status` at all** — the UI's disabled-checkbox state is the only soft rail; the real, unconditional stop for a genuine duplicate is the DB unique index above (confirmed directly by the file comment in `client-helpers.ts:94-101`: "the server-side confirm route doesn't gate on document status at all").

---

## 29. Document fingerprint — false positive / negative analysis

Formula restated from §28: `SHA256(companyKey(supplier) | companyKey(customer) | postalCode | documentDate | itemSignature | totalTyres)`.

- **Ordering of lines**: does **not** matter — `buildItemSignature()` explicitly `.sort()`s the per-item strings before joining (`ddt-dedup.ts:71-76`), by design (confirmed by the dedicated test "`buildItemSignature` is independent of the order the items were listed in").
- **Product descriptions**: do **not** directly matter — only `brand` + a derived `sizeLabel` (from `formatSizeLabel()`, width/aspectRatio/rimDiameter) enter the signature, not the raw description text. Two lines with identical brand+size but very different free-text descriptions (e.g. different lot numbers, as in the "preserves both source descriptions" merge test in §15) produce the *same* signature contribution.
- **Quantities**: matter — `quantity` is part of each item's signature triple.
- **Customer**: matters (`companyKey`-normalized, legal-suffix-insensitive).
- **Dates**: matter — the raw `documentDate` string, not normalized beyond whatever the AI already returned as YYYY-MM-DD (no date-equality tolerance window; a document dated one day differently due to a misread digit would produce a completely different fingerprint, a **false negative** case).
- **Supplier**: matters (`companyKey`-normalized).

**Possible false positives** (two genuinely different documents fingerprinting identically): two different DDTs, same supplier, same customer, same postal code, same date, and coincidentally the same set of (brand, size, quantity) tuples — e.g. two separate same-day deliveries of "4× Michelin 225/55R18" to the same customer branch would fingerprint identically even though they are legitimately two different physical documents/orders. This is a real, structurally-inherent false-positive risk (a customer ordering the same common tyre twice in one day is not an unreasonable scenario for a busy branch), mitigated only by the fact that a fingerprint match is `POSSIBLE_DUPLICATE`, never an automatic block — a human is always the final arbiter.
**Possible false negatives**: any of the six inputs differing even slightly when it "shouldn't" matter for genuine-duplicate detection — a re-scanned copy of the exact same physical document where the OCR/AI reads the date one digit differently, or reads the customer's postal code with a transcription error, produces a completely different SHA-256 with **zero partial-match signal** (no fuzzy fingerprint comparison exists — §28). This is the scenario the *exact* document-number check (§28, Rule 7) is meant to catch instead, but only when the document number itself is legible — a document with both an unreadable document number **and** an inconsistently-read date/postcode across two scans would be caught by neither mechanism.

---

## 30. Review UI

**Two distinct review experiences, matching the two flows:**

**Flow A's review** — inline document cards in `UploadOrderPanel.tsx` (modal) or full-width cards in `DdtImportFlow.tsx` (standalone page): shows status pill, DDT number, customer name, supplier name, tyre count, an expandable detail panel (reasons list, address, per-line brand/size/quantity — `UploadOrderPanel.tsx:376-408`). **Editable fields in this view: none** — it is a **read-only summary with a checkbox**, not a form. The only way to *edit* an extracted value before saving is the separate "Editează și finalizează" escape hatch, which routes the document through `ddtDocumentToAnalysisResult()` into the **other** flow's fully-editable `OrderReviewForm.tsx` (§2). A document that's already confirmable (`READY`) can be confirmed with **zero opportunity to correct an extraction error** the admin happens to notice while skimming the card — the only per-document actions before commit are "confirm as-is" or "route to full manual edit," nothing in between (no inline field-correction).

**Flow B's review** (`OrderReviewForm.tsx`, shared final stop for both flows via the "Editează" path): every field is a live, editable input — supplier name/VAT/document number/date/reference; customer name/VAT/code with existing-vs-new radio toggle; delivery location with an explicit resolution radio group (never silently overwrites — §26); payment checkbox + amount + method; planned delivery date; and a fully editable product-line list (description, type dropdown, brand, width/aspect/rim number inputs, quantity, remove-line button, add-line button). Lines with any `reviewFields` entries are visually flagged (amber border) with the specific field names listed inline (`"De verificat: size, brand"`).

**What warnings appear**: `analysis.notes[]` shown as a bulleted list at the top (both the "unconfigured" disclosure and any per-extraction notes); the "Sursă:" (source) provider name shown in monospace for transparency; per-line `reviewFields` shown inline; customer-match status banner (color-coded by `match_confirmed`/`possible_match`/`new_customer`/`new_location`) with any address `differences[]` listed.

**Can the admin see the original document?** Not from either review screen directly during the initial confirm flow — no PDF/image preview/viewer component exists in `OrderReviewForm.tsx`, `UploadOrderPanel.tsx`, or `DdtImportFlow.tsx`. The original **is** viewable, but only *after* an order exists, via a signed URL (`getDocumentDownloadUrl()`, §4) presumably surfaced somewhere on the order detail page (`/admin/orders/[id]` — not read in this pass, but `app/api/admin/orders/[id]/document-url/route.ts` exists specifically for this). **During the actual extraction-review moment — when catching an AI mistake matters most — the admin cannot see the source document side-by-side with the extracted data.** This is a significant, verified UX gap for a system whose entire safety model depends on human review.

**Pages**: not shown/navigable in review (no per-page indicator, despite `sourcePageStart`/`sourcePageEnd` existing in the data — §12/§21, unused/dead in the UI).
**Extracted lines**: yes, shown in both review surfaces (as described above).
**Missing quantity**: yes, flagged (`reviewFields` includes `"quantity"`, and Flow A additionally surfaces `unreadableQuantityLines` counts in `doc.reasons`).
**Duplicate warning**: yes (status pill + reasons text + a direct link to the existing order when `duplicateOfOrderId` is set, `DdtImportFlow.tsx:338-345`).
**Customer match**: yes, prominently (color-coded banner, both flows converge on the same `CustomerMatchResult` display logic in `OrderReviewForm.tsx`).
**Low confidence**: shown per-line as a numeric badge is **not** actually rendered anywhere — checked directly: neither `UploadOrderPanel.tsx` nor `DdtImportFlow.tsx` nor `OrderReviewForm.tsx` displays the numeric `confidence` value itself to the admin; only the *derived* `reviewFields` list (which confidence indirectly influences via `normaliseProduct()`'s scoring, but the raw number is never shown). **Confirmed: confidence is computed and stored, never displayed.**
**Can the admin correct extraction before import?** Only via the full `OrderReviewForm.tsx` path — Flow A's primary review surface (the card list) offers no inline correction, only accept-or-route-to-manual-edit, as noted above.

---

## 31. Confidence — audited

**Who generates it**:
- Flow B AI path: the model itself, per-product-line (`ExtractedProductLine.confidence`), instructed to be "honest" (§11) — pure self-report, no calibration.
- Flow B deterministic path: **code-computed**, not AI — `normaliseProduct()`'s heuristic scoring (base 0.4, +0.3 for a matched size, +0.2 for a matched brand, +0.1 for load/speed, or +0.3 flat for a non-tyre item type it's confident enough to classify) — explicitly capped at ≤0.6 by the regex parser (`text-invoice-parser.ts:244`, `"Capped: a regex over an unknown layout is a starting point, not truth"`).
- Flow A: the model, but **only at the whole-document level** (`ExtractedDocument.confidence`), not per-line (§12) — a document-wide self-report copied onto every line only when converted for manual editing (§11 contradiction #3).
- `order_documents.extraction_confidence`: **code-computed**, but only for Flow B — `analyzeStoredDocument()` averages `line.confidence` across all products (`documents.ts:208-213`); Flow A's confirm path never writes this column at all (confirmed — `confirmDdtDocument()`/`advanceDdtOrderToStored()`'s update payload has no `extraction_confidence` field; Flow A instead writes `extraction_confidence` only via... actually checking again: it does **not** write it anywhere; this column is Flow-B-exclusive despite existing on the shared `orders`... wait, `extraction_confidence` is an `order_documents` column, and Flow A's item-level `extracted.confidence` is a *different*, order-table-adjacent field (`orders` has no `extraction_confidence`-named column of its own from the DDT migration — the DDT migration's `extraction_confidence numeric(4,3)` is added to `orders`, per `20260819000000_ddt_import_system.sql:56`, and *is* set by `advanceDdtOrderToStored()`'s update, confirmed via the earlier full read of `ddt-import.ts`: `extraction_confidence: extracted.confidence`).

**AI or deterministic**: both exist, split by flow/path as above.
**Document-level or field-level**: both exist, split as above — genuinely inconsistent granularity between the two flows (§11).
**Threshold — does it affect behaviour anywhere?** **No, nowhere.** Confirmed by exhaustive check: `confidence` never gates `READY`/`NEEDS_REVIEW` status in `pipeline.ts` (that logic uses only the blocking/review-issue lists in §15, never reads `extracted.confidence`), never triggers a provider fallback (§10), never disables auto-confirm in `canAutoConfirmDdtDocument()`. The number is purely decorative/diagnostic at every point in the codebase it's computed.
**Is it displayed?** Only indirectly — see §30: the raw number itself is never rendered in any UI component; only `reviewFields` (a *symptom* of low per-field confidence in the deterministic path, not the confidence-score-driven display the brief is asking about) is shown.
**Is it trusted?** Stored, computed, propagated through several layers of the codebase — but never read back by any decision-making code. It exists as data exhaust, not a control signal.

**Direct answer to the brief's specific question**: no, `confidence: 0.98` from the LLM has **no actual statistical meaning or operational effect** anywhere in this system — it is captured, sometimes averaged, sometimes persisted to a database column, and never once consulted to make a decision or shown to a human in a way that could influence theirs.

---

## 32. Warnings — every state and its exact trigger condition

| Warning / error state | Exact condition | Where surfaced |
|---|---|---|
| `NOT_IMPLEMENTED`-equivalent: unreadable quantity | physical line, `quantity === null` | `reviewFields`/`unreadableQuantityLines`, forces `NEEDS_REVIEW` unless it's the only line (then also `blocked`) |
| Possible duplicate | fingerprint match, no exact DDT-number match | `status: POSSIBLE_DUPLICATE`, reason string with the matched order id |
| Exact duplicate | supplier + normalized document number match | `status: DUPLICATE`, reason string |
| Unknown/unidentified customer | `extracted.customer.companyName` falsy | `blockingIssues` → `NEEDS_REVIEW` + `blocked: true` |
| Missing document number | `extracted.document.documentNumber` falsy | `reviewIssues` → `NEEDS_REVIEW`, never `blocked` alone |
| Missing supplier | `extracted.supplier.name` falsy | `blockingIssues` → `NEEDS_REVIEW` + `blocked: true` |
| Multiple documents detected | N/A as a warning — not a warning state at all, just the normal `documents[]` array length; no specific "heads up, this file had several documents" banner beyond the summary stat counts |
| Unsupported file type | MIME/extension not in the accepted list | `415 UNSUPPORTED_FILE_TYPE` HTTP response, both `/api/admin/documents` and `/api/admin/ddt-import/analyze` |
| AI failure (HTTP/timeout/parse error) | any provider's own failure condition (§9/§10) | `status: "failed"`, `error` string; surfaced generically as "Analiza a eșuat ({code})" in the upload UI |
| No API key configured | neither `ANTHROPIC_API_KEY` nor (Flow A) `OPENAI_API_KEY` set, and no usable text layer | `status: "unconfigured"`, explicit disclosure text: "Analiza automată nu este configurată... sistemul nu inventează valori" |
| Malformed model response | JSON parse failure inside a provider | caught, converted to `status: "failed"` with the parse error as `error` |
| Tyre-count/colli mismatch | `validateTyreCount()` returns `TYRE_COUNT_REVIEW_REQUIRED` | reason string, `NEEDS_REVIEW`, never `blocked` |
| Nothing importable | zero physical lines with a readable quantity | `blockingIssues` → `NEEDS_REVIEW` + `blocked: true` |
| Missing optional customer detail | phone or postal code absent, nothing else wrong | `READY_MISSING_OPTIONAL` (still auto-confirmable) |

All conditions above were traced directly to the specific `if`/pattern-match producing them — none are approximated.

---

## 33. Order creation — exact field mapping

### Flow A confirm path (`confirmDdtDocument()`, `src/lib/server/ddt-import.ts`)

| Extracted field | DB destination | Transformation |
|---|---|---|
| `physicalItems[].raw.*` (per line) | `order_items` (via `gorush_create_order`'s items array) | `item_type` from `LINE_TYPE_TO_ITEM_TYPE` map (`TYRE→tyre`, `TUBE→tube`, `RIM→wheel`, `OTHER_PHYSICAL_ITEM→other`); a line whose classified type has no map entry is silently `.filter((item) => item !== null)`-dropped (a genuinely unclassifiable-but-somehow-physical line vanishes, no warning) |
| `.quantity` | `order_items.quantity` | direct; lines with `null` are pre-filtered out entirely (never reach the payload) |
| `.supplierArticleCode` | `order_items.supplier_sku` | direct |
| `.manufacturerCode`, `.ean`, `.commercial`, `.mudSnow`, `.threePmsf` | **nowhere** | dropped — see §12, dead fields |
| `.rawDescription` | `order_items.raw_description` AND `.description` | same value used for both |
| `.brand`/`.model` | `order_items.brand`/`.model` | direct |
| `.width`/`.aspectRatio`/`.rimDiameter` | `order_items.width`/`.aspect_ratio`/`.rim_diameter` | direct |
| `.loadIndex`/`.speedRating` | `order_items.load_index`/`.speed_rating` | direct |
| `.extraLoad`/`.runFlat` | `order_items.extra_load`/`.run_flat` | direct |
| `.unitPrice` | `order_items.unit_price` | direct |
| `.vatPercent` | `order_items.tax_rate` (payload key) → `order_items.vat_percent` (column) | renamed |
| `.lineTotal` | **nowhere** | dropped (§19) |
| `charges[]` (PFU/fee/discount/VAT lines) | `document_charges` | `charge_type` = the classified type if it's a recognized `CHARGE_TYPES` value, else `"OTHER_FEE"`; `description`/`raw_description` both from `raw.rawDescription`; `quantity`/`unit_amount`/`total_amount` from `raw.quantity`/`.unitPrice`/`.lineTotal`; `line_number` = array index + 1 |
| `extracted.supplier.name`/`.vatNumber` | `suppliers` (via `findOrCreateSupplier()`, upstream of this function) | see §25 |
| `extracted.document.documentNumber` | `orders.supplier_document_number` | direct |
| `.documentDate` | `orders.supplier_document_date` (payload key, `document_date` column upstream — actually `orders.document_date`? — **VERIFIED IN CODE**: the RPC payload key is `supplier_document_date`, and `gorush_create_order`'s SQL casts it into the `document_date` column) | direct |
| `.supplierOrderReference` | `orders.supplier_order_reference` | direct |
| `.trackingNumber`/`.giro`/`.agent`/`.carrier` | `orders.tracking_number`/`.giro`/`.agent`/`.carrier` | direct, but written by `advanceDdtOrderToStored()` **after** order creation, not part of the atomic RPC (§34) |
| `.documentType`, `.sourcePageStart/End`, `.colli` | **nowhere persisted** | `colli` used only transiently for `validateTyreCount()`; `documentType`/page markers fully dead (§12) |
| `extracted.customer.*` | `customers`/`customer_locations` (via `resolveCustomerForOrder()`) + `orders.delivery_*` snapshot | per the admin's resolution choice (§24); `.phone` specifically dropped (§12/§23) |
| `payment.cashRequired`/`.chequeRequired` | `orders.cash_required`/`.cheque_required` | direct |
| `payment.paymentMethod` | `orders.payment_method` | direct |
| `.cashRequired \|\| .chequeRequired` | `orders.requires_payment_on_delivery` (payload key `requires_payment_on_delivery`, DB semantics via `cash_on_delivery` column per `gorush_create_order`'s SQL) | derived boolean-OR |
| `normalizedDocumentNumber` | `orders.normalized_document_number` | via `advanceDdtOrderToStored()`, post-creation |
| `tyreCount` | `orders.tyre_count` | via `advanceDdtOrderToStored()` |
| `physicalItemCount` | `orders.physical_item_count` | via `advanceDdtOrderToStored()` |
| `fingerprint` | `orders.fingerprint` | via `advanceDdtOrderToStored()` |
| computed `transportRevenue` (§15 Rule 5) | `orders.transport_revenue`, `orders.transport_rate_snapshot` | via `advanceDdtOrderToStored()` |
| `extracted.confidence` | `orders.extraction_confidence` | via `advanceDdtOrderToStored()` |

### Flow B / manual path (`/api/admin/orders` → `createOrder()`)

Simpler and shallower — maps directly from `OrderReviewForm.tsx`'s submitted payload through `createOrderSchema` into `gorush_create_order`, with **no** `document_charges` writes, **no** `fingerprint`/`tyre_count`/`transport_revenue`/`normalized_document_number` writes at all (those columns simply stay `NULL` for every order created through this path — confirmed: neither `app/api/admin/orders/route.ts` nor `createOrder()` in `orders.ts` reference any of these four columns). An order created via Flow B is, from a data-completeness standpoint, a **second-class citizen** relative to one created via Flow A's confirm path — it has no duplicate-fingerprint protection for *future* incoming documents to match against (a later DDT import can never detect a Flow-B-created order as a possible duplicate, since its `fingerprint` column is null and its `normalized_document_number` is also null unless the admin happened to type the document number in a way that later normalizes identically — the exact-match check *can* still work via `supplier_document_number` fallback normalization per §28's `OrderIdentity.supplierDocumentNumber` fallback, but the fingerprint layer cannot).

---

## 34. Atomicity

**Single transaction/RPC** (`gorush_create_order`, confirmed via this session's own migration work applying/reading its current body): order row + all `order_items` rows + all `inventory_units` rows + the `order_status_history` "order_created" row + (if `source_document_id` present) the `order_documents.order_id` link-back — **all inside one Postgres function**, so "order exists but its items don't" is not possible.

**What happens OUTSIDE that transaction, i.e. can leave a real gap**:
1. **`document_charges` insert** (Flow A only) — happens via a separate `supabase.from("document_charges").insert(...)` call *after* `createOrder()` returns (`ddt-import.ts`'s `confirmDdtDocument()`). If this insert fails, the function only `logError()`s and continues (`if (chargesError) logError(...)` — no throw, no rollback, no retry) — **confirmed gap: "order exists but its PFU/fee charge lines don't."** The order itself is fully valid and will show in every list; only the audit-trail charge rows are silently missing.
2. **`advanceDdtOrderToStored()`** (Flow A only) — a *separate* set of `orders` and `inventory_units` UPDATE statements (status → `stored`, plus every DDT-specific metadata column from §33's second table: `normalized_document_number`, `tracking_number`, `giro`, `agent`, `carrier`, `cash_required`, `cheque_required`, `tyre_count`, `physical_item_count`, `transport_rate_snapshot`, `transport_revenue`, `fingerprint`, `extraction_confidence`), each its own non-transactional Supabase call, executed **after** `createOrder()` and **after** the `document_charges` insert. Confirmed non-atomic: the function catches `isMissingSchemaError` for the main update and degrades to a status-only fallback update (`ddt-import.ts`, `advanceDdtOrderToStored()`'s error handling), and the separate `inventory_units` status update and `order_status_history` insert are each their own unguarded calls whose individual failures are only logged, never rolled back or retried. **Confirmed gap: "order exists, is created correctly with all its items/units, but is stuck at status `expected` forever, or has some DDT metadata columns populated and others not,"** if any of these several sequential calls fails partway through. The function is explicitly designed to be **safely re-callable** (idempotent, checks current status before acting) specifically because of this risk (§35) — but nothing *automatically* re-calls it; a stuck order would need a retried confirm request (which the confirm route's `findExistingOrder()`/recovery path does handle, §35) or manual intervention.
3. **Supplier/customer resolution** (`findOrCreateSupplier()`, `resolveCustomerForOrder()`) — both happen **before** `createOrder()` is called, each their own independent inserts. If the customer/location gets created but the subsequent `createOrder()` call then fails for an unrelated reason (e.g. a downstream `SUPPLIER_REQUIRED` exception, or a transient DB error), the result is a **new customer or location row with no order ever created from it** — orphaned but harmless master-data (not itself a data-integrity risk, just a minor cleanliness one; nothing ever garbage-collects an orphaned customer/location).

**"Document says imported but order creation failed"**: cannot silently happen for the *document*'s own status column — `order_documents.extraction_status` is separate from order creation entirely (it only ever reaches `"review_required"`/`"unconfigured"`/`"failed"` from the *analysis* step, per `documents.ts:190-195`; Flow A's `order_documents` row is linked to the created order via `source_document_id`/`order_id` inside the same atomic `gorush_create_order` call, so a failed `createOrder()` simply throws before any document-side state changes — confirmed by `confirmDdtDocument()`'s straight-line code with no try/catch around the `createOrder()` call itself, letting a failure propagate up to the route handler's own catch block, §36).

---

## 35. Idempotency

**Double confirm-click / browser retry / API timeout-after-commit** (the exact scenario the brief asks about): handled deliberately and explicitly, via `findExistingOrder()` in `app/api/admin/ddt-import/confirm/route.ts:46-79`, called **before** attempting `confirmDdtDocument()` for any non-`DUPLICATE`/`POSSIBLE_DUPLICATE` document. If a matching order already exists (by supplier + normalized document number, with the raw-number fallback for pre-migration rows), the route returns that existing order via `recoverExistingOrder()` — which also **re-runs `advanceDdtOrderToStored()`** (itself idempotent, checks current status first) to finish any interrupted status-advance from a prior partial attempt (§34's gap #2). This is a genuinely well-designed recovery path, explicitly commented as existing for exactly this purpose (`confirm/route.ts:81-89`).

**Race condition** (two simultaneous confirms of the same document, both passing the pre-check before either has committed): caught by the DB's own unique index raising Postgres error `23505`, which the route's `catch` block specifically detects and recovers from the same way (`confirm/route.ts:144-174`) — looks up the now-existing order and returns it as a success rather than surfacing a raw constraint error.

**Same storage document analyzed twice** (re-running `/api/admin/ddt-import/analyze` or `/api/admin/documents` on the same already-uploaded file): **not specifically deduplicated** — each call creates a **new** `order_documents` row (`recordUploadedDocument()`/`storeOrderDocument()` always inserts) and pays for a fresh AI extraction call — no caching keyed on `storagePath`/content-hash exists. `orders.source_hash` column exists (added by the DDT migration, indexed) but is **never actually computed or written anywhere** in the read codebase — a genuinely dead column intended for exactly this deduplication purpose but not wired up (checked: no `source_hash` assignment found in `ddt-import.ts`, `documents.ts`, or either confirm/analyze route).

**Same invoice imported twice** (as two *separate* uploads, not a double-click of the same session): fully covered by the exact-duplicate-number and fingerprint mechanisms (§28) — this is the intended, well-tested case.

**Flow B's manual-entry route** (`/api/admin/orders`): **no idempotency protection of any kind** — no pre-check, no recovery-on-23505 handling (confirmed: `app/api/admin/orders/route.ts` has no try/catch around `createOrder()` beyond what `runAdminRoute()` provides generically, and no `findExistingOrder()`-equivalent). A double-click of "Salvează" on the manual/Flow-B review form, or a browser retry after a slow response, would attempt to call `gorush_create_order` **twice** with the same data — since this path writes no `normalized_document_number`/`fingerprint` (§33), the DB's own unique index can't even catch it if the two attempts happened to include the same document number (the index requires `normalized_document_number IS NOT NULL`, and Flow B never populates that column) — **this is a real, verified idempotency gap**: a genuine double-order risk exists for the manual/single-document creation path that does not exist for the DDT multi-import confirm path.

---

## 36. Error handling — step by step

| Step | Failure | Handling | User sees | Retry? |
|---|---|---|---|---|
| Upload (slot request) | `createSignedUploadUrl` fails | thrown, caught by `runAdminRoute()`'s generic error wrapper | generic `SAVE_FAILED`-style error via `DocumentUploadError` | Manual only (re-select file) |
| Upload (Storage PUT) | network/permission error | `DocumentUploadError("STORAGE_UPLOAD_FAILED")` thrown client-side | "Eroare de rețea. Încearcă din nou." | Manual only |
| Storage download (server) | `downloadDocumentBytes()` errors | thrown, propagates to route's outer error path | generic 500 | No |
| PDF text-layer parser | malformed PDF structure | caught internally (`try { extractContentStreams } catch { return empty }`), never throws out | silently degrades to AI path or "unconfigured" | N/A (no error surfaced) |
| Anthropic call (either flow) | HTTP non-200 | caught, `status:"failed"` with truncated body as `error` | "Analiza a eșuat ({code})" or, in Flow B, `errorMessage("ANALYSIS_FAILED")` | Falls back to next provider (Flow A) or text/manual (Flow B) — not a user-initiated retry |
| Anthropic/OpenAI call | timeout (`AbortController`) | caught, `error.name === "AbortError"` distinguished, specific Romanian message ("Analiza a durat prea mult") | shown in review-screen banner | Same as above |
| Anthropic/OpenAI call | malformed JSON response | `parseModelJson()` throws, caught by the provider's own try/catch, `status:"failed"` | generic failure message | Same as above |
| No tyre lines / zero documents | OpenAI only, explicit check | `status:"failed"`, `OPENAI_NO_DOCUMENTS` | falls through to text fallback | Automatic (within the fallback chain) |
| DB error — order creation | any Postgres error from `gorush_create_order` | thrown up through `createOrder()` → route's `catch` | Flow A: mapped by error-message substring matching (`23505`→`ALREADY_IMPORTED`, `NOTHING_IMPORTABLE`→specific message, else generic `SAVE_FAILED` with `describeError(error)`); Flow B: **no equivalent substring-matching catch at all** — `app/api/admin/orders/route.ts` has no try/catch of its own, so any RPC error propagates to whatever `runAdminRoute()`'s top-level handler does generically (not read in this pass, but Flow A's much more specific handling is conspicuously absent here) | Flow A: no automatic retry beyond the idempotency recovery (§35); Flow B: none |
| Duplicate — DB constraint | `23505` on `orders_supplier_doc_number_key` | Flow A: recovered gracefully (§35); Flow B: **not specifically handled** — Flow B never populates `normalized_document_number` so this specific constraint can't even fire for it, but *other* constraints (if any) would surface as an undifferentiated error |
| Customer creation | `createCustomer()`/`createCustomerLocation()` DB error | thrown, propagates to the confirm/order route's catch — for Flow A, **not specifically distinguished** from any other `SAVE_FAILED` cause; for Flow B, same generic behaviour |
| Order RPC — missing supplier | `payload.supplier_id` null inside `gorush_create_order` | SQL `raise exception 'SUPPLIER_REQUIRED'` — propagates as a raw Postgres exception message, not a structured `{ok:false,code:...}` JSON the way the RPC's *other* business-rule checks (e.g. `NO_VEHICLE`, `NOT_READY` in the dispatch RPCs) return — **this specific case is a raw SQL error surfacing to the API layer**, caught only by the generic `describeError(error)` fallback in Flow A's route, or entirely uncaught-specifically in Flow B's |
| Metadata update (post-creation) | `advanceDdtOrderToStored()` internal failures | logged only, never thrown, never surfaced to the confirm response at all — the admin sees "success" (an order was created) with no indication that, say, the tyre_count snapshot failed to write | No |
| Charge insert | `document_charges` insert error | logged only, never surfaced | No |

**"No raw SQL errors" — how well is this actually honored?** Mostly, but with the one confirmed gap above (`SUPPLIER_REQUIRED` as a raw `raise exception` rather than a structured result) — every other business-rule rejection observed in this pass (`NOTHING_IMPORTABLE`, the various dispatch-RPC codes referenced elsewhere in this codebase) does return a structured `{ok:false, code:...}` JSON object rather than an exception. **"No silent success" — how well honored?** Not fully: §34/§36 both confirm that a `document_charges` insert failure or an `advanceDdtOrderToStored()` failure is logged server-side but reported to the admin as an unqualified success (the confirm response's `ok:true` doesn't reflect these secondary write outcomes at all).

---

## 37. Timeouts — every value, and the worst case

| Component | Timeout |
|---|---|
| Flow B Anthropic call | 90,000 ms |
| Flow A Anthropic call | 170,000 ms |
| Flow A OpenAI call | 60,000 ms |
| `/api/admin/ddt-import/analyze` route `maxDuration` | 170 (seconds) |
| `/api/admin/documents` route `maxDuration` | 120 (seconds) |
| `/api/admin/ddt-import/confirm` route | **not set** — no `maxDuration` export in `confirm/route.ts`, inherits the Vercel project/plan default. **UNKNOWN** exact value from code alone (Vercel's own default varies by plan and hasn't historically been a single universal number — not verifiable from the repository) |
| Storage upload (browser→Supabase) | no application-level timeout set (relies on the browser/Supabase-JS client's own defaults — **UNKNOWN** exact value) |

**Worst-case total processing time, Flow A, calculated from actual code**: Anthropic tried first (up to 170s) → on failure, OpenAI tried (up to another 60s) → on failure, text fallback (fast, no network call). **Worst case ≈ 230 seconds of provider wait time alone**, *before* any of the deterministic pipeline processing (`processExtractedDocument()`, customer matching) runs. This **exceeds the route's own configured `maxDuration = 170`** (`analyze/route.ts:10`) by roughly 60 seconds in the worst case (Anthropic times out at 170s, consuming the entire route budget, and OpenAI would never even get its allotted 60s because Vercel would have already killed the function). This is a **verified, concrete bug**: the route's `maxDuration` is sized for the *first* provider's timeout alone, not the sum of the full fallback chain — meaning the fallback to OpenAI is effectively unreachable in production whenever Anthropic hangs for its full timeout rather than failing fast.

**Flow B worst case**: text extraction is synchronous/fast (no network), so the only network wait is the single 90s Anthropic call, comfortably inside the route's 120s `maxDuration`.

---

## 38. Retries

**Automatic retry of the *same* provider after a failure**: **NOT IMPLEMENTED**, anywhere, for either flow or either provider. One attempt, then either fallback (Flow A, different provider) or terminal failure (Flow B, single provider).

**Retry same provider**: never.
**Fallback only**: yes, this is the entire mechanism (§10).
**Exponential backoff**: **NOT IMPLEMENTED** — there is no retry loop of any kind to back off within.
**Rate-limit-specific retry** (e.g. detecting a 429 and waiting): **NOT IMPLEMENTED** — a 429 from either provider is treated identically to any other non-200 HTTP status (immediate `status:"failed"`, no `Retry-After` header inspection anywhere in either provider file).
**UI-initiated retry**: yes — re-uploading the same file re-runs the whole pipeline from scratch (not a targeted "retry just the AI call" — the user re-selects the file and the entire upload→analyze sequence repeats). For the confirm step specifically, re-clicking "Confirmă" after a failure is a full API call retry, benefiting from the idempotency protections in §35.
**Idempotency as a substitute for retry-safety**: yes, this is the design's actual answer to "what if a call needs to be retried" — rather than the *provider* call being retried automatically, the *whole user-facing operation* (confirm) is made safe to repeat manually, per §35.

---

## 39. Token usage

**Full file or selected content?** Always the **entire file**, every time, in both flows — no page selection, no content trimming, no region-of-interest cropping. A 40-page PDF is sent in full even if only page 1 contains the DDT.

**Base64 inflation**: yes, unavoidable and unmitigated — `bytes.toString("base64")` inflates payload size by ~33% over the raw bytes for every PDF/image sent, in all three provider call sites.

**Image count**: exactly one file per API call in every path (no multi-image batching, and equally no image *splitting* of a large PDF into per-page images that could be sent selectively).

**PDF page count**: uncapped (§6) — the single largest uncontrolled token-cost driver in the system, since a vision model's cost for a PDF scales roughly with page count and nothing anywhere limits it.

**Prompt size**: Flow A's shared system prompt is ~4,600 characters (≈1,150 tokens, **INFERRED** from character count at ~4 chars/token, not measured); Flow B's is ~2,900 characters (≈725 tokens, same inference basis). Sent in full on **every single call**, never cached, never trimmed.

**Output max tokens**: 8,000 (Flow B Anthropic), 16,000 (Flow A Anthropic), 16,000 (Flow A OpenAI).

**Repeated system prompt**: yes — no prompt caching of any kind is configured. Anthropic's prompt-caching (`cache_control` breakpoints) is **not used** anywhere despite the system prompt being a large, entirely static block sent identically on every request — this is a directly-actionable, unexploited cost saving (**VERIFIED IN CODE**: no `cache_control` key appears in any request body in either Anthropic call site).

**Duplicated extraction calls**: yes, in two distinct ways:
1. Re-analyzing the same uploaded document (§35) pays full price again — no content-hash cache, and `orders.source_hash` (the column apparently intended for exactly this) is never populated.
2. Flow A's text-fallback path can invoke Flow B's **entire** `analyzeDocument()` pipeline, which — if an `ANTHROPIC_API_KEY` exists but Flow A's own Anthropic *and* OpenAI attempts both already failed — will make **yet another Anthropic call** (Flow B's own analyzer, a third paid call for the same document) before giving up. **VERIFIED IN CODE**: `text-fallback.ts:108` calls `analyzeDocument(input)`, which at `index.ts:78-79` calls `analyzer.analyze(document)` whenever a configured analyzer exists — nothing in this path knows that two Anthropic calls have already been attempted and failed for this same file.

**Fallback chain potentially double-paying**: confirmed, per the above — worst case for one uploaded document is **three separate paid AI calls** (Flow A Anthropic → Flow A OpenAI → Flow B Anthropic via the text fallback), all for the same file, all charged, before returning a result.

**TOKEN USAGE NOT OBSERVABLE** — no `usage` field is read from any provider response (Anthropic returns `usage.input_tokens`/`output_tokens` in every response body; the code destructures only `payload.content`, discarding it entirely — `anthropic-analyzer.ts:286-288`, `anthropic-provider.ts:74`). Nothing is logged, stored, or aggregated.

---

## 40. Cost

Checked directly for each item the brief lists:

- **Prompt tokens recorded**: no.
- **Completion tokens recorded**: no.
- **Image usage recorded**: no.
- **API latency recorded**: no — no timing instrumentation wraps any provider call (no `Date.now()` deltas, no performance marks).
- **Provider recorded**: **yes, partially** — `logEvent("ddt_extraction_completed", { provider, documentCount })` and `logEvent("document_analysed", { provider, productCount })` record *which* provider answered, but nothing quantitative about the call.
- **Model recorded**: **partially** — Flow A's OpenAI path logs `model`; neither Anthropic path logs the model string at all (so if `ANTHROPIC_MODEL` is overridden via env var, logs won't show which model actually ran).
- **Estimated cost**: no — no pricing table, no cost calculation, no per-document cost attribution anywhere in the codebase.

Per the brief's instruction, no cost estimates are produced here, since the code contains no pricing data to base them on.

---

## 41. Performance — what could make this slow

Ranked by likely real-world impact, each traced to the specific code path:

1. **Uncapped PDF page count sent to a vision model** (§6/§39) — the dominant latency factor; a large scanned multi-page DDT batch is a single very long model call with no way to parallelize or bound it.
2. **Sequential provider fallback with mis-sized route budget** (§37) — worst case 230s of provider wait against a 170s route ceiling, meaning slow-failure scenarios burn the entire request budget and still return nothing useful.
3. **Triple-paid extraction in the worst-case fallback chain** (§39) — three sequential model calls for one document.
4. **Re-analysis is never cached** (§35) — the same file re-uploaded (a very common user behaviour after a confusing result) pays full latency and cost again; `source_hash` exists as a column but is never computed.
5. **All-page vision analysis with no preprocessing** (§7) — no downscaling of oversized phone photos before base64-encoding; a 12-megapixel JPEG is sent at full resolution.
6. **Base64 encoding of the whole file in memory** (§39) — for a 25 MB PDF this is a ~33 MB string built in a serverless function's memory, plus the original Buffer, on every analyze call.
7. **Storage download per analyze call** (`downloadDocumentBytes()`) — the file is re-downloaded from Storage server-side even though the browser just uploaded it; unavoidable given the direct-to-storage design, but it is a real added round-trip (and would be paid *again* on a re-analysis).
8. **Sequential per-document confirm calls** — `UploadOrderPanel.confirmSelected()` (`UploadOrderPanel.tsx:151-180`) and `DdtImportFlow.confirmAllSafe()` (`DdtImportFlow.tsx:158-166`) both `await` each document's confirm request **one at a time in a `for` loop**, never in parallel. Importing 10 documents from one PDF means 10 sequential round-trips, each involving several non-atomic DB writes (§34).
9. **`getRecentFingerprints(limit = 2000)`** (`ddt-import.ts:108-126`) — fetches up to 2,000 order fingerprints into memory on **every** analyze call, then does a linear `.find()` per document against that array (`pipeline.ts:217`). Fine at current volume, but it's an O(documents × 2000) in-memory scan plus a 2,000-row fetch per upload that will degrade as order volume grows (and silently stops being *correct* past 2,000 orders — a genuine duplicate older than the 2,000 most recent orders becomes undetectable by the fingerprint layer).
10. **`getExistingOrderIdentities()` per supplier** — fetches **every** order for a supplier (no limit at all on this query, `ddt-import.ts:77-81`) to do the exact-duplicate check in memory; for a high-volume supplier this is an unbounded and growing result set fetched on every upload.
11. **Synchronous DB operations in `advanceDdtOrderToStored()`** — several sequential awaited updates per confirmed document (§34), none batched.

---

## 42. Security / privacy

**What supplier/customer information reaches the AI providers**: **the complete, unredacted document** — the entire PDF/image is base64-encoded and transmitted in full. That necessarily includes, for a typical Italian DDT: full customer company name, complete delivery address, VAT/fiscal codes for both parties, per-line pricing, any bank/payment details printed on the document, and any phone/email present on the page. **No redaction, masking, or field-stripping of any kind occurs before transmission** — confirmed by absence: nothing between `downloadDocumentBytes()` and the `bytes.toString("base64")` call in any provider modifies the bytes.

- Full invoice: yes.
- Customer names: yes.
- Addresses: yes.
- VAT numbers: yes.
- Prices: yes.
- Bank details: yes, if printed on the document.
- Email/phone: yes, if printed on the document.

**Logging of raw model responses**: **no** — checked each provider's `logError`/`logEvent` calls; failures log an HTTP status and a *truncated* response body (200 chars for the Anthropic paths, 800 for OpenAI) which for an error response is typically a provider error message rather than extracted customer data, but on a malformed-JSON failure that truncated slice **could** contain the beginning of a real extraction (customer name, address) written to server logs. Successful responses are never logged in full. `raw_extracted_data` (the full structured extraction) **is** persisted to the `order_documents` table (Flow B only, `documents.ts:203`) — that's a database write, not a log, and stays inside the same trust boundary as the orders themselves.

**Document retention**: originals are **never deleted** — `storeOrderDocument()`/`recordUploadedDocument()` only ever insert; no deletion/expiry/lifecycle policy exists in code, and the file comment explicitly frames permanent retention as intentional ("The source document is NEVER discarded after extraction — it is the evidence behind every field"). **No retention limit, no purge job, no GDPR-style erasure path.**

**Storage permissions**: bucket is private; every read requires a server-issued signed URL with a 300-second default expiry (§4). The browser's direct upload uses a one-time signed token, not a durable credential. RLS is enabled with no policies on the logistics tables, so the anon key cannot read `order_documents`/`orders` directly.

**Provider data-handling posture**: not configured/asserted anywhere in code — no zero-retention header, no enterprise/ZDR endpoint selection, no `anthropic-beta` privacy flags; requests go to the standard public API endpoints with a plain API key. Whether the providers retain this data is governed entirely by the account's own terms, which the application neither sets nor documents. **UNKNOWN** from the repository.

---

## 43. Observability

Can the system currently answer:

| Question | Answerable? | Why |
|---|---|---|
| How many documents succeeded? | **Partially** — `order_documents.extraction_status` is persisted per document (Flow B writes `review_required`/`unconfigured`/`failed`; **Flow A never updates this column at all** after the initial `pending` insert, so every Flow-A document sits at `extraction_status: "pending"` forever regardless of outcome — a real gap making this metric wrong for the primary flow) |
| How many failed? | Same partial/wrong answer as above |
| Which provider handled each? | **Flow B only** — `order_documents.analysis_provider` is written by `analyzeStoredDocument()`; Flow A never writes it. Also emitted as a `logEvent` for both flows, but logs aren't queryable as structured data here |
| Average latency? | **No** — not measured anywhere (§40) |
| Average tokens? | **No** — TOKEN USAGE NOT OBSERVABLE (§39) |
| Cost per invoice? | **No** (§40) |
| Fields most frequently corrected? | **No** — the review form submits a final payload with no diff against the extracted original; nothing records which fields the admin changed. `order_items.needs_review`/`review_fields` capture what the *system* flagged, never what the *human* actually corrected |
| Most problematic supplier? | **No** — no per-supplier extraction-quality aggregation exists; would require the above metrics to be captured first |

**What telemetry does exist**: `logEvent`/`logError` calls (structured console logging via `src/lib/logger.ts`) at each pipeline stage — `document_stored`, `document_text_layer_used`, `document_analysed`, `document_analysis_complete`, `ddt_extraction_completed`, `ddt_upload_analyzed`, `ddt_order_confirmed`, `ddt_confirm_retry_recovered`, `ddt_confirm_duplicate_race_recovered`, plus error-side events. These are genuinely useful for post-hoc debugging of a specific incident, but they are **console logs, not metrics** — nothing aggregates them, no dashboard reads them, and (being server logs on Vercel) they have whatever retention the hosting plan provides.

---

## 44. Supplier-specific knowledge

Searched for per-supplier branching (`if (supplier === ...)`, supplier-keyed config maps, layout-specific regex sets) — **none found**. The system is entirely supplier-agnostic: one prompt, one classification ruleset, one parser, applied identically to every document regardless of issuer.

The only supplier-specific *data* anywhere is:
- `supplier_customer_refs` — a learned mapping of "this supplier's code for this customer" (§24), which improves *customer matching* on repeat documents from the same supplier. This is genuine accumulated per-supplier knowledge, but it applies only to customer identification, not to layout/extraction.
- The four supplier-specific PFU article-code patterns in `ddt-classification.ts` (`EPP\d+`, `CAP\d+`, `ETP\d+`, `GTP\d+`) — hardcoded, not attributed to any named supplier in comments, and applied to all documents rather than conditionally.

**Implication for the brief's stated future intent**: there is currently no per-supplier template/layout mechanism to build on, and no stored per-supplier extraction history that could seed one — `order_documents.raw_extracted_data` (Flow B only) is the closest thing to a corpus of past extractions, and it isn't linked to supplier identity in a queryable way.

---

## 45. Tests

All in `tests/`, all Vitest, all pure-unit (no integration test hits a real provider, a real DB, or a real file).

| File | What it actually tests |
|---|---|
| `ddt-classification.test.ts` (61 lines) | `classifyLine()` — PFU never physical; other fee types; tyre via hint; tube vs tyre; UNKNOWN fallback with no hint; **fee pattern beats a physical hint** (the AI-is-not-authoritative rule) |
| `ddt-calculations.test.ts` (100) | The spec's named test cases A/B/C/E — tyre count excludes PFU/logistics even when their quantities repeat the tyre quantity; multi-line summing; tyre+tube physical-vs-tyre distinction; unreadable quantity never guessed as 1 and a fee line's unreadable quantity does *not* force review; `calculateTransportRevenue` rounding; `validateTyreCount` all four branches |
| `ddt-dedup.test.ts` (161) | `normaliseDocumentNumber` trim/upper/whitespace; exact-duplicate detection incl. the legacy-NULL-column fallback, cross-supplier non-matching, unrelated-number non-matching; fingerprint distinctness for two customers with identical same-day items; fingerprint stability across `S.r.l.`/`SRL` noise; item-signature order-independence |
| `ddt-payment.test.ts` (37) | Tests F/G — `CASH AUTISTA` → cash; `Ricevuta Bancaria 30 GG` → bank_receipt and *not* cash; never-infers-when-silent; `CONTRASSEGNO ASSEGNO` → cheque; case-insensitivity |
| `ddt-pipeline.test.ts` (357) | The most substantial file — READY/READY_MISSING_OPTIONAL paths; PFU excluded from products and counted as a charge; all three blocking conditions; colli-mismatch reviews-but-never-blocks; partial-unreadable-quantity reviews-but-never-blocks; missing-DDT-number reviews-but-never-blocks; identical-line merging (incl. never merging a null-quantity line, and joined descriptions); DUPLICATE/POSSIBLE_DUPLICATE precedence; payment signal propagation |
| `ddt-unconfigured.test.ts` (47) | The unconfigured disclosure path — exact disclosure text when no keys and no text layer; `isDdtExtractionConfigured()` for both-absent and OpenAI-only cases |
| `customer-matching.test.ts` (187) | `companyKey`/`streetKey` normalisation; all five match outcomes; VAT-prefix-agnostic matching; supplier-customer-code as decisive; primary-location fallback when no address extracted; **cross-customer location leakage prevention** |

**Missing test coverage, per the brief's list, verified by absence**:
- Multilingual documents — **no test** feeds a Romanian/German/English document through any parser (the prompts claim support; nothing verifies it).
- Decimal commas — **no test** for either `asNumber()` variant's comma handling (the §14 Flow-B corruption bug is entirely untested and undetected).
- Multiple DDTs in one PDF — **no test** of multi-document splitting at all (the whole `documents[]` array path is only ever exercised with a single-element array in `ddt-pipeline.test.ts`); the within-batch duplicate gap in §21 is consequently untested.
- Multiple customers in one document — no test.
- Wrapped product lines — no test.
- Quantities — well covered for the null case, **not** covered for text/`"4 pcs"`/negative/zero forms.
- PFU — very well covered (the single best-tested rule in the system).
- Discount lines — classification is tested generically ("other non-product lines"); no test of a discount's *amount* flowing into `document_charges`.
- Duplicate invoices — well covered at the pure-function level; **no test** of the API-level idempotency/23505-recovery path in `confirm/route.ts`.
- Poor scans / rotated images — no test (and no fixture to test with).
- Malformed model output — **no test** of `parseModelJson()`'s fence-stripping or brace-slicing fallback in either flow, despite these being the primary defense against a misbehaving model.
- Coercion generally (`coerce.ts`, `anthropic-analyzer.ts`'s `coerceResult`) — **entirely untested**, including every wrong-type/null-string/`"N/A"` case in §14.
- Provider fallback chain (`extractor.ts`) — untested beyond the unconfigured case.
- `product-normalise.ts`'s size/brand/load-speed parsers — **no dedicated test file** (`tests/product-normalise.test.ts` does not exist), despite this being the deterministic tyre-parsing core; the §17 commercial-size gap is untested.

---

## 46. Fixtures / sample documents

- **Invoice/DDT PDFs**: **none** in the repository (the only `.pdf` present is `print-agent/output/sample-label.pdf`, a generated thermal-label sample, unrelated to import).
- **DDT fixtures**: none as files — all test fixtures are **inline TypeScript object literals** (`document()`/`line()` builder functions in `ddt-pipeline.test.ts`, similar inline builders in the other test files).
- **JSON extraction fixtures** (a recorded real model response to replay): **none** — this is why the coercion and fence-parsing layers are untested (§45).
- **Screenshots**: none.
- **Expected-output fixtures**: none.

No sensitive real customer documents are present in the repository, so there is nothing to redact in this report.

---

## 47. Edge-case inventory (from current code only)

| Edge case | Currently handled? | How | Risk |
|---|---|---|---|
| Digital (text-layer) PDF | **Yes, well** | Flow B extracts text first and can skip AI entirely; Flow A uses it as fallback | Low |
| Scanned PDF (no text layer) | **Yes** | `looksLikeUsableText()` gate fails → AI vision path | Low, but full-file token cost with no page cap |
| Photo (JPEG/PNG/WEBP) | **Yes** | Native image block to the model | Medium — no preprocessing at all (§7) |
| **HEIC photo** | **NO** | Accepted at upload, rejected by both providers' MIME allowlists → falls to text path (impossible for HEIC) → `unconfigured`/`failed` | **HIGH** — the default iPhone capture format silently cannot be processed |
| Rotated image | **No** | No EXIF handling, no rotation correction | Medium — delegated entirely to model tolerance |
| Poor-quality photo (blur/dark) | **No** | No quality validation or warning | Medium — no signal to the admin that the input was marginal |
| Multi-page single document | **Yes** | Whole file sent; model reads across pages | Low functionally; uncapped cost |
| **Multiple invoices in one PDF** | **Partially** | AI-decided splitting only, zero deterministic verification (§21) | **HIGH** — under/over-splitting is undetectable, and over-splitting can produce two orders from one document within a single batch (§21) |
| Multiple customers in one document | **No** | Schema holds exactly one customer; model must silently pick | Medium-High, unmeasured |
| Duplicate document (across uploads) | **Yes, well** | Exact number + fingerprint + DB unique index (§28) | Low |
| Duplicate within one upload batch | **NO** | `existingOrders`/`existingFingerprints` fetched once, never updated mid-batch (§21) | **HIGH** |
| Missing quantity | **Yes, excellently** | `null` preserved end-to-end, line dropped at save with an explicit count reported to the admin (§18) | Low |
| Decimal comma | **Partially/buggy** | Prompt instructs normalization; Flow B's string coercion *corrupts* it if it slips through; Flow A drops it (§14) | Medium |
| Wrapped product description | **No** | Delegated to model; no line-joining logic | Medium |
| PFU line | **Yes, excellently** | Deterministic regex override that always beats the AI (§16), best-tested rule in the system | Low (Flow A) / **Medium (Flow B has no override)** |
| Transport line | **Yes** (Flow A) | `TRANSPORT_FEE_PATTERNS` — but **`PORTO` is not matched** (§16) | Low-Medium |
| Discount line | **Yes** | `sconto`/`discount` → `DISCOUNT` → `document_charges` | Low |
| VAT line | **Yes** | `IVA`/`VAT`/`bolli` → `VAT` → `document_charges` | Low |
| **Credit note** | **NO** | Not distinguished from a delivery document at all (§20) | **HIGH** — would create a positive order |
| Return | **No** | No return-specific handling; negative quantities floored to 1 by the RPC (§14) | Medium-High |
| Unknown customer | **Yes** | `new_customer` outcome, human decision required (§24) | Low |
| Multiple customer branches | **Yes, partially** | Scored and ranked; but the UI shows only the single best match with no alternative-branch picker (§26) | Medium |
| Missing document number | **Yes** | Reviews but never blocks; fingerprint layer covers dedup instead (§15) | Low |
| Missing supplier | **Yes** | Hard block, explicit reason (§15 Rule 9) | Low |
| AI timeout | **Yes, partially** | Detected and distinguished; but the fallback budget exceeds the route's `maxDuration` (§37) | **HIGH** — OpenAI fallback effectively unreachable on a slow Anthropic failure |
| No provider key | **Yes, excellently** | Explicit `unconfigured` status with honest disclosure text, never fabricates (§32) | Low |
| Corrupted PDF | **Partially** | Text extractor catches internally and degrades; the AI still receives the corrupt bytes and may return anything | Medium |

---

## 48. Duplicated implementations — side by side

| Capability | DDT pipeline (Flow A) | Older analyzer (Flow B) |
|---|---|---|
| Entry route | `/api/admin/ddt-import/analyze` + `/confirm` | `/api/admin/documents` → `/api/admin/orders` |
| Provider(s) | Anthropic → OpenAI → text fallback | Anthropic only (no OpenAI implementation exists) |
| Model | `claude-sonnet-5` / `gpt-4.1` (separate constants) | `claude-sonnet-5` (duplicated constant) |
| Timeout | 170s / 60s | 90s |
| Max tokens | 16,000 | 8,000 |
| JSON mode | OpenAI only (`json_object`); Anthropic prompt-only | Prompt-only |
| PDF handling | Sent whole to model first; text layer only as fallback | Text layer first; model only if text parse is thin/unusable |
| Images | Yes (JPEG/PNG/WEBP/GIF) | Yes (same set) |
| Prompt | `DDT_EXTRACTION_SYSTEM_PROMPT` — multi-document, hint-not-authority, verbatim-payment-text | Own `SYSTEM_PROMPT` — single-document, AI classifies payment and item type directly |
| Schema | `ExtractedDocument[]` + `pageCount` — richer (EAN, manufacturer code, commercial/M+S/3PMSF, season, colli, page range, tracking/giro/agent/carrier) | `AnalysisResult` — flatter, has `fieldConfidence` + per-line confidence + `pfuFee`/`logisticsFee` that Flow A lacks |
| Coercion | `coerce.ts` — strict (numeric strings rejected) | inline in `anthropic-analyzer.ts` — permissive (numeric strings stripped-and-parsed, with the decimal-comma bug) |
| Deterministic validation | **Full**: classification override, tyre counting, colli cross-check, payment regex, dedup, fingerprint, blocking rules (§15) | **None** — only `normaliseProduct()` gap-filling, which never overrides the AI |
| Customer matching | Yes (shared module) | Yes (same shared module) |
| Multi-document | Yes (AI-decided) | No — architecturally single-document |
| Duplicate detection | Exact + fingerprint + DB index | DB index only, and effectively inert since it never writes `normalized_document_number` (§33) |
| Idempotency on confirm | Yes, thorough (§35) | **None** (§35) |
| `document_charges` written | Yes | No |
| Fallback | 3-stage chain | 2-stage (AI ↔ text) |
| Used by | "Comandă nouă" modal upload step; `/admin/orders/import` | `/admin/orders/new`; linked from Flow A's unconfigured state |

**Why both exist**: Flow B is the original Phase-1 single-document import; Flow A was built later for the multi-DDT requirement, as a parallel implementation rather than a replacement (its own file header says so: `types.ts:1-6`, "Kept separate from src/lib/documents/* (the existing single-order analyzer): that pipeline assumes one upload = one order's worth of header/product data"). The intent was clearly to supersede, but the older path was never retired — and worse, Flow A now *depends* on Flow B (via `text-fallback.ts`), so Flow B cannot simply be deleted without first reimplementing the text-layer fallback natively.

**Are both still necessary?** Functionally, no — Flow A's capability set is a strict superset for document import, *except* for two things Flow B uniquely provides: (a) the deterministic PDF/DOCX text-layer path (which Flow A borrows rather than owns), and (b) DOCX support (Flow A's providers reject DOCX outright; only Flow B's text extractor handles it). Flow B's `/admin/orders/new` also serves the manual-entry use case, which is genuinely distinct from document import.

---

## 49. Current strengths — what is genuinely well designed

1. **The anti-hallucination architecture is real, not cosmetic.** The "AI proposes, code decides" split in Flow A is implemented with genuine rigor: `classifyLine()` text patterns *always* override the model's `itemTypeHint`; `calculateTyreCount()` sums classified lines rather than ever accepting a model-reported total; `detectPaymentSignals()` reads verbatim-copied text through fixed regexes rather than trusting a model classification. This is the correct architecture and it should be preserved wholesale.
2. **The "never guess a quantity" rule is honored end-to-end** — `null` survives coercion, is excluded from every count, is never merged into another line, and results in the line being *dropped with an explicit report to the admin* rather than saved with a fabricated value. This is the single best-implemented invariant in the system, and it's well tested.
3. **The "unconfigured" honesty path.** When no AI is available, the system returns zero extracted values with an explicit disclosure ("sistemul nu inventează valori") rather than degrading to plausible-looking guesses. Rare discipline, well worth keeping.
4. **Signed direct-to-Storage upload.** Correctly solves the real Vercel body-size problem, keeps raw bytes out of serverless functions, uses one-time tokens rather than durable browser credentials, and stores the original before analysis so a failing analyzer can never lose the upload.
5. **Duplicate protection is layered properly**: an application pre-check for a good error message, a fingerprint tier for the unreadable-number case, and — critically — a **database unique index as the actual guarantee**, with correct 23505 race recovery. The design explicitly acknowledges that the app-level check alone cannot prevent a race.
6. **Idempotent confirm with retry recovery** (Flow A) — `findExistingOrder()` + `recoverExistingOrder()` + an idempotent `advanceDdtOrderToStored()` is a genuinely thoughtful treatment of the "committed but the response was lost" problem.
7. **Customer master data is never silently overwritten.** Every address-affecting write requires an explicit admin resolution choice; `use_for_this_order_only` stores the address on the order snapshot and touches nothing in `customer_locations`. The asymmetry with suppliers (auto-created freely) is deliberate and correctly reasoned.
8. **Atomic core order creation.** Order + items + units + history in one Postgres function means the most important invariant ("an order never exists without its physical units") genuinely holds.
9. **Typed coercion at every model boundary.** No model output is ever spread directly into application state; every field passes through an explicit `asString`/`asNumber`/`asBoolean`. The strictness level differs between flows (§14), but the *discipline* is present in both.
10. **`raw_description` preservation.** The document's own text is kept verbatim through normalisation, storage, and display — so a human can always audit what the machine actually read.

---

## 50. Current weaknesses — ranked for document→order accuracy

### CRITICAL

**C1 — Two divergent pipelines with different safety guarantees, both live.**
*Evidence*: §2, §48. Flow B has none of Flow A's deterministic validation, no duplicate fingerprinting, no idempotency, and never populates `normalized_document_number`/`fingerprint`/`tyre_count`.
*Failure scenario*: an admin imports a DDT via `/admin/orders/new` (reachable directly, and linked from Flow A's own unconfigured state) — that order has no fingerprint, so when the same physical document arrives again next week through Flow A, the fingerprint layer cannot detect it; a double-click on "Salvează" creates two orders with no idempotency protection.
*Operational impact*: duplicate orders, inconsistent data completeness across orders, and a PFU line potentially becoming a physical inventory item.
*Direction*: consolidate on one pipeline.

**C2 — HEIC (the default iPhone photo format) cannot be processed at all.**
*Evidence*: §4, §47. Accepted at upload, rejected by every provider's MIME allowlist, no text layer possible.
*Failure scenario*: warehouse staff photograph a DDT with an iPhone; upload succeeds; analysis returns `unconfigured`/`failed`; the entire document must be typed manually.
*Operational impact*: the most natural capture path for a photographed document is silently broken.
*Direction*: convert HEIC server-side, or add it to the provider allowlists if natively supported.

**C3 — Provider fallback is effectively unreachable on a slow failure.**
*Evidence*: §37. Anthropic's 170s timeout equals the route's entire 170s `maxDuration`; OpenAI's 60s can never run after it.
*Failure scenario*: Anthropic hangs (rate limit, degraded service); the function is killed at 170s; the admin sees a generic failure with no result, despite a second provider being configured and available.
*Operational impact*: the redundancy that was paid for and built does not function in the one scenario it exists for.

**C4 — Within-batch duplicate detection is absent.**
*Evidence*: §21. `existingOrders`/`existingFingerprints` are fetched once per upload and never updated as documents in that same batch are confirmed.
*Failure scenario*: the AI over-splits one physical DDT into two `documents[]` entries; both check clean against the pre-upload DB state; both show `READY`; the admin confirms both; two orders exist for one delivery. (The DB unique index catches this *only* if both carry the same non-null normalized document number — which over-splitting typically would, so this is partly mitigated in practice, but the resulting failure surfaces as a confusing `ALREADY_IMPORTED` mid-batch rather than being prevented.)

### HIGH

**H1 — Credit notes are indistinguishable from delivery documents.** §20, §47. A credit note becomes a positive inbound order.
**H2 — Multi-document splitting has zero deterministic verification.** §21. Under-splitting silently loses whole DDTs; nothing detects it.
**H3 — The review UI cannot show the original document side-by-side.** §30. The system's entire safety model rests on human review, performed without access to the source.
**H4 — Flow A's primary review surface offers no inline correction.** §30. A noticed error forces an all-or-nothing detour through a different form.
**H5 — Payment-term coverage has real false negatives.** §27. `bonifico`, `pagato`, `rimessa diretta`, bare `contrassegno` (Flow A) all undetected → a COD delivery can be treated as prepaid.
**H6 — Confidence is computed everywhere and used nowhere.** §31. No threshold, no gating, not even displayed — the system cannot act on, or show, its own uncertainty.
**H7 — Negative/zero quantities are silently floored to 1 inside SQL.** §14, §18. A misread quantity becomes a plausible-looking 1 with no flag, invisible to review.
**H8 — Flow B's decimal-comma string coercion corrupts values.** §14. `"4,5"` → `45`.

### MEDIUM

**M1 — No image preprocessing whatsoever.** §7. Full-resolution phone photos, no EXIF rotation, no quality gate.
**M2 — Uncapped PDF page count.** §6, §39, §41. Unbounded cost and latency per upload.
**M3 — Several extracted fields are architecturally dead.** §12, §33. EAN, manufacturer code, commercial/M+S/3PMSF, season, `lineTotal`, customer phone, `documentType`, page ranges — extracted (paying tokens) and discarded.
**M4 — `advanceDdtOrderToStored()` and the charges insert are non-atomic and fail silently.** §34, §36. The admin sees success while metadata is missing.
**M5 — Fingerprint dedup silently stops working past 2,000 orders.** §41. `getRecentFingerprints(limit=2000)`.
**M6 — Supplier auto-creation has no fuzzy matching.** §25. "Carlini Gomme Srl" vs "Carlini Gomme S.r.l." with no VAT → duplicate supplier, silently.
**M7 — Commercial tyre sizes (`185 R14C`, `195/75 R16C`) are not deterministically parsed.** §17.
**M8 — Flow A has no deterministic tyre detection.** §16. A tyre the AI fails to hint is classified `UNKNOWN` and silently excluded from the order.

### LOW

**L1 — `"null"`/`"N/A"` strings are stored verbatim rather than nulled.** §14.
**L2 — Document-number normalization ignores punctuation.** §28. `INV-001` ≠ `INV001`.
**L3 — `PORTO` missing from Flow A's transport-fee patterns.** §16.
**L4 — `NR` missing from the quantity-label regex.** §18.
**L5 — No prompt caching despite a large static system prompt.** §39.
**L6 — Oversized files can be uploaded to Storage before being rejected.** §4. Orphaned objects.
**L7 — `orders.source_hash` exists, indexed, never populated.** §35.

---

## 51. Token / speed inefficiencies — ranked

1. **Triple-paid extraction in the worst-case fallback chain** (§39) — Flow A Anthropic → Flow A OpenAI → Flow B Anthropic (via `text-fallback.ts` → `analyzeDocument()` → `analyzer.analyze()`). Three billed calls, one document.
2. **No prompt caching** (§39) — a ~1,150-token static system prompt re-sent on every single call, with `cache_control` available and unused.
3. **Uncapped page count** (§6) — the largest single per-document cost variable, entirely unbounded.
4. **No re-analysis cache** (§35) — same file re-uploaded pays full cost again; `source_hash` exists for exactly this and is never computed.
5. **Full-resolution images sent unprocessed** (§7) — a 12MP phone photo costs far more than a downscaled one at no accuracy benefit past a certain resolution.
6. **Base64 33% inflation** (§39) — unavoidable per-call, but compounds every item above.
7. **Sequential per-document confirm loop** (§41 item 8) — 10 documents = 10 serial round-trips, each with several non-batched DB writes.
8. **`getExistingOrderIdentities()` is unbounded** (§41 item 10) — fetches every order for a supplier on every upload.
9. **`getRecentFingerprints(2000)` per upload** (§41 item 9) — 2,000 rows fetched and linearly scanned per document.
10. **Storage re-download server-side** (§41 item 7) — inherent to the direct-upload design, but doubled on any re-analysis.
11. **Flow B always runs text extraction even when AI will be called anyway** — minor CPU, not tokens, but it's a full-file parse whose result is often discarded (`index.ts:84`, kept only as diagnostic `extractedText`).

---

## 52. Reliability risks — ranked

1. **Wrong customer / wrong delivery address** — `NAME_MATCH_THRESHOLD = 0.99` makes false-positive company matching unlikely, but `tokenSimilarity` is a crude shared-token ratio: two genuinely different companies sharing all tokens in a different order (or a parent/subsidiary pair) score 1.0 and auto-confirm. Combined with the branch-picker gap (§26) and the absence of any billing-vs-delivery distinction (§23), a delivery to the wrong branch of the right customer is the most plausible high-impact failure.
2. **Duplicated order** — within-batch (C4) and Flow-B-created orders having no fingerprint (C1) are both real paths to a genuine double-order.
3. **Missed DDT (silent document loss)** — AI under-splitting a multi-DDT PDF (H2) with no verification; nothing compares reported `documents.length` against any independent signal.
4. **Missing product / silently dropped line** — three separate paths: a physical line the AI didn't hint and no fee pattern matched → `UNKNOWN` → excluded (M8); a classified type with no `LINE_TYPE_TO_ITEM_TYPE` entry → filtered to `null` at confirm (§33); a null-quantity line → deliberately dropped (correct, and reported, but still a line that isn't in the order).
5. **False quantity** — negative/zero floored to 1 in SQL with no flag (H7); decimal-comma corruption in Flow B (H8); `"4.000"` ambiguity (§18).
6. **Misclassified fee as tyre** — well-defended in Flow A (best-tested rule in the system); **undefended in Flow B**, where the AI's `itemType` is final.
7. **Partial save** — `document_charges` and `advanceDdtOrderToStored()` failures are logged-only and reported as success (M4).
8. **Silent failure generally** — the recurring pattern across §34/§36: several secondary writes fail without ever reaching the admin's screen.
9. **Wrong payment state** — undetected `bonifico`/`pagato`/bare `contrassegno` (H5) meaning a driver isn't told to collect.

---

## 53. Final current-system diagram

See §3 — that diagram is the complete current-state map, including both branches, the cross-pipeline `text-fallback` dependency, and the point where both flows converge on `gorush_create_order`.

---

## 54. Baseline scorecard

| Dimension | Score | Rationale |
|---|---|---|
| Extraction accuracy | **6/10** | Strong prompts, good structured schema, real per-field discipline — but zero deterministic cross-checking of the AI's structured output in Flow A (§16/§17), no verification of anything the model reports about document boundaries or page ranges, and a second pipeline with no validation at all |
| Quantity safety | **7/10** | The null-never-guessed rule is excellent and well tested; undermined by the SQL `greatest(…,1)` silent floor for negative/zero (H7) and the decimal-comma coercion bug (H8) |
| Customer/address accuracy | **6/10** | Thoughtful multi-signal matcher with sensible thresholds and a strong never-overwrite rule; weakened by crude token similarity, no billing/delivery distinction, and no alternative-branch picker in the UI |
| Multi-document handling | **4/10** | Exists and works in the happy path, but is 100% AI-trusted with no verification, no within-batch dedup, and silently degrades to single-document without AI |
| Poor scan handling | **3/10** | No OCR layer, no preprocessing, no quality gate, no rotation handling — and HEIC, the most likely photo format, doesn't work at all |
| Anti-hallucination | **8/10** | The strongest dimension: honest `unconfigured` state, verbatim `rawDescription`, null-not-guessed, deterministic override of AI classification, typed coercion everywhere. Docked for Flow B trusting the AI's own item-type/payment classification with no override |
| Duplicate protection | **7/10** | Layered correctly (app check + fingerprint + DB index + race recovery) and well tested; docked for the within-batch gap, the 2,000-order fingerprint ceiling, punctuation-blind normalization, and Flow B contributing nothing to it |
| Reliability | **5/10** | Core order creation is genuinely atomic and confirm is genuinely idempotent (Flow A) — but several secondary writes fail silently while reporting success, and Flow B has no idempotency at all |
| Speed | **4/10** | Uncapped pages, no preprocessing, serial fallback that exceeds its own route budget, serial per-document confirms |
| Token efficiency | **3/10** | No caching, no page cap, no image downscaling, no re-analysis cache, and a worst case that pays three providers for one document |
| Cost efficiency | **3/10** | Same drivers as above, with zero cost visibility to even detect the problem |
| Observability | **2/10** | Structured event logs exist and are genuinely useful for incident debugging; but no tokens, no latency, no cost, no per-supplier quality, no correction tracking, and `extraction_status`/`analysis_provider` are never written by the primary flow |
| Maintainability | **4/10** | Individual modules are clean, well commented, and purposefully separated; but two parallel pipelines with duplicated constants, duplicated JSON parsers, inverted trust models, and a circular dependency between them is a substantial ongoing burden |

---

## 55. Questions that materially affect the redesign

Deliberately excluding anything already answerable from the code:

1. **What fraction of incoming documents are digital text PDFs versus scans/photos?** This single number determines whether the redesign should optimize the cheap deterministic path (potentially avoiding an AI call entirely for most documents) or accept that vision is the primary path and invest in preprocessing instead.
2. **Can one supplier PDF legitimately contain several *different end customers*?** (Distinct from several DDTs for the same customer.) §22 shows this is unhandled; whether it's a real scenario changes the data model, not just the prompt.
3. **Which suppliers account for most volume, and are their layouts stable?** §44 shows there's currently no supplier-specific handling at all. If 3–5 suppliers cover most documents with stable layouts, a deterministic per-supplier template path could handle the bulk far more cheaply and accurately than any general model call.
4. **Which fields are genuinely required to create a usable order, versus nice-to-have?** §12/§33 show ~10 extracted fields are dead (EAN, manufacturer code, season, M+S/3PMSF, page ranges, `lineTotal`, customer phone…). Knowing what operations actually needs would let the redesign stop paying tokens to extract data nobody uses.
5. **Do you need prices/PFU amounts at all, or only logistics information (who, where, how many tyres)?** The financial extraction layer (§19) is substantial, partially wired, and has no arithmetic reconciliation. If the business only needs tyre counts and delivery addresses, a large amount of extraction complexity and token cost can simply be deleted.
6. **Are credit notes / returns ever sent through this same upload path?** §20 shows they'd become positive orders. If yes, this is a data-integrity bug that needs a document-type gate before anything else.
7. **What is the acceptable end-to-end wait for an admin uploading a document?** Current worst case is >170s ending in failure (§37). Whether the target is "under 10 seconds" or "a minute is fine" determines whether async/queued processing is required or a tightened synchronous path suffices.
8. **How often does an admin actually correct an extracted value before confirming?** Not currently measurable (§43). If corrections are rare, the review step could be streamlined toward one-tap confirm; if common, the review UI (§30's missing document preview and missing inline editing) is where the accuracy investment should go.

---

*End of baseline. No code was modified in producing this document.*









