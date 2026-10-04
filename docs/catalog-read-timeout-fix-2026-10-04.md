# Catalogue read timeout: 2026-10-04

Repository: `tl-autoexport/tl-auto-web`. Both migrations below were applied to
the project's configured Supabase database on 2026-10-04. Application changes
require the next normal Git deployment; no Vercel account settings were changed.

## Evidence and cause

Vercel reported PostgreSQL `57014` on card queries at approximately five seconds
and blank errors on the HEAD exact-count query. The actual catalogue predicate
includes electric cars without a confirmed price or power:

```sql
is_available = true
and primary_source in ('encar', 'chestny_prigon')
and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric', 'lpg')
and (fuel_type = 'electric' or (price_rub is not null and power_hp is not null))
```

The v3 partial indexes require both price and power for every row. PostgreSQL
cannot use them to satisfy the broader OR predicate, even when the currently
visible electric cars happen to have both values. EXPLAIN ANALYZE showed an
available-row scan and a sort of thousands of cars before returning 25 cards.
The measured card query took 2,888 ms and the unfiltered count took 83 ms.

The catalogue also called the same full 13-axis facet RPC separately for
generation labels and quick-preset counts. A measured call took 6,859 ms. The
existing SQL count RPC was slower than the direct count in the initial
measurement, so moving all counts to that RPC was deliberately avoided.

## Changes

- `20261004_catalog_public_read_indexes.sql` adds ten indexes concurrently:
  sorting/count indexes matching the actual predicate, two common filtered
  reads, and compact covering indexes for the header summary. No indexes or
  records are removed. The additions occupied about 4 MB at this catalogue size.
- The migration runner recognizes `-- migrate:non-transactional` only for
  additive concurrent indexes on `cars` and `catalog_vehicle_names`. It runs
  one statement at a time, limits lock waits and checks each index is valid.
  Existing transactional migrations retain their original execution path.
- `20261004_catalog_display_summary.sql` adds a read-only aggregate over the
  public selection, returning only generation labels and five counts. Existing
  views and facet/count functions, RLS policies and publication rules are kept.
- Both header consumers share this compact aggregate and its five-minute cache.
  Their existing optional-data fallback remains outside the cache: a failed
  read is logged but is not cached as an empty successful response.
- Exact listing counts share a 30-second cache keyed by the complete selection.
  Sorting/pagination do not change its key; every actual filter is preserved.
  Concurrent identical cold reads share one promise; failures are released.
- Counts use GET with `limit=0` and an exact count rather than HEAD. This returns
  no car rows but retains PostgreSQL error details if another failure occurs.
- Card selections and cursor pagination remain live and retain their predicates.

## Verification

Before and after the database changes, the visible selection contained 10,023
cars and had the same ordered-ID MD5:
`76d8151275174045da53df427cfce9c0`. No listing was lost or added by the changes.

After indexing, the first measured fresh-card query took 17 ms and count took
7 ms. Subsequent SQL checks of all five sorts and the two filtered reads took
approximately 1–6 ms and used the new indexes. These are SQL execution times,
not full website response times. The compact summary took 237 ms including the
database round trip in the final measurement and matched all 143 labels and
all five counts from the existing facet function:

| Preset | Cars |
| --- | ---: |
| Up to 160 hp | 3,606 |
| Electric | 95 |
| 4WD | 2,856 |
| No accident | 205 |
| No insurance | 205 |

The public `anon` role could read the same safe aggregate and indexed card
selection. Both concurrent-index applications completed successfully and all
indexes were valid/ready.

Production-mode local application checks passed:

- First catalogue response: 923 ms (the earlier complete-page check was 6,547 ms).
- Twelve count selections matched direct SQL: default, power, fuel, body/drive,
  make/model, free-text search, engine/year, mileage/price, owners, insurance,
  accident flags, and an empty result selection.
- All five sorts: first two pages exactly matched SQL order, with 48 unique IDs
  per sort and no skipped/duplicated cards.
- Four simultaneous catalogue page requests: 259–626 ms, no error screen.
- Chrome displayed 10,023 cars and the normal grid; no browser errors were logged.
- `npm test`, `npm run test:catalog-reads`, TypeScript, and production build passed.
- ESLint passed for changed files and the application excluding existing ignored
  `output/**` scratch scripts. Bare `npm run lint` still encounters five pre-existing
  `no-explicit-any` errors in those scratch scripts, plus existing warnings.

Recheck read plans, index validity, public access and summary parity with:

```sh
npm run audit:catalog-reads
```

This audit runs inside a read-only repeatable-read transaction. A fixed-ID hash
can optionally be supplied when verifying an unchanged catalogue; do not expect
that hash to remain constant after normal import/availability updates.

## Rollout and limits

Database additions are backward compatible and already active. Deploy the code
through this repository's normal Git/Vercel workflow. The old application can
continue using the existing functions. A code rollback can leave the additive
indexes and summary function in place.

The count cache can briefly show a recently calculated total; card availability
is still checked by the live query. These checks establish that the identified
query bottlenecks were removed, not that future infrastructure outages or
different expensive filtered queries are impossible. Keep the runtime timing
logs to investigate any remaining incidents.
