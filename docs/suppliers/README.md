# Supplier reference material

Primary supplier documentation lives here, one directory per lane.

**Authority.** Under the precedence rule in [`../../CLAUDE.md`](../../CLAUDE.md) §0,
*verified supplier documentation* sits at the top, alongside proven production
facts. That status belongs to the supplier's own material: their integration
manual, their API specification, their file-format description, their sample
files. It does not extend to our paraphrase of it.

Everything in these directories is therefore labelled with its provenance:

| Label | Meaning |
| --- | --- |
| `PRIMARY` | The supplier's own document or file, committed verbatim. Top authority. |
| `SECOND-HAND` | Facts relayed through our own correspondence rather than read from the supplier's document. Useful, but **must be confirmed against `PRIMARY` before code depends on it.** |
| `UNCONFIRMED` | Asked but not yet answered. |

A parser must never be written against a `SECOND-HAND` field list alone. A
relayed field name tells you a column exists; it does not tell you its type,
its decimal separator, its encoding, or whether it may be empty. Guessing those
silently mis-maps real commercial data.

## How to add supplier documentation

Drop the supplier's files into the lane directory, keeping the original
filename, and record them in that lane's `README.md` with the date received and
who supplied them. Commit binary manuals as-is; they are reference material, not
build inputs.

**Never commit credentials.** FTP hosts, usernames, passwords, API tokens and
account secrets do not belong in this repository under any circumstances. Record
only that a credential exists and where it is held.
