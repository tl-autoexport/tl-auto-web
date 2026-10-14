# Power research ledger — Encar run c4ea187a

Run ID: `c4ea187a-437f-42e2-aef0-71bf9a65d6c7`

This ledger tracks the current run only. The completed run `05fc8baf-5348-4e9f-b2e4-0db7c60e1b27` is a procedure reference; none of its counts or publication state are carried into this run.

## Baseline

| Stage | Listings | Configurations | State |
|---|---:|---:|---|
| Encar enrichment succeeded | 499 | — | Complete |
| Encar unavailable | 1 | — | Excluded from power search |
| Matched to approved TL Auto power reference | 152 | — | Read-only match; no run-specific writes |
| Remaining after approved-reference match | 347 | 295 | Source research target |

## EncarRus Meili AJAX catalogue

Report: `output/tl-auto-run-c4ea187a-437f-42e2-aef0-71bf9a65d6c7-encarrus-ice.json`

| Classification | Listings | Configurations | Treatment |
|---|---:|---:|---|
| Preliminary candidate | 92 | 84 | Candidate only; not approved or written |
| Review match or power | 26 | 22 | Requires comparison/review |
| No matching card | 229 | 189 | Continue research with other sources |
| **Total processed** | **347** | **295** | Complete |

Additional source status: 266 configurations mapped to EncarRus's model index, 29 unmapped; 234 model-year tasks and 1,047 AJAX requests; zero source errors; no protection stop. `mappedConfigurations` is an index-mapping count, not a count of power matches.

Writes/publication: zero database writes; zero publications. These findings remain research candidates.

## Danawa

Dedicated query `tl-auto-danawa-power-c4ea187a` completed on VPS at `2026-10-13T13:24:04`.

Report: `output/tl-auto-run-c4ea187a-437f-42e2-aef0-71bf9a65d6c7-danawa-power.json`

| Classification | Listings | Configurations | Treatment |
|---|---:|---:|---|
| Preliminary candidate | 76 | 63 | Candidate only; not approved or written |
| Review multiple powers | 52 | 40 | Requires comparison/review |
| Unmapped model | 23 | 22 | No usable model mapping yet |
| No compatible year or lineup | 148 | 128 | No compatible specification found |
| No matching specification | 48 | 42 | No matching specification found |
| **Total processed** | **347** | **295** | Complete |

Source status: 1,486 requests/attempts, zero errors; year window ±1 and engine displacement tolerance 120 cc. Read-only; zero database writes and no public catalog changes. Do not rerun EncarRus Meili or Danawa after their reports are collected.

## Current source totals after EncarRus, Danawa, and Korex

EncarRus and Danawa each evaluated the same 347 target listings / 295 configurations. Their per-source result counts overlap and must not be added to produce unique vehicles.

The read-only reconciliation is saved at `output/tl-auto-run-c4ea187a-437f-42e2-aef0-71bf9a65d6c7-source-reconciliation.json`:

| Combined outcome | Listings | Configurations |
|---|---:|---:|
| Candidate/review data from both sources | 45 | 41 |
| Danawa only | 83 | 62 |
| EncarRus only | 73 | 65 |
| Neither source produced a power candidate/review | 146 | 127 |
| **Unique listings/configurations checked** | **347** | **295** |

Unique listings with candidate/review data from at least one of EncarRus or Danawa: **201** (`45 + 83 + 73`), across **168 configurations** (`41 + 62 + 65`). The 201 are still unapproved research findings; the reconciliation does not determine whether the two sources agree on each power value.

### Korex Auto — only the EncarRus/Danawa `neither` subset

Report: `output/tl-auto-run-c4ea187a-437f-42e2-aef0-71bf9a65d6c7-korex.json`
Target ID list: `output/tl-auto-run-c4ea187a-437f-42e2-aef0-71bf9a65d6c7-korex-target.json`
Checkpoint: `output/tl-auto-run-c4ea187a-437f-42e2-aef0-71bf9a65d6c7-korex-checkpoint.json`

