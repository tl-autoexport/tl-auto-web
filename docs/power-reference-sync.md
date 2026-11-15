# Stage 3 — independent reference synchronization

Status: local implementation; migrations tested in two disposable PostgreSQL 17 databases. Not deployed or enabled in production. Existing API contracts, scopes, resolvers, vehicle importers and TKS formulas are unchanged.

## Flow

```
Native VP specifications + evidence + match keys
  -> transactional trigger -> durable local outbox -> VP sync worker
  -> authenticated HTTPS POST /v1/reference-sync/events
  -> TL inbox/history -> revision head -> existing draft specs/evidence/matches

Native TL specs + evidence + matches + automatic reference
  -> transactional trigger -> durable local outbox -> TL sync worker
  -> authenticated HTTPS POST /v1/reference-sync/events
  -> VP inbox/history -> revision head -> existing rejected specs + review evidence
```

Each process connects only to its own database. Peer exchange uses HTTP, never a second database credential. Sync is a separate small opt-in CLI, not part of either public web/API process. `npm run power:sync -- run` starts the bidirectional listener and sender; `send-only` runs an outbound sender without an HTTP listener and without automatic reconciliation. Both bind no public listener unless the `run` listener is separately exposed through an authenticated HTTPS proxy. Production requires a reviewed TLS route; no systemd or proxy changes are included/applied.

## Contract and policy

`power-sync-v1` wraps the Stage 1 `power-record-v1`, raw reference snapshot, upsert/retire/revoke, and content-hashed event ID. The record carries origin project, native record/matching-key identity, monotonic revision, fingerprint, configuration/ranges, components, original units, basis, resolution class (confidence), source/evidence provenance and timestamps. Engine-cc ranges are an additive optional contract extension; absent ranges preserve existing fingerprints. No listing correlation or TKS results are accepted.

SQL source state assigns revisions under a transaction advisory lock. VP matching variants use a hash of each matching-key JSON object; removal generates a tombstone for that variant, addition creates a new variant. TL matching variants use matching-row IDs. Evidence edits also emit affected snapshots. Sequence gaps after rollbacks are normal. Publication/delivery watermark never skips unacknowledged rows.

Receiver validation checks size (256 KiB), contract, origin, revision, timestamps, fingerprint, components, conversions and source references. Idempotency is enforced by both event ID and `(origin, record ID, revision)`. Same revision with different contents is rejected, not overwritten. Receipt/history, current head and native import are one transaction. Out-of-order events remain recorded as stale. HTTP acknowledgement is returned only after commit.

Default trust policy: **no cross-project approval**. CONFIRMED becomes PROBABLE locally; other classes never increase. Original source confidence/approval remains in immutable inbound payload. Native approved rows are never overwritten. Potentially overlapping configurations with different powers enter conflict review, with both source payloads retained. Equivalent converted power in different original units is not a numeric conflict. Unknown configuration identifiers do not authorize merging. Nonoverlapping year/engine ranges remain separate.

Imports use the existing reference tables, not a competing resolver. TL imports are `draft`. VP schema has no draft specification status, so imports use `rejected` plus `sync_record.approvalState=provisional` and `review_required` evidence. These are intentionally excluded from the existing resolver until a separate local review policy is approved. Inbox `review/conflict` rows and native `sync_record` hold all measurements and raw evidence, even if a legacy native constraint cannot project them.

TL's legacy native schema cannot safely project PHEV topology or incomplete electric/hybrid calculation components. Such records remain durable review imports in inbox/heads with the full Power Contract; no artificial topology, missing 30-minute power or summed system power is invented. Automatic TL records lacking explicit electric/system basis export as INSUFFICIENT_DATA; ICE automatic/engine_fallback remain ESTIMATED. This is an intentional safety restriction.

Imported rows carry `sync_origin`, are excluded from the export view and never re-emitted on imports, evidence edits or reconciliation. A source tombstone retires only the corresponding imported origin; unrelated/native references survive. Previous revisions remain in inbox history.

