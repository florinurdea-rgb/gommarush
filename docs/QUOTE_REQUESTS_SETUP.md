# Quote requests — setup

Everything needed to take `/richiedi-offerta` from "deployed but inert" to
"accepting real customer requests". There is **one mandatory step** (the
database migration); the rest is already configured if the existing
offer-request feature works.

---

## Step 1 — Run the migration (MANDATORY)

Until this runs, submitting the form returns `SAVE_FAILED`: the tables and the
transactional function it calls don't exist yet.

**Option A — Supabase SQL Editor (no tooling needed)**

1. Open the Supabase dashboard → your project → **SQL Editor** → **New query**.
2. Paste the entire contents of
   `supabase/migrations/20260826000000_quote_requests.sql`, press **Run**.
3. Then paste `supabase/migrations/20260827000000_quote_requests_production.sql`
   and press **Run**.
4. Then paste `supabase/migrations/20260829000000_delivery_48h.sql` and press
   **Run** — this renames the fast delivery option from 24h to 48h.

The second file adds the `GR-YYMMDD-NNNN` reference, the full quotation
lifecycle, notification tracking, the event log and the realtime broadcast.
Run them in this order; each builds on the one before.

The file is written to be safe to re-run: every statement is
`create ... if not exists`, `create or replace`, or a guarded `do` block. If
you run it twice nothing breaks.

**Option B — Supabase CLI**

```bash
supabase db push
```

Use this only if the project's migration history is already in sync with the
CLI; otherwise Option A is the lower-risk path.

### Confirm it worked

Run this in the SQL Editor. All four rows should report `OK`.

```sql
select 'quote_requests table'      as check,
       case when to_regclass('public.quote_requests') is not null
            then 'OK' else 'MISSING' end as result
union all
select 'quote_request_items table',
       case when to_regclass('public.quote_request_items') is not null
            then 'OK' else 'MISSING' end
union all
select 'create function',
       case when exists (
         select 1 from information_schema.routines
          where routine_schema = 'public'
            and routine_name = 'gorush_create_quote_request'
       ) then 'OK' else 'MISSING' end
union all
select 'RLS enabled on both tables',
       case when (
         select bool_and(rowsecurity) from pg_tables
          where schemaname = 'public'
            and tablename in ('quote_requests', 'quote_request_items')
       ) then 'OK' else 'NOT ENABLED' end
union all
select 'public_reference column',
       case when exists (
         select 1 from information_schema.columns
          where table_schema='public' and table_name='quote_requests'
            and column_name='public_reference'
       ) then 'OK' else 'MISSING' end
union all
select 'event log table',
       case when to_regclass('public.quote_request_events') is not null
            then 'OK' else 'MISSING' end
union all
select 'notification RPC',
       case when exists (
         select 1 from information_schema.routines
          where routine_schema='public' and routine_name='gorush_record_notification'
       ) then 'OK' else 'MISSING' end;
```

---

## Step 2 — Environment variables

**Most likely: nothing to do.** The quote flow reuses the existing Resend
account, and every variable it needs already falls back to one the
offer-request feature uses.

| Variable | Needed? | Falls back to |
|---|---|---|
| `RESEND_API_KEY` | Already set if the existing offer form sends mail | — |
| `EMAIL_FROM` | Optional | `RESEND_FROM_EMAIL` |
| `SALES_NOTIFICATION_EMAIL` | Optional | `OFFER_NOTIFICATION_EMAIL` (already `vendite@gommarush.com`) |
| `NEXT_PUBLIC_APP_URL` | Recommended | `VERCEL_URL` |
| `RESEND_WEBHOOK_SECRET` | Only for delivery confirmation (Step 3b) | — |

Set `EMAIL_FROM` / `SALES_NOTIFICATION_EMAIL` **only** if quote notifications
should go somewhere different from the older offer-request notifications.

`NEXT_PUBLIC_APP_URL` (e.g. `https://gommarush.com`) is what makes the **Apri
richiesta** button in the notification e-mail point at your real domain rather
than a generated Vercel preview URL. It is safe to expose — it is only your
public site address.

To add any of them: Vercel → project → **Settings → Environment Variables** →
add for **Production** (and Preview if you want it there too) → **redeploy**.
Environment changes do not take effect until a new deployment.

> Never add `SUPABASE_SERVICE_ROLE_KEY` or `RESEND_API_KEY` to a variable whose
> name begins with `NEXT_PUBLIC_` — that prefix ships the value to every
> visitor's browser.

### If e-mail is not configured

The request is still saved and still appears in the admin dashboard. The row is
marked with a failure reason and the admin list shows an **Email KO** badge.
Nothing is lost — the e-mail is a notification, not the record.

---

## Step 3 — Resend sending domain

Only relevant if e-mail currently fails with a domain error.

1. Resend dashboard → **Domains** → confirm the domain in `RESEND_FROM_EMAIL`
   (`gommarush.com`) shows **Verified**.