The input contained exactly **146 unique listing IDs / 127 configurations**, and the completed report represents all 146 IDs exactly once. Korex covered 68 brand/model routes: 38 route snapshots reused from the earlier local Korex research run (snapshot dated 2026-10-10) and 30 routes fetched on 2026-10-14. No EncarRus or Danawa search was repeated; no database writes or publication changes were made.

| Korex outcome | Listings | Configurations | Treatment |
|---|---:|---:|---|
| Preliminary candidate | 25 | 24 | Candidate only; not approved or written |
| Review: fuel not verified from Korex card | 88 | 72 | Requires source/configuration review |
| Review: multiple powers | 10 | 9 | Requires choosing the right power |
| Review: drive not verified | 5 | 4 | Requires drivetrain confirmation |
| No candidate | 18 | 18 | Continue research if useful |
| **Total** | **146** | **127** | Complete for this target set |

Korex returned candidate or review data for **128 listings / 109 configurations**. Adding this disjoint subset to the earlier EncarRus+Danawa union gives **329 of 347 listings / 277 of 295 configurations** with at least one candidate/review outcome across these three sources. The remaining **18 listings / 18 configurations** had no candidate in these three source passes. These totals describe source-search coverage, not approved reference rows.

Korex is a public inventory source, not an official manufacturer specification source. The 24 preliminary configurations have one distinct power among matched cards and matching year, displacement, and parsed fuel; trim/generation still needs review before approval. In 38 configurations / 43 listings, the search reused a saved 2026-10-10 snapshot rather than fetching a fresh listing on 2026-10-14. Five Chevrolet routes returned 404 for the tested route aliases, so their no-candidate results do not prove Korex has no matching data. The short Mercedes-Benz GLC route also returned 404, but the GLC-Class route succeeded. Do not treat these route errors as candidate matches or confirmed source absence.

## Independent research for the remaining 18

Research report: `docs/power-independent-18-c4ea187a-437f-42e2-aef0-71bf9a65d6c7.md`.

The exact 18 null-disposition Korex results were individually matched against Korean-market manufacturer specifications, manufacturer announcements, or established public specification sources. Proposed values are in PS and remain **research recommendations only**; no source search was repeated, and nothing was written to the power reference or catalog.

| Listing | Vehicle / configuration | Proposed PS | Evidence / confidence |
|---|---|---:|---|
| 41435682 | Kia K7, 2013, 3.0 GDI, 2999 cc | 270 | Exact trim/year open Korean spec; preliminary |
| 41487503 | Chevrolet Orlando, 2015, 2.0 diesel, 1998 cc | 163 | GM Korea source; high |
| 42853922 | Chevrolet Orlando, 2014, 2.0 LPGi, 1998 cc | 140 | GM Korea source; high |
| 42859266 | Chevrolet Orlando, 2012, 2.0 diesel, 1998 cc | 163 | GM Korea source; high |
| 42456618 | BMW 6 Series GT G32, 2022, 640i xDrive, 2998 cc | 340 | BMW Korea domestic specification; high |
| 42893543 | BMW 6 Series GT G32, 2020, 630i xDrive, 2998 cc | 258 | BMW Korea domestic specification; high |
| 41756464 | Chevrolet Malibu, 2016, 1.5 Turbo, 1490 cc | 166 | Korean launch specification; high |
| 42851998 | Chevrolet Malibu, 2013, 2.0 gasoline, 1998 cc | 141 | Korean public specification; high |
| 41836832 | Chevrolet Spark, 2013, 995 cc, LT | 70 | Exact Korean lineup specification; high |
| 42887731 | Chevrolet The Next Spark, 2016, 999 cc, LTZ | 75 | Korean launch specification; high |
| 42507479 | Genesis G80 DH, 2019, 3.8 GDI, 3778 cc | 315 | Genesis manufacturer spec plus 2019 lineup; high |
| 42872274 | Genesis G80 DH, 2020, 3.8 GDI AWD, 3778 cc | 315 | Genesis manufacturer spec and AWD lineup; high |
| 42857847 | Hyundai The New Maxcruz, 2015, 2.2 diesel 2WD, 2199 cc | 202 | 2015 Euro 6 model specification; high |
| 42875433 | Hyundai Maxcruz, 2014, 2.2 e-VGT 4WD, 2199 cc | 200 | Hyundai heritage specification; high |
| 42874125 | Bentley Continental GT II, 2012, 4.0 V8, 3993 cc | 507 | Bentley 2012 technical specification; high |
| 42875852 | Chevrolet The New Aveo Sedan, 2017, 1.4 Turbo, 1362 cc | 140 | Korean-market manufacturer announcement; high |
| 42843007 | Chevrolet Cruze, 2014, 1.8 gasoline, 1796 cc | 142 | GM Korea technical comparison; high |
| 41097120 | MINI Cooper 5 door, 2016, 1499 cc, High | 136 | BMW Korea 2016 model spec; high |
| **Total newly researched** | **18 unique listings / 18 configurations** | — | **All await review/approval; no writes** |

