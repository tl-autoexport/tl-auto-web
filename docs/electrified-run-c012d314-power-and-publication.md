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
- Publication result: `data/power/c012d314-d718-48b0-97d9-857f7a96af1e-publication-report.json`.

The preparation script reads the approved run's saved Encar staging rows and current TKS rates. The importer writes only draft evidence and listing-specific draft specs. The publisher writes cards, source snapshots, photos, options, condition history, and calculation snapshots in verified batches; it requires `ENCAR_PROXY_REQUIRED=true` and a configured proxy for Encar's standard option catalog.

## Completed publication

- All 100 listings were published and verified active in the database: 50 hybrids and 50 electric vehicles. All 100 have a positive preliminary calculation power and price; no listing from the cohort was previously published.
- The power reference contains 100 draft specifications and 100 linked source evidence rows. These are listing-scoped preliminary entries; they do not create global resolver matches or approved rules.
- EV `engine_cc` is null for all 50 electric vehicles. Hybrid cards use `parallel_sum`; EV cards use `electric_30min`. Both groups have `power_finality=provisional`.
- The publication saved 2,939 source photos, 5,615 option rows (3,977 installed, 1,638 absent, 0 unknown), and 98 insurance/history reports. No card has every option marked installed.
- All 100 calculations use TKS version `ru-individual-autoexport-tks-client-total-2026.05`, with rates dated 2026-10-17. The published preliminary price total was 509,067,908 RUB. Price-anomaly checks found no blocking outlier; missing analogs do not hide listings.
- Publication ran through the VPS Encar proxy and completed in four committed batches of 25. The final report records 100 database writes and 100 newly published cards.
