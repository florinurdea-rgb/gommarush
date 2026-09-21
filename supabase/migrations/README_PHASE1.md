# Phase 1 migrations — supplier foundation

Applied to STAGING (`ltdwabkitplicyiwucsp`) only. **Production is untouched.**

Filenames match the staging ledger versions exactly, per the procedure in
`docs/SCHEMA_BASELINE.md` §6 step 3.

| Version | Name |
| --- | --- |
| `20260921105719` | `supplier_foundation_01_lanes_capabilities` |
| `20260921105821` | `supplier_foundation_02_observation_model` |
| `20260921110005` | `supplier_foundation_03_seed_lanes` |

See `docs/SUPPLIER_INTEGRATION.md` for what each establishes and why.