This fills the prior no-candidate gap with 18 source-backed power recommendations: broad research now has recommendations for **347/347 target listings / 295/295 configurations**. The earlier three-source status remains **329/347 / 277/295**; the 18 are not retroactively counted as EncarRus, Danawa, or Korex findings. These are not approved-reference counts. One source-quality caveat: K7 is supported by an exact Korean public technical listing rather than a manufacturer source; it is still only a preliminary recommendation.

## Source-search disposition before manual review batches — unique listing IDs

The VPS reconciliation file's `byListing` array contains **347 rows and 347 unique IDs**. Its broad split is 45 with evidence from both EncarRus and Danawa, 83 Danawa-only, 73 EncarRus-only, and 146 with neither. Classifying each row by the sources' detailed `classification` and power arrays gives:

| EncarRus/Danawa result | Listings | Rule |
|---|---:|---|
| Both sources agree on one preliminary power | 16 | Both are `preliminary_candidate`, same single power |
| EncarRus preliminary only | 56 | EncarRus has one preliminary power; Danawa has none |
| Danawa preliminary only | 49 | Danawa has one preliminary power; EncarRus has none |
| Needs review | 80 | Source powers exist, but the preliminary conditions above are not met |
| Neither source has a candidate | 146 | These exact IDs formed the Korex target set |
| **Unique EncarRus/Danawa IDs** | **347** | No duplicate IDs |

Therefore EncarRus/Danawa produced **121 unique preliminary candidates** (`16 + 56 + 49`), **80 review cases**, and the disjoint **146-ID** Korex subset. Korex classified that subset as 25 preliminary, 103 review, and 18 with no candidate. Independent research then proposed values for those final 18 (17 high-confidence and one open-source K7 recommendation).

| Full-run bucket | Listings | Meaning |
|---|---:|---|
| Existing approved-reference matches | 152 | Read-only matches already present in the reference resolver |
| Preliminary candidates/proposals | 164 | 121 EncarRus/Danawa + 25 Korex + 18 independent proposals |
| Still requires review | 183 | 80 EncarRus/Danawa + 103 Korex |
| Enrichment unavailable | 1 | No power could be assessed |
| **Total run** | **500** | **499 successfully enriched** |

The earlier aggregate that reported 90 EncarRus/Danawa preliminary listings came from a different/incompatible reconciliation shape and does not match the current per-ID `byListing` data. Use the **121** count above for this ledger; do not add raw source totals of 92 and 76.

Power-reference writes for these 164 current-run candidates/proposals: **0**. They are not yet in the reference database. No public catalog changes were made in this research pass. The 183 review cases still have source power evidence, but do not count as a selected preliminary value.

## Next steps

1. Review the 183 remaining cases (80 EncarRus/Danawa and 103 Korex); do not repeat completed source searches.
2. Review the 164 preliminary candidates/proposals, including the 18 independent recommendations. Do not apply them automatically.
3. Apply only values the user approves to the power reference, then recalculate and audit readiness. Publication is a separate step.

## Korex method recovered from the completed run `05fc8baf`

