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
   `supabase/migrations/20260826000000_quote_requests.sql`.
3. Press **Run**.

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
       ) then 'OK' else 'NOT ENABLED' end;
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

---

## Step 4 — End-to-end check

1. Open the site. It should be in **Italian** with no language cookie set.
2. Open the hamburger → switch to **English** → reload → it stays English.
   Switch back to Italian.
3. Click **Richiedi un'offerta**.
4. Add a tyre: `205 / 55 / R16`, index `91V`, quantity `4`, *Miglior prezzo*,
   *24 ore* → **Aggiungi**.
5. Add another: `225 / 45 / R17`, quantity `2`, *Marca specifica* → `Michelin`,
   *7 giorni*.
6. Add **Altro prodotto**: `Valvole TR414`, quantity `20`, *7 giorni*.
7. Fill company + e-mail, optionally a WhatsApp number.
8. **Richiedi l'offerta** → you should land on **Richiesta inviata!** with a
   request number like `GR-1000`.
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
| Request saved, **Email KO** badge in admin | Resend key missing/invalid, or unverified domain | Steps 2–3 |
| **Apri richiesta** in the e-mail points at a Vercel preview URL | `NEXT_PUBLIC_APP_URL` unset | Step 2 |
| Site loads in English first | A `gr_locale` cookie is already set in that browser | Expected — clear cookies to see a first-time visitor's view |
| Excel totals show `0` | Prices not entered yet | Expected — the column is intentionally empty for the operator |

---

## Note on the older `/get-offer` flow

This is a **second, separate** customer quote path. `/get-offer` and its
`client_offer_requests` table are untouched and still work.

They were kept separate because the older table stores tyres as a JSONB blob
with one delivery preference for the whole request — it cannot express
non-tyre products, a delivery requirement per item, or a per-item brand
preference. Widening it would have broken its live rows.

Two public quote paths is a product decision worth making deliberately: either
retire `/get-offer`, or keep both intentionally. Nothing in the code forces
either choice.
