# Encar electrified run `c012d314`

Run ID: `c012d314-d718-48b0-97d9-857f7a96af1e`.

## Frozen cohort and power basis

- 100 Encar listings: 50 parallel hybrids and 50 battery electric vehicles.
- All 100 have a listing-scoped preliminary power proposal; unresolved: 0.
- The hybrid calculation uses combustion-engine power plus the matching 30-minute electric rating. Peak electric-motor power is preserved separately and is not added to customs power.
- EV calculations use the 30-minute power only. Encar's electric motor displacement is not written as combustion-engine displacement in `cars.engine_cc`.
- Preliminary values are saved as draft evidence/specifications without global resolver matches. Published cards retain `power_finality=provisional`.
- Saved Encar snapshots are the source for card photos, options, history, price, mileage, and configuration. Standard option definitions are fetched through the required Encar proxy during publication.
- Price anomalies are checked against active catalog analogs. A missing analog group is informational and does not hide the listing.

## Run artifacts

- Research decisions: `data/power/c012d314-d718-48b0-97d9-857f7a96af1e-electrified-power-research.json`
- Hybrid 30-minute review: `data/power/c012d314-d718-48b0-97d9-857f7a96af1e-hybrid-30min-source-audit.json`
- Run-scoped preparation, draft import, and publisher: `scripts/prepare-c012-electrified-publication.ts`, `scripts/import-c012-electrified-preliminary-power.ts`, and `scripts/publish-c012-electrified-cohort.ts`.

The preparation script reads the approved run's saved Encar staging rows and current TKS rates. The importer writes only draft evidence and listing-specific draft specs. The publisher writes cards, source snapshots, photos, options, condition history, and calculation snapshots in verified batches; it requires `ENCAR_PROXY_REQUIRED=true` and a configured proxy for Encar's standard option catalog.
