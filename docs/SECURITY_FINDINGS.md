# Security Findings

Recorded 2026-09-21 during the Mission 1 baseline audit. This is a register, not
a security review — it captures what the audit encountered. A deliberate
security review is separate work.

**Scope rule applied:** only low-risk, clearly safe, independent repository or
configuration issues were fixed. Anything potentially disruptive is recorded as
a tracked risk with a proposed fix and left alone.

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| 1 | Inter-Sprint gateway defaults to plain HTTP | High | TRACKED |
| 2 | Plain FTP endpoint open to the internet | High | TRACKED |
| 3 | Production Supabase anon key in `.env.local.example` | Low | ACCEPTED |
| 4 | `CRON_SECRET` undocumented | Low | **FIXED** |
| 5 | Duplicate / junk supplier records | Medium (data integrity) | OWNER_DECISION |
| 6 | Stale supplier observations | Medium (commercial) | TRACKED |
| 7 | Production/staging separation | Low | PARTLY ADDRESSED |

---

## 1. Inter-Sprint gateway defaults to plain HTTP — TRACKED

`DEFAULT_BASE_URLS` in `src/lib/suppliers/gateway/config.ts` uses `http://` for
both partners in both environments, as the supplier's manual documents.
Authentication is HTTP Basic (§1.4), so **the customer number, username and
password would cross the internet base64-encoded but unencrypted**, along with
every price and order.

Mitigating: the config exposes `insecureTransport` so the condition is visible
rather than silent, `INTERSPRINT_GATEWAY_BASE_URL` can override to HTTPS, and no
credentials exist in any environment yet — nothing has ever been transmitted.

**Proposed fix (needs supplier input):** ask Inter-Sprint whether the gateway is
reachable over HTTPS and override the base URL if so. If it is not, that is a
risk to accept consciously before the first live call, not on the day
credentials arrive. **Do not enable live ordering over plain HTTP without an
explicit decision.**

## 2. Plain FTP endpoint open to the internet — TRACKED

`infra/ftp/` provisions a plain-FTP drop point (Hetzner `62.238.60.247`, port 21,
passive 40000–40020, user `intersprint`). FTP has no transport security: the
password and every file cross the internet in clear text.

The provisioning script is honest about this and already implements the
containment that is available — no anonymous access, no shell, chroot, single
user, narrow passive range, restrictive firewall. **None of that stops the
credentials being captured in transit.**

**Proposed fix, in order of preference:**
1. Ask whether Inter-Sprint supports **FTPS or SFTP**. Either removes the
   problem outright and costs one email.
2. Failing that, obtain their egress addresses and re-run with
   `INTERSPRINT_ALLOWED_IPS=…` so port 21 is not open to the world.

Until one of those happens, the endpoint is exposed to the entire internet with
a cleartext password. Server-side work is outside this repository and was not
performed.

## 3. Production Supabase anon key in `.env.local.example` — ACCEPTED

The example file contains a real anon JWT for the production project
`sfvaqextratpnprcamwd`.

**Not a leak.** The anon key is designed to be public — it is shipped to every
browser — and it grants only what Row Level Security grants, which for the
logistics tables is nothing: RLS is enabled with no policies, and all real access
goes through the server-side service-role key.

Two genuine weaknesses remain: it points local development at the **production**
project by default, and it makes the production project ref public. Rotating it
would be disruptive for no security gain.

**Recommendation:** when staging is rebuilt, point the example at staging
instead, so a fresh checkout cannot default to production. Low priority.

`SUPABASE_SERVICE_ROLE_KEY` is correctly blank, correctly warned about, and
`.env` / `.env.local` are gitignored. **No real secret is committed anywhere in
history.**

## 4. `CRON_SECRET` undocumented — FIXED

`/api/cron/document-analysis` mutates data and calls a paid AI provider. It
correctly **fails closed** — unset secret means every request is refused — but
the variable appeared in no example or documentation, so a deployment could
silently never run the worker, or an operator could "fix" it by weakening the
check.

Added to `.env.local.example` with the reasoning, alongside
`INTERSPRINT_LIVE_PROBE`. Documentation only; no behaviour changed.

## 5. Duplicate / junk supplier records — OWNER_DECISION

Production holds 16 suppliers including `asdas` (`vat_number = "ads"`), `Name`,
`Furnizor Demo (test)`, and four spellings of ZUIN, two of FINTYRE, two of
CARLINI.

This is a data-integrity problem before it is a security one: sourcing, pricing
and accounting that group by supplier will produce wrong totals, and the entire
9,559-row catalogue currently hangs off the junk record.

Evidence and dependencies: [`DATABASE_BASELINE.md`](DATABASE_BASELINE.md) §6.
**No record was renamed, merged or deleted.**

## 6. Stale supplier observations — TRACKED

The only commercial observations in production are from **2026-09-08** and carry
no price or stock at all. There is currently no freshness control, because there
is nothing yet that consumes observations.

**The risk is prospective and must be closed before the first customer-facing
price:** presenting a stale or absent observation as live availability produces
wrong stock and wrong prices — an explicit stop condition in `CLAUDE.md`. A
freshness gate belongs in the same change as the first customer-facing price,
never later.

## 7. Production/staging separation — PARTLY ADDRESSED

`.mcp.json` registers **staging only**, deliberately leaving production as an
account-level connector so that nothing in the repository points an agent at the
live warehouse database by default. The URL carries a project ref and feature
flags — no secret — and authentication is OAuth.

Remaining gap: `.env.local.example` still defaults local development to the
production project (finding 3), and there is no automated guard preventing a
migration being pushed to production. The reconciliation plan
([`DATABASE_BASELINE.md`](DATABASE_BASELINE.md) §4) addresses the second.