## Durability and recovery

Outbox snapshots are created in the native write transaction, including evidence/matching-key changes. A rollback rolls back the event. Source outages do not depend on peer availability: native transactions only write local rows. Local SQL failure is fail-closed; a failed native write cannot silently lose its change event.

One worker sends at most one event per second. HTTP timeout is 10 seconds; lease is 30 seconds. Exponential retry starts at 2 seconds, capped at 1 hour, at most 6 attempts before dead letter. Invalid payloads enter dead letter immediately. Sender persists the exact envelope before delivery. Lost acknowledgement retries the same event; duplicate receipt is acknowledged. Database errors do not log credentials or payloads.

`npm run power:sync -- redrive <local-seq>` resets one dead letter after investigation. Delivery rows are never discarded. Review/dead-letter inspection uses a separate read-only operator connection; worker does not auto-approve conflicts.

### First send-only canary (hard cap: three events)

Canary mode never starts the listener, never calls reconciliation, never scans beyond the explicitly bounded query, and never starts the general queue sender. First discover at most three currently due pending outbox rows with a read-only query:

```sh
npm run power:sync -- preview --limit 3
```

Review `seq`, `eventId`, `recordId`, revision and approval/confidence metadata. It prints no raw payload or credential. Then run a read-only exact dry-run with one to three `seq:eventId` pairs copied from preview:

```sh
npm run power:sync -- canary --event '<seq>:<eventId>'
```

Dry-run only performs exact-key SELECTs and in-memory contract/hash validation. It does not prepare an event in the outbox, claim/lease a row, increment attempts, reconcile, acknowledge, or contact the peer. Each exact SQL selection is bounded by the submitted sequence allowlist (maximum three); TypeScript recomputes and verifies each corresponding event ID. The sequence is only a local lookup key; it is not authority to send without the matching content hash.

Only after separately approving the reviewed dry-run, send those exact events:

```sh
npm run power:sync -- canary --event '<seq>:<eventId>' --send
```

All IDs are preflighted before the first write. The sender then atomically locks and claims only each allowlisted row, persists its validated event, posts to the configured HTTPS endpoint, and acknowledges only a matching event ID. It stops on the first error; already acknowledged items remain idempotent and any attempted item remains durable for retry. Four or more IDs, duplicate IDs/sequences, mismatched hashes, missing rows, and non-ready rows are rejected. No reconcile runs at canary startup, so existing outbox rows are the only eligible source. Use the distinct worker DB login and directional inbound/outbound tokens on the worker host; do not put them in the web deployment or Git. Non-loopback database URLs require `sslmode=verify-full`; peer URLs require HTTPS.

After a successful limited canary has been reviewed, the separately controlled steady outbound process is `npm run power:sync -- send-only`. It has no inbound listener and does not perform initial backfill. Reconciliation remains a separate explicit bounded operation. Do not start the general `run` command during this directional TL → Vehicle Power rollout.

Reconciliation processes 100 native entities per minute, with durable lexicographic cursor. It hashes native snapshots against captured state, emits changed/missing snapshots and deleted-variant tombstones, and restarts after a full pass. It does not query vehicles, Encar, AI or source websites. `npm run power:sync -- reconcile` advances one bounded page. Initial backfill is therefore incremental, not performed inside a migration.

## Least-privilege setup (future deployment only)

Apply each project's own new migration once using its administrative deployment path:
- VP: `202610240001_vehicle_power_sync.sql`
- TL: `20261024_vehicle_power_sync.sql`

They add transport tables/views, two metadata columns on existing specs and reference triggers/functions. They do not backfill or modify existing reference rows. RLS remains enabled. Existing runtime grants are not extended.

