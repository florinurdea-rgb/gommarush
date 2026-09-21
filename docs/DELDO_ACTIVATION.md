# Deldo Activation Checklist

For the owner. Everything below needs a person: credentials, an external
email, or a business answer. **Nothing here has been done automatically, and
no message has been sent to Deldo.**

Contact: **Jan Van Dyck**, Deldo NV — `Jan@deldo.com`
GoRush customer number: **026933**

Once these land, the integration needs configuration rather than development —
the code is written and tested.

---

## 1. Send Deldo the questions

Eight items, all answerable in one reply. The first three block the use of any
Deldo price; the rest unblock the live lookup, the feed and the catalogue.

### Blocking — commercial

1. **What does the `Discount` column mean?**
   In `26933TEST.csv` its values range from **-407.69 to +63.23**. A percentage
   discount cannot be negative, so we cannot infer it.

2. **Does `Price` already incorporate `Discount`, or must we apply it?**
   We currently treat `Price` as the purchase price exactly as supplied and
   never apply `Discount`. If that is wrong, every Deldo cost is wrong.

3. **Which pricing mode does GoRush receive, and in what currency?**
   Your documentation describes two: (a) pure tyre prices with transport
   invoiced separately, per-parcel per country; (b) transport included for a
   specified destination country. Neither the file nor the API states which
   applies to us, and there is no currency column anywhere.

### Blocking — technical

4. **Please issue a test-environment API token** for GET_STOCK.
   *(Your documentation: "Authentication for testing environment: please send
   an e-mail to Jan@deldo.com to request your Token".)*

5. **Which request parameter is correct for GET_STOCK?**
   The documentation's "URL Parameters" section lists
   `productId=[integer|string] OR ean=[string]`, but both worked examples use
   `article=`. We have implemented `article=` and would like it confirmed.

### For the feed

6. **Do you support FTPS or SFTP?**
   Our existing endpoint is plain FTP, which carries the password and every
   file in clear text. Either alternative removes that problem outright.

7. **Please confirm the delivery details** once the account exists: target
   directory, filename convention, and whether each file is a complete
   snapshot or a delta. *(We currently assume a complete hourly snapshot; the
   importer deactivates nothing on a partial file, so a wrong assumption is
   safe but leaves stale listings.)*

### For the catalogue

8. **What does the `Demo` column mean?**
   Some rows carry `DEMO`; most are empty. We need to know what the stock
   actually is before it can be offered — whether it is ex-display, a
   manufacturer sample, a customer return, or something else — and whether it
   carries the normal warranty. We will not guess, so Demo stock stays out of
   any customer-facing offer until you confirm.

   *(We do not need to ask about DOT: the feed already supplies the year in
   the `Dot` column, and we preserve it exactly as given.)*

> **Do not send them the sample file back, and do not share credentials by
> email in the same message as the FTP address.**

---

## 2. Provision the FTP account for Deldo

Deldo **pushes** to our server — we do not pull from theirs.

- [ ] Create a dedicated `deldo` FTP user on the existing endpoint
      (`infra/ftp/`). **Do not build a second FTP server**; the Inter-Sprint
      one is already provisioned and the script is idempotent.
- [ ] Give Deldo their **own** drop directory, separate from Inter-Sprint's
      `/incoming`. Two suppliers writing to one directory makes provenance a
      guess.
- [ ] Ask Deldo for their **egress IP addresses** and restrict the firewall to
      them:
      `INTERSPRINT_ALLOWED_IPS="…" bash infra/ftp/provision-intersprint-ftp.sh`
      *(the variable name is historical; it controls the whole endpoint.)*
- [ ] Record the credentials in the password manager. **Never in git.**
- [ ] Send Deldo the FTP address, login and password — ideally after (6) is
      answered, in case FTPS or SFTP changes the setup.

Security context: [`SECURITY_FINDINGS.md`](SECURITY_FINDINGS.md) finding 2.

---

## 3. Configure the API token

Once the token arrives:

- [ ] Set `DELDO_API_TOKEN` in Vercel (Production, Preview, Development).
- [ ] Leave `DELDO_API_ENVIRONMENT=test`. It already defaults to `test`, and
      anything unrecognised resolves to `test`.
- [ ] Leave `DELDO_API_BASE_URL` **empty** — the documented test URL is built
      in. It becomes required only for `live`, which Deldo supplies after the
      testing procedure.
- [ ] Never commit the token. `.env.local` is gitignored.

Then verify without writing anything:

```bash
DELDO_API_TOKEN=… npx vitest run tests/deldo-get-stock.test.ts
```

That exercises the real client against mocked responses. **The first genuine
call to Deldo should be a deliberate manual step, not a test run.**

---

## 4. What happens after the answers arrive

Roughly in order, and none of it is blocked on Deldo once the above is done:

1. Record the `Discount` and pricing-mode answers in
   [`architecture/02_SUPPLIER_RULES.md`](architecture/02_SUPPLIER_RULES.md)
   and close handoff decisions **D7** and **D8**.
2. Set the real `commercialMode` on Deldo imports. Until then every Deldo
   observation is deliberately **not** commercially usable, even when the data
   is real.
3. Complete the schema reconciliation
   ([`DATABASE_BASELINE.md`](DATABASE_BASELINE.md) §4). This gates persistence.
4. Apply the classification migration (§7) and enable the persistence
   boundary in `src/lib/suppliers/deldo/feed/import.ts`.
5. Wire the FTP drop to the importer.

---

## 5. What must NOT happen yet

- **No CREATE_ORDER.** Deldo's rollout requires example XML validated by them,
  then test-environment ordering, then an explicit green light with a live URL,
  token and customer number, then an email after the first live order. Nothing
  in the codebase can place a Deldo order, and a test asserts it stays that way.
- **No live pricing from test data.** `26933TEST.csv` contains fictional
  stocks and prices. The importer refuses to load it as live data, and the test
  API endpoint's answers are recorded as test regardless of how real they look.
- **No production or staging migration** until the reconciliation gate opens.
- **No customer-facing price** — there is no markup, PFU or VAT engine, and
  building one is a separate approved mission.
