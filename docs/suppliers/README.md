# Supplier reference material

One directory per lane, recording what we know about each supplier and, just as
importantly, **how we know it**.

## Provenance labels

| Label | Meaning |
| --- | --- |
| `PRIMARY` | Verified directly in the supplier's own artefact — their API documentation or their data file. Top authority, alongside proven production facts. |
| `SECOND-HAND` | Relayed through correspondence but **not** verified against a primary artefact. |
| `UNCONFIRMED` | An open question, or an assumption awaiting supplier confirmation. |

Two rules govern how these are used.

**A relayed field list is not a file format.** Knowing a column is called `Price`
tells you nothing about its type, decimal separator, encoding or nullability.
A parser must never be written from a `SECOND-HAND` field list.

**But a fact verified from a primary artefact does not become `SECOND-HAND`
again just because a later session did not happen to open the file.** Provenance
is a property of how the fact was established, not of who currently remembers
establishing it. Downgrading verified facts on those grounds destroys real work
and invites rebuilding something that already exists and functions.

Where a primary artefact is not committed to the repository, the fact stays
`PRIMARY` and the entry records which artefact it came from, so a future reader
can re-verify it against the same source.

**Never commit credentials.** FTP hosts, usernames, passwords and API tokens do
not belong in this repository. Record only that a credential exists and where it
is held.

## Lanes

| Lane | Directory | Commercial data today |
| --- | --- | --- |
| Deldo | [`deldo/`](deldo/README.md) | Sample CSV inspected; persistence gated, no live feed |
| Inter-Sprint | [`intersprint/`](intersprint/README.md) | Price and stock feed format verified; built the current 9,559-listing catalogue |