Each migration creates a NOLOGIN role (`vehicle_power_sync` / `tl_auto_power_sync`). Provision a distinct non-admin INHERIT login per local worker, grant only that local role, and restrict its connection/database. No password or login is embedded in migrations. Roles have no native-table write grants. Explicit definer functions clamp imports to quarantined rows and prohibit modifying an unrelated origin; public/anon/authenticated EXECUTE is revoked. Native snapshot read is limited to the reference view. Worker startup rejects superuser, BYPASSRLS, create-role/db or native-write credentials. API/web processes must not receive sync credentials.

Server-only environment names (no values in Git):
- `POWER_SYNC_DATABASE_URL`: this project's restricted local sync login; no fallback to runtime `DATABASE_URL`.
- `POWER_SYNC_INBOUND_TOKEN`: unique incoming bearer, >=32 chars.
- `POWER_SYNC_OUTBOUND_TOKEN`: independent directional peer bearer, >=32 chars.
- `POWER_SYNC_PEER_URL`: exact HTTPS peer `/v1/reference-sync/events` URL; loopback HTTP only for tests.
- `POWER_SYNC_PORT`: optional loopback port.

These credentials authorize only reference synchronization, not public resolver/TKS access. Use distinct tokens in both directions, not existing consumer credentials. No plaintext tokens are stored by the protocol or logged. Rotation is an operator action outside this local stage.

## Reproducibility and checks

VP owns the small protocol/store/service source. TL contains an identical vendored boundary (contract/types/canonicalization plus sync modules), with no runtime dependency on a sibling checkout. `python3 scripts/vendor-power-sync.py` updates that boundary; `python3 scripts/generate-sync-migrations.py` regenerates both additive migrations. Review changes in both repos together. No TL resolver or TKS module is copied into VP.

`npm test`, TypeScript and production builds cover both repositories. `npm run test:sync:postgres` initializes a temporary PostgreSQL cluster with dynamic loopback port, applies actual base reference migrations plus both sync migrations into separate databases, uses separate restricted worker logins, runs real SQL/HTTP integration tests, then stops/removes the cluster. Requires installed PostgreSQL tools (override `POWER_SYNC_PG_BIN`) and local TL checkout (`POWER_SYNC_TL_CHECKOUT`). The minimal test cars table exists only to satisfy TL foundational migration dependencies; production schema is never reset or inspected by this runner.

Integration coverage: both directions, duplicate/concurrent retry, stale/colliding revision, native transaction rollback, evidence/match changes, automatic reference, conflict with local approved data, provisional imports, revoke/retire, anti-echo, peer failure/recovery, exact HTTP ack, checkpoint, dead-letter redrive, reconciliation drift repair, and actual denied native-table privileges. TL-specific PostgreSQL canary regression uses a disposable PostgreSQL cluster to verify exact selection, ID/hash matching, hard cap, dry-run no-write behavior, single-row claim/ack, and checkpoint not skipping older pending events. Unit tests cover payload/auth/size, source trust, unknown EV basis, explicit allowlists and no listener/reconcile in canary/send-only. No automotive live requests.

## Acceptance and remaining rollout decisions

Local Stage 3 completion does not mean production sync is running. Before rollout separately approve: TL migration, TL release deployment, worker host and HTTPS routes, directional credential provisioning/rotation, first canary send, history retention/alerting, local promotion/trust policy, and any later initial backfill. Vehicle Power must expose its authenticated sync receiver and have its separate inbound credential configured before a TL canary can succeed. No automatic promotion or catalog recalculation is implemented. Stage 4 can use the integrated contract without depending on production sync availability.

## Local verification result — 2026-10-24

Vehicle Power: the existing two-project disposable-PostgreSQL sync regression passes against both migrations. TL Auto: all npm test groups pass; sync unit tests report 12 passed and one environment-gated PostgreSQL test skipped in the ordinary suite. The standalone TL disposable-PostgreSQL canary test passes 1/1, and the two-project disposable PostgreSQL sync regression passes 1/1. TypeScript and Next.js production build pass. Production deployment/migration/service changes: none.