The prior Korex search ran locally on the Mac with a one-off Node.js parser, directly against public `korex-auto.com` inventory pages. It did not use the VPS or a proxy and did not write to Supabase. The parser fetched up to 15 pages for each brand/model route, waited 900 ms between pages, used a 25-second request timeout and up to three attempts, then parsed the public HTML inventory cards. It extracted model year, engine displacement, fuel, modification/grade, and displayed power in PS from the card fields and `data-calc` attributes. Exact engine/fuel and exact-year matches were preliminary candidates; a +/-1-year-only match or multiple powers went to review. The old code parsed drive data but did not enforce a drive match in its candidate filter, so drive must be called unverified unless the current record confirms it.

The old run covered 234 listings / 204 configurations across 84 brand/model routes: 38 listings / 35 configurations were preliminary candidates, 15 / 10 needed review, and 181 / 159 had no candidate. Its checkpoint is retained locally at `output/tl-auto-run-05fc8baf-korex-checkpoint.json`; those counts belong only to the old run.

For the current run, the approved-reference resolver was re-applied read-only to the current Supabase staging data and matched the known plan totals exactly: 152 approved matches and 347 unmatched listings / 295 configurations. Those 347 were grouped into a local Korex worklist. The exact 146-ID `neither` subset supplied from VPS reconciliation was saved locally and used for the Korex pass; do not rerun EncarRus or Danawa for these IDs.

## Review batch 1 of 8 — 10 EncarRus/Danawa listings

Decisions saved in `output/tl-auto-run-c4ea187a-437f-42e2-aef0-71bf9a65d6c7-review-80-decisions-part-01.json`.

- Four 520i G30 listings: 184 PS, manufacturer engine specification verified.
- Four 530i G30 listings: 252 PS, manufacturer engine specification verified.
- Two 740i xDrive G70 listings: 381 PS. The initial xDrive release labels it combined output; BMW Korea's G70 740i sDrive engine table separately lists the same 2,998 cc engine at 381 PS. The xDrive-specific release confirms that rating, and this is distinct from the 750e PHEV. Cross-checked and finalized as a preliminary engine-power value in batch 4.
- Database writes: zero. These are research decisions, not imported reference rows.

## Review batch 2 of 8 — 10 EncarRus/Danawa listings

Decisions saved in `output/tl-auto-run-c4ea187a-437f-42e2-aef0-71bf9a65d6c7-review-80-decisions-part-02.json`.

- Two 2026 Genesis GV80 2.5T AWD listings: 304 PS, confirmed by Genesis Korea.
- Two 2016 Hyundai Avante AD 1.6 e-VGT diesel listings: 136 PS; 134 PS belongs to a later revised tune.
- Avante AD 1.6 GDI Value Plus: 132 PS; separate Avante Sport 1.6 T-GDI: 204 PS.
- Two 2024 KGM Tivoli 1.6 gasoline, 1597 cc: 126 PS. The 163 PS option is the distinct 1.5T, 1497 cc engine.
- Two 2016 Kia Morning naturally aspirated 1.0 listings: 78 PS. The 2016 Korean catalog distinguishes the 106 PS turbo; neither listing is a turbo trim.
- All 10 values are manufacturer-supported engine power. Database writes: zero.
- In the EncarRus/Danawa review subset of 80, cumulative progress is 18 engine-power decisions, 2 provisional hybrid-system figures awaiting engine-output basis, and 60 not yet reviewed. The separate Korex review subset of 103 has not been reviewed in these batches. Whole-run unresolved total is therefore 165 (2 + 60 + 103); 18 of the original 183 now have a selected engine-power value.

## Review batch 3 of 8 — 10 EncarRus/Danawa listings

Decisions saved in `output/tl-auto-run-c4ea187a-437f-42e2-aef0-71bf9a65d6c7-review-80-decisions-part-03.json`.

