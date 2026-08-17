# GommaRush / GoRush

Next.js + TypeScript application for GommaRush, a tyre supplier serving garages
and automotive businesses around Verona. Deployed on Vercel, with Supabase as
the database and Resend for transactional email.

Two things live here:

1. **The public site** — landing page and the offer-request form (Italian).
2. **GoRush Logistics (Phase 1)** — the internal warehouse and delivery system:
   supplier order import, goods matching, temporary stands, label printing,
   barcode storage confirmation and van loading (Romanian operational UI).
   See **[docs/LOGISTICS.md](docs/LOGISTICS.md)** for the full guide, and
   **[print-agent/README.md](print-agent/README.md)** for the Windows print agent.

## Quick start for the logistics system

```bash
npm install
cp .env.local.example .env.local     # add SUPABASE_SERVICE_ROLE_KEY — required
npm run dev
```

Open <http://localhost:3000>, click **Admin**, sign in with `test` / `test`.

| Command | Purpose |
|---|---|
| `npm run dev` | Run the app |
| `npm test` | Unit tests |
| `npm run typecheck` | TypeScript |
| `npm run build` | Production build |
| `npm run seed:dev -- --confirm` | Development seed data (drivers, vans, 3 demo orders) |
| `npm run seed:dev -- --clean --confirm` | Remove the seed data |

## Stack

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS
- Supabase (Postgres + JS client)
- Resend (transactional email)
- Zod (server-side validation)

## Project structure

```
app/
  page.tsx                        Landing page ("/") + Admin button
  get-offer/page.tsx               Offer-request form ("/get-offer")
  request-confirmation/page.tsx    Post-submit confirmation page
  api/offer-requests/route.ts      POST /api/offer-requests

  admin/login/                     Admin login (outside the guarded layout)
  admin/(secure)/                  All authenticated admin pages
  driver/                          Driver operational page
  warehouse/                       Storage barcode scanning station
  stand/[code]/                    Permanent stand QR resolver
  orders/[id]/, u/[token]/         Public read-only views
  api/admin|driver|warehouse/      Server operations

print-agent/                       Windows print agent (separate package)
docs/LOGISTICS.md                  Logistics system guide

src/
  components/                      Shared UI (form fields, modal, buttons…)
  lib/
    types/
      offer-request.ts             Canonical API/DB contract types
      ui.ts                        Frontend-only tyre/season/delivery types
    validation/
      offer-request.ts             Zod schema for the API route
      tyre-form.ts                 Frontend form validation helpers
    supabase/server-admin.ts       Service-role Supabase client (server-only)
    email/send-offer-request.ts    Resend integration + HTML/text templates
    offers/admin-queries.ts        Server-only queries for a future dashboard
    contact-detection.ts           Email-vs-phone detection (server-only)
    rate-limit.ts                  Best-effort in-memory rate limiter
    logger.ts                      Safe (no-secrets) server logging
    offer-confirmation-storage.ts  sessionStorage helper for the confirmation page

supabase/migrations/
  20260804000000_client_offer_requests.sql   Full schema migration
```

## 1. Run the Supabase migration

Open the Supabase dashboard for project `sfvaqextratpnprcamwd` →
**SQL Editor** → paste the entire contents of
`supabase/migrations/20260804000000_client_offer_requests.sql` → **Run**.

It creates the `client_offer_requests` table, the request-number sequence,
the `is_valid_tyre_request` validation function + constraint, the
`updated_at` trigger, all indexes, and enables Row Level Security **with no
policies** — meaning the anon key cannot read, insert, update, or delete
rows at all. Only the service-role key (server-side only) can touch this
table. The script is idempotent, so re-running it is safe.

## 2. Where to get each credential

**Supabase anon key** — Supabase dashboard → your project → **Project
Settings → API** → "Project API keys" → the key labeled **`anon` `public`**.
Safe to expose to the browser.

**Supabase service-role key** — same page → the key labeled **`service_role`
`secret`**. Treat this like a database password with full access — server-side
only, never in a client component, never logged.

**Resend API key** — [resend.com](https://resend.com) → **API Keys** → **Create
API Key**. Give it "Sending access" scope. Server-side only.

## 3. Verify the sender domain in Resend

1. Resend dashboard → **Domains** → **Add Domain** → enter `gommarush.com`.
2. Resend shows a set of DNS records (SPF/DKIM, typically a `TXT` and one or
   more `CNAME` records). Add exactly those records at your DNS provider for
   `gommarush.com`.
3. Wait for propagation, then click **Verify** in Resend. Status must show
   **Verified** before `offerte@gommarush.com` can send mail — sends will
   fail (and the request will still save, per the failure-handling design)
   until this is done.
4. Confirm `vendite@gommarush.com` is a real, working mailbox or a forwarding
   address you actually check — Resend doesn't validate that for you; send
   yourself a test (see step 9 below) and confirm it lands in that inbox.

## 4. Environment variables

Copy `.env.local.example` to `.env.local` and fill in the blanks:

```bash
cp .env.local.example .env.local
```

Then add the **same** variables in **Vercel → your project → Settings →
Environment Variables**, once for each of **Production**, **Preview**, and
**Development**. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
are also fine to expose to the browser, but they still need to be set in
Vercel's env var UI (that's what bakes them into the build) — "public" here
means "safe if a user's browser can read it," not "already available
without configuration."

