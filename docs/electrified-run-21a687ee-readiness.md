# Encar electric/hybrid run 21a687ee — source and publication audit

Run ID: `21a687ee-6717-4610-a9cc-97c64608bbb9`.

## Cohort reconciliation

| Stage | Listings |
| --- | ---: |
| Encar queue and staging, succeeded | 250 |
| Power-plan candidates | 244 |
| Source retry excluded at owner's request | 6 |
| Hybrid plan candidates | 160 |
| Electric plan candidates | 84 |

The existing approved-reference plan matched none of the 244. Its worklist contains 131 configurations.

## Preliminary calculation power

| Source | Hybrid | Electric | Total |
| --- | ---: | ---: | ---: |
| Drom explicit ICE + electric 30-minute values | 97 | 0 | 97 |
| EncarRus detail HAR, fee value with inferred component | 14 | 0 | 14 |
| EncarRus model/year card, 30-minute field selected by Encar grade | 0 | 73 | 73 |
| Total with a run-scoped calculation input | 111 | 73 | 184 |

The Grandeur HAR values are preliminary: 2023 has 180 PS ICE and a source-stated 207 PS recycling-fee value, and 2022 has 159 PS ICE and a source-stated 182 PS recycling-fee value. The inferred motor components are 27 and 23 PS. They are recorded as derived, not as a directly observed 30-minute field.

For the 73 electric listings, the calculation input is the EncarRus 30-minute value. Peak/display power remains separate. Some model/year groups have different outputs; the resolver uses the saved Encar grade and drive where available. It excludes a group when the resulting 30-minute value is still ambiguous.

The 184 candidates pass the publication contract and TKS calculation against saved Encar snapshots. All 184 prices are **preliminary**. The price calculation audit is `output/tl-auto-electrified-21a687ee-publication-readiness.json`; the immutable allowlist is `output/tl-auto-electrified-21a687ee-publication-manifest-v2.json` in the local checkout. Neither file is a publication event. The calculation's rate snapshot is dated 2026-09-26; rates must be refreshed immediately before a real publication.

## Reference writes

- 44 Drom configurations and 87 EncarRus listing-specific specifications were inserted into Supabase `vehicle_power_specs` as **draft** entries; all 131 have draft evidence. They do not make a catalogue-wide approved match.
- Drom draft data: `data/power/drom-hybrid-preliminary-v1.json`.
- Curated HAR extraction: `data/power/encarrus-hybrid-har-21a687ee.json`.
- Run-scoped mapping of the exact 184 Encar IDs to source and power: `data/power/electrified-21a687ee-power-reference.json`.
- Cars, prices, calculation snapshots and public catalogue rows were not changed by these imports.

## Remaining

| Reason | Listings |
| --- | ---: |
| Hybrid without a sourced ICE + 30-minute value | 49 |
| Electric without a usable EncarRus card | 4 |
| Electric source card exists but does not match the saved Encar grade | 5 |
| Electric grade still maps to multiple 30-minute values | 2 |
| Excluded `needs_source_retry` | 6 |
| **Total not in the prepared allowlist** | **66** |

Of the 49 hybrids, 20 have an EncarRus model card but no reliable 30-minute motor value in the current source set. This includes official/system or Carpoint values, which are display evidence only. The other 29 have no matching EncarRus card. No system or peak power was substituted for the TKS calculation field.

Before any actual publication, repeat a live availability/price check on the **184 prepared IDs only**, refresh rates, then use a publisher that reads this run-scoped power manifest. The existing generic `publish:encar:manifest` uses a combustion-engine preliminary reference path and is not suitable for this electrified manifest without changes.