- Discovery 3.0 TD6, two listings: 258 PS; the 306 PS alternative is another engine variant.
- E200 W213 2.0 gasoline, two listings: 184 PS.
- GLC300 X254 2.0 gasoline 4MATIC, two listings: 258 PS engine output; mild-hybrid assist is separate.
- Audi A3 40 TFSI: 204 PS; A5 B10 40 TFSI quattro: 204 PS.
- BMW 430i F32: 252 PS; BMW 420i G26 Gran Coupe: 184 PS.
- All 10 are saved as preliminary candidates with source URLs. Database writes: zero.
- At the close of batch 3, 28 values were selected, 2 BMW 740i values still needed engine-vs-system basis confirmation, and 50 EncarRus/Danawa plus 103 Korex cases were untouched. Unresolved count at that point was 155. Batch 4 below resolved both pending BMW cases.

## Review batch 4 of 8 — 10 EncarRus/Danawa listings

Decisions saved in `output/tl-auto-run-c4ea187a-437f-42e2-aef0-71bf9a65d6c7-review-80-decisions-part-04.json`.

- BMW 740i xDrive G70 listing 42883822: 381 PS. BMW Korea's G70 740i sDrive engine table lists 381 PS for the same 2,998 cc gasoline engine; the xDrive Korea release gives the same 381 PS rating. This also resolves the two earlier 740i engine-power-basis questions (42157116 and 42497363) at 381 PS; 750e's 489 PS is a separate plug-in hybrid.
- BMW X5 xDrive30d G05 2020: 265 PS, matching BMW Korea's domestic 2019 G05 xDrive30d M Sport specification for 2,993 cc. 286 PS refers to a later/other-market engine revision.
- BMW X5 xDrive40i 2024: 381 PS (280 kW engine); BMW X6 M60i: 530 PS; BMW X6 xDrive30d 2023: 286 PS engine output, excluding its 48V system's separate assist.
- Ford Ranger Raptor 2.0 Bi-Turbo diesel: 213 PS. Honda Accord 10th-gen 2.0 Turbo: 256 PS in Honda Korea's PS rating. Hyundai Grandeur 2.4 GDi (2016, 2017, 2018): 190 PS.
- All 10 listings now have a selected preliminary engine-power value; database writes: zero.
- Accounting by unique listings: 40 of the original 183 review listings now have a selected power; 40 EncarRus/Danawa cases remain unreviewed and 103 separate Korex cases remain under review. **Total unresolved: 143** (`40 + 103`). The two earlier BMW 740i cases are included among the 40 selected, not counted again. Next review is part 5/8, the next 10 of the 40 untouched EncarRus/Danawa cases.

## Latest run-wide count after batch 4

All numbers are unique listings and reconcile to the 500-item run:

| State | Listings |
|---|---:|
| Matched to already approved power reference | 152 |
| Earlier EncarRus/Danawa, Korex, and independent research proposals | 164 |
| Selected preliminary powers during review parts 1–4 | 40 |
| Still unresolved: untouched EncarRus/Danawa 40 + Korex review 103 | 143 |
| Enrichment unavailable | 1 |
| **Total** | **500** |

The 204 preliminary values/proposals (`164 + 40`) are research decisions only; run-specific database writes remain zero. The 40 reviewed IDs are unique across parts 1–4. The two previously pending 740i records are now included in those 40 and are not added as extra listings.

## Review batch 5 of 8 — 30 EncarRus/Danawa listings (positions 41–70)

Decisions saved in `output/tl-auto-run-c4ea187a-437f-42e2-aef0-71bf9a65d6c7-review-80-decisions-part-05.json`. The 30 IDs are distinct from parts 1–4. No EncarRus, Danawa, or Korex search was rerun; no database writes were made.

| Group | Listings | Selected engine power |
|---|---:|---|
| Hyundai Kona, Sonata, Starex, Veloster | 10 | 149, 146, 151, 151, 163, 146, 175, 175, 250, 204 PS |
| Jeep Cherokee | 1 | 177 PS |
| KGM Rexton / Rexton Sports Khan | 4 | 202, 187, 187, 187 PS |
| Kia Carnival, K3, K7, Morning, Ray, Sportage, Stinger | 12 | 202, 123, 132, 132, 190, 76, 76, 78, 78, 184, 186, 370 PS |
| Land Rover Defender | 1 | 249 PS |
| Mercedes-AMG GT / CLE | 2 | 367, 381 PS |
| **Total** | **30** | **30 preliminary recommendations** |