**Redeploy after changing env vars.** Next.js inlines `NEXT_PUBLIC_*`
variables into the JavaScript bundle at build time, and server-only
variables are only read into a serverless function's environment when that
function is built/deployed — editing them in the Vercel dashboard doesn't
retroactively change an already-built deployment. Trigger a new deployment
(push a commit, or use "Redeploy" in the Vercel dashboard) any time you add
or change an environment variable.

## 5. Local development

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`. The `/api/offer-requests` route needs real
Supabase + Resend env vars to fully succeed; without them it fails
gracefully (saves nothing, returns `REQUEST_SAVE_FAILED`) rather than
crashing, which you can use to sanity-check the frontend's error/retry UI
before wiring up real credentials.

## 6. Submit a test offer request

1. Go to `/get-offer`.
2. Fill in a contact (email or phone), add at least one tyre (Aggiungi
   pneumatico → fill width/profile/rim → pick a season → Aggiungi
   pneumatico), then click **Invia richiesta di offerta**.
3. On success you're redirected to `/request-confirmation` showing the
   request number and a summary.

## 7. Verify the row in Supabase

Supabase dashboard → **Table Editor** → `client_offer_requests`. You should
see a new row with your test data, `status = new`, and
`notification_email_status` reflecting the email outcome (see below).
Alternatively, **SQL Editor**:

```sql
select request_number, contact_value, tyres, notification_email_status,
       notification_email_error, created_at
from client_offer_requests
order by created_at desc
limit 5;
```

## 8. Verify the email was sent

- Check the `vendite@gommarush.com` inbox for a message with subject
  `Nuova richiesta GommaRush – GR-…`.
- Resend dashboard → **Logs** (or **Emails**) shows every send attempt with
  delivery status — cross-check the `notification_email_id` column in
  Supabase against a log entry there.
- The API response's `emailSent` field (and the Supabase row's
  `notification_email_status`) tell you the outcome without needing to
  check your inbox at all.

## 9. Test the confirmation page

- **Normal path**: submit a real request (step 6) and confirm you land on
  `/request-confirmation` with the correct number/summary, and that
  visiting `/get-offer` again afterward shows a clean, empty form.
- **Fallback path**: open `/request-confirmation` directly (e.g. paste the
  URL in a new tab, or refresh the confirmation page) without having just
  submitted — you should see "Nessuna richiesta recente trovata." and a
  button back to `/get-offer`. This is expected: the confirmation summary
  lives in `sessionStorage` and is deliberately cleared the moment it's
  read, so it can't show stale data from a previous request.

## 10. Diagnose `notification_email_status = failed`

1. Read `notification_email_error` on that row in Supabase — it holds a
   truncated, safe version of whatever Resend (or the network call) reported.
2. Common causes:
   - **Domain not verified yet** — check Resend → Domains → `gommarush.com`
     shows "Verified", not "Pending".
   - **`RESEND_API_KEY` missing/invalid in the deployed environment** —
     re-check Vercel env vars for the environment you're testing (Production
     vs Preview use different values if you set them differently), and that
     you redeployed after adding them.
   - **`RESEND_FROM_EMAIL` domain mismatch** — the from-address domain must
     match a verified Resend domain exactly.
3. Once fixed, resubmit the **same** browser session's form again without
   clearing it (or POST directly with the same `idempotencyKey`) — the API
   recognizes the existing row via `idempotency_key`, does **not** create a
   duplicate, and retries the email send since the previous status was
   `failed`.
4. The customer never sees this — the confirmation page renders identically
   whether the email succeeded or failed, per the "Supabase row is the
   source of truth" design.

## Security notes

- `SUPABASE_SERVICE_ROLE_KEY` and `RESEND_API_KEY` are only ever read in
  files that `import "server-only"` (`server-admin.ts`, `send-offer-request.ts`,
  `contact-detection.ts`, `rate-limit.ts`, `logger.ts`, `admin-queries.ts`) —
  importing any of them from a client component fails the build.
- Row Level Security is on with zero policies: the anon key cannot touch
  `client_offer_requests` at all. All writes go through
  `/api/offer-requests`, which uses the service-role key server-side.
- The API route rejects non-JSON content types, oversized bodies (>20KB),
  malformed JSON, anything that fails the Zod schema, and honeypot-filled
  submissions — all before touching the database.
- Rate limiting is a best-effort in-memory per-IP limiter (see
  `src/lib/rate-limit.ts` for its documented limitations under serverless
  scaling). For stricter enforcement, swap it for Upstash Redis or Vercel KV.
- Server logs (`src/lib/logger.ts`) never include the request payload,
  headers, or any secret — only event names and small identifiers like a
  request ID.

## Admin dashboard (not yet built)

`src/lib/offers/admin-queries.ts` has ready-to-use, server-only functions
for a future `/admin/offers` route: list (paginated, newest first, filter by
status/delivery preference), get by id, search by request number/company/
contact, and update status/internal notes. None of it is wired to any route
today — nothing here is reachable from a browser until a dashboard page is
built and gated behind Supabase Auth.