2. If not, add it and publish the DNS records Resend gives you.

The recipient (`vendite@gommarush.com`) needs no verification — only the
*sending* domain does.

> On a Resend account with **no verified domain**, sending is restricted to
> the account owner's own address and everything else is rejected with a
> `validation_error`. That is the single most common reason a correctly
> configured key still sends nothing.

---

## Diagnosing "no e-mail arrived"

Never guess at this — the app records the provider's own reason and shows it
to you.

**`/admin/richieste-offerta`** shows a red banner at the top when the
deployment cannot send at all, naming the exact environment variables that are
missing, and an **Email KO** badge on any request whose notification failed.

**Open the request.** The red panel carries three things:

1. the provider's verbatim error (`validation_error: The gommarush.com domain
   is not verified.`, `invalid_access_token: API key is invalid`, …);
2. the resolved configuration — whether a key is present and whether it is
   shaped like a Resend key (`re_…`), plus the From and To actually in use.
   No secret value is ever rendered;
3. **Riprova invio email**, which re-attempts the send for that request.

That last button is the point of the persist-before-notify design: fix the
configuration, redeploy, press the button, and the notification for a request
that arrived during the outage still goes out. Nobody has to ask the customer
to submit again.

| What the panel says | What it means | Fix |
|---|---|---|
| `EMAIL_NOT_CONFIGURED: RESEND_API_KEY` | The variable isn't set in this environment | Step 2, then redeploy |
| Key "impostata ma non sembra una chiave Resend" | Something other than a Resend key is in `RESEND_API_KEY` | Paste the `re_…` key |
| `invalid_access_token` / `API key is invalid` | Wrong, revoked, or whitespace-damaged key | Regenerate in Resend, re-paste, redeploy |
| `validation_error: … domain is not verified` | Sending domain unverified | Step 3 |
| `You can only send testing emails to your own email address` | Resend account has no verified domain | Step 3 |

---

## Step 3b — Delivery confirmation (optional but recommended)

Without this, the system knows Resend *accepted* each message. It cannot know
the message reached `vendite@gommarush.com`. The **Sistema** page says so
explicitly when it sees sends but no deliveries.

1. Resend dashboard → **Webhooks** → **Add endpoint**.
2. URL: `https://gommarush.com/api/webhooks/resend`
3. Subscribe to: `email.sent`, `email.delivered`, `email.bounced`,
   `email.complained`.
4. Copy the signing secret (`whsec_…`) into the Vercel environment variable
   `RESEND_WEBHOOK_SECRET`, then redeploy.

The endpoint verifies every request's signature before reading its body, and
is idempotent — a redelivered event changes nothing.

---

## Step 4 — End-to-end check

1. Open the site. It should be in **Italian** with no language cookie set.
2. Open the hamburger → switch to **English** → reload → it stays English.
   Switch back to Italian.
3. Click **Richiedi un'offerta**.
4. Add a tyre: `205 / 55 / R16`, index `91V`, quantity `4`, *Miglior prezzo*,
   *48 ore* → **Aggiungi**.
5. Add another: `225 / 45 / R17`, quantity `2`, *Marca specifica* → `Michelin`,
   *7 giorni*.
6. Add **Altro prodotto**: `Valvole TR414`, quantity `20`, *7 giorni*.
7. Fill company + e-mail, optionally a WhatsApp number.
8. **Richiedi l'offerta** → you should land on **Richiesta inviata** with a
   reference like `GR-260825-0001`.
9. Sign in to `/admin` → **Richieste di offerta** → the request is at the top
   with an item count of 3.
10. Open it → check the customer block and all three products → **Segna in
    lavorazione** → reload → the status persisted.
11. **Apri in Excel** → open the file → type a unit price → the row total and
    **Totale offerta** should calculate automatically.
12. Sign out, then open the admin detail URL directly → you should be
    redirected to the login page, not shown the data.

---

## What could go wrong

| Symptom | Cause | Fix |
|---|---|---|
| Submit fails with a generic error | Migration not run | Step 1 |
| Request saved, **Email KO** badge in admin | Resend key missing/invalid, or unverified domain | Open the request — the panel names the reason. See *Diagnosing* above |
| **Apri richiesta** in the e-mail points at a Vercel preview URL | `NEXT_PUBLIC_APP_URL` unset | Step 2 |
| Site loads in English first | A `gr_locale` cookie is already set in that browser | Expected — clear cookies to see a first-time visitor's view |
| Excel totals show `0` | Prices not entered yet | Expected — the column is intentionally empty for the operator |

---

## Note on the older `/get-offer` flow

It is gone. The route, its API endpoint, its UI components and its admin query
layer were removed; `/richiedi-offerta` is now the only customer quote path.

Its `client_offer_requests` table is deliberately **not** dropped — it holds
real historical customer enquiries. See
`supabase/migrations/20260826000100_retire_client_offer_requests.sql`.