Selection notes: Veloster N is set to the base 250 PS because the listing does not identify the optional Performance Package (275 PS). Sportage 41746521 is the pre-facelift Noblesse Plus at 184 PS; Sportage 42872676 is provisionally assigned to The Bold Noblesse at 186 PS. For the latter, confirm the first-registration month if available: before the July 2018 facelift it should be 184 PS. The listing year and grade favor 186 PS but do not prove the month. Mild-hybrid assist is excluded from AMG GT 43 and CLE engine power; use engine ratings 367 and 381 PS rather than combined/boosted values.

## Latest run-wide count after batch 5

All figures count unique listing IDs and still reconcile to the run of 500:

| State | Listings |
|---|---:|
| Matched to already approved power reference | 152 |
| Earlier EncarRus/Danawa, Korex, and independent research proposals | 164 |
| Selected preliminary powers during review parts 1–5 | 70 |
| Still unresolved: untouched EncarRus/Danawa 10 + Korex review 103 | 113 |
| Enrichment unavailable | 1 |
| **Total** | **500** |

The 234 selected preliminary values/proposals (`164 + 70`) remain research decisions only. Run-specific database writes remain zero. No listing was counted twice; positions 41–70 add exactly 30 new IDs to the 40 selected in parts 1–4.

## Final preliminary selection — remaining 113 review listings

Completed on 2026-10-14. Selected one value for each of the **103 Korex review listings** and **10 remaining EncarRus/Danawa review listings**. The final 10 source candidate arrays were supplied by the user from the VPS report. No completed source crawler was rerun. Manufacturer specifications were consulted only for incompatible engine/generation candidates.

Detailed decisions: `output/tl-auto-run-c4ea187a-437f-42e2-aef0-71bf9a65d6c7-remaining-113-decisions.json`. Readable per-ID evidence: `docs/power-selected-final-113-c4ea187a-437f-42e2-aef0-71bf9a65d6c7.md`. Combined review decision file: `output/tl-auto-run-c4ea187a-437f-42e2-aef0-71bf9a65d6c7-review-183-selected.json`.

| Final current-run bucket | Unique listings |
|---|---:|
| Existing approved-reference matches | 152 |
| Earlier preliminary candidates/proposals | 164 |
| Review selections from parts 1–5 | 70 |
| Newly selected Korex review values | 103 |
| Newly selected final EncarRus/Danawa review values | 10 |
| Unavailable enrichment | 1 |
| **Run total** | **500** |

**Selected preliminary values: 347 = 164 + 70 + 103 + 10. Listings with a selected approved/preliminary value: 499. Remaining review listings without a selected value: 0.** The 183 review IDs are unique, all belong to the current run's 347-ID unmatched set, and the complement contains exactly the earlier 164 IDs. This is a selection count, not a new database import count. Database writes remain **0**.

## Reference import and publication readiness — 2026-10-14

The local workspace contained the detailed saved decisions for 226 of the 347 plan-unmatched listings: the reviewed 183, 25 earlier Korex candidates, and 18 independent research recommendations. Those **226 preliminary values were written** to `vehicle_power_automatic_reference` as listing-scoped `automatic` rules. Each row was checked against the run's successful queue/staging record and exact year, displacement, and fuel; the resolver returned the selected power for all 226 IDs. The transaction changed no car rows, saved calculations, prices, or publication state. Audit: `output/tl-auto-run-c4ea187a-437f-42e2-aef0-71bf9a65d6c7-preliminary-reference-application.json`.

The read-only calculation pass resolved **262 of 347** plan-unmatched listings: the 226 new rules plus 36 already-existing automatic references. Publication-readiness audit covered all **499 succeeded** listings (152 approved plus 347 preliminary candidates): **414 ready, 85 blocked** because no unique power reference resolves. The one unavailable Encar listing remains excluded. Readiness audit: `output/tl-auto-run-c4ea187a-437f-42e2-aef0-71bf9a65d6c7-publication-readiness.json`; exact 85 IDs/configurations: `output/tl-auto-run-c4ea187a-437f-42e2-aef0-71bf9a65d6c7-remaining-85-power.json`.

