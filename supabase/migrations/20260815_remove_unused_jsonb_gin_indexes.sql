-- These indexes were audited on 2026-08-15 and had zero scans while adding
-- 42 MB of database storage. The application does not query these JSONB
-- columns, so the indexes only increase write and storage costs.
drop index if exists public.source_snapshots_payload_gin_idx;
drop index if exists public.calc_snapshots_result_gin_idx;
drop index if exists public.car_condition_reports_summary_gin_idx;