The 85 blocked IDs are precisely the remaining subset of the earlier 121 EncarRus/Danawa preliminary IDs after 36 were resolved by existing references. Their per-listing EncarRus/Danawa source report rows are not present in this local workspace. Do not mark the 499-listing run fully ready or publish it until those 85 values are recovered and referenced. No cars or publication records were written.

### Recovery and final power coverage — 2026-10-14 (supersedes the preceding blocked-count note)

Recovered the source reconciliation for all 85 remaining IDs from the user-provided VPS output, matched each row to the run's saved local manifest, and checked there were no missing or duplicate IDs. All 85 had one selected preliminary power: **12 EncarRus/Danawa agreements**, **38 EncarRus-only candidates**, and **35 Danawa-only candidates**. The truncated first terminal output included Kia Carens listing 42830655 (148 PS); its ID and configuration were recovered from the manifest. Decision ledger: `output/tl-auto-run-c4ea187a-437f-42e2-aef0-71bf9a65d6c7-recovered-85-decisions.json`.

Added those 85 listing-scoped preliminary rules to `vehicle_power_automatic_reference`. The import transaction verified all 311 newly selected rules against successful queue/staging rows and confirmed the resolver returns each intended power. **85 inserted; 226 were already identical.** No car, calculation, price, or publication rows changed. Import audit: `output/tl-auto-run-c4ea187a-437f-42e2-aef0-71bf9a65d6c7-preliminary-reference-application.json`.

Rebuilt the power plan and calculation preview, then ran the read-only publication-readiness audit. Coverage is now **152 approved + 347 preliminary = 499/499 succeeded listings**, with **0 blocked**. The one unavailable listing remains excluded. All 499 pass the publication readiness checks; this is preparation only and does not insert or publish cars. Post-import reports: `output/tl-auto-new-encar-power-plan-c4ea187a-437f-42e2-aef0-71bf9a65d6c7-post-import.json`, `output/tl-auto-run-c4ea187a-437f-42e2-aef0-71bf9a65d6c7-preliminary-calculation-post-import.json`, and `output/tl-auto-run-c4ea187a-437f-42e2-aef0-71bf9a65d6c7-publication-readiness-post-import.json`.

Manufacturer-based corrections within this selection include early K9 3.3 GDI (300 PS) and 3.8 GDI (334 PS), G70 2.0T (252 PS), GLA45 without S (387 PS), E250 W213 (211 PS), E350 W213 (299 PS), and Korando Sports CX7 2.0 (155 PS). These supersede incompatible source cards, not existing database rules. Public-source unit/rounding differences remain explicitly provisional. Listing 42884739 retains a configuration caveat: normalized diesel displacement is 1,598 cc but badge says 2.0/NX4; 136 is selected by displacement and saved source match, not certified as an exact configuration.

### Publication completed — 2026-10-14

Published **498 listings** from this run after the readiness audit passed for all 499 successfully enriched listings. Listing **42887976** was excluded because its active vehicle number duplicates already-published listing **42867391** from run `05fc8baf-5348-4e9f-b2e4-0db7c60e1b27`; the remaining **1 listing** (`42465005`) was unavailable during enrichment. Thus 498 published + 1 duplicate + 1 unavailable = 500 run candidates.

Post-publication verification found 498 unique catalog listings, all 498 with calculations, media, and source snapshots. Their media total is 12,734 rows; options total 27,446 rows; 450 have inspection reports and 480 have history reports. Power status among published listings: 152 approved (145 final and 7 provisional under the evidence-tier policy) and 346 preliminary. The other 7 provisional-finality rows are preliminary; total provisional finality is 353.

Publication result: `output/tl-auto-run-c4ea187a-437f-42e2-aef0-71bf9a65d6c7-publication-result.json`. Manifest: `output/tl-auto-run-c4ea187a-437f-42e2-aef0-71bf9a65d6c7-publication-manifest-498.json`. The manifest dry run passed before writes, and the publisher completed all 498 rows in batches. No other run's listing was changed.
