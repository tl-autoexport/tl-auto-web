-- A durable, per-listing enrichment queue for the TL Auto reserve.
-- A listing can be queued only once while its state is non-final. This keeps
-- worker restarts and repeated commands from issuing duplicate Encar requests.

create table if not exists public.catalog_enrichment_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  status text not null default 'awaiting_approval'
    check (status in ('awaiting_approval', 'approved', 'running', 'completed', 'cancelled')),
  requested_limit integer not null check (requested_limit > 0),
  candidate_count integer not null default 0 check (candidate_count >= 0),
  local_rules_version text not null,
  summary jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.catalog_enrichment_queue (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.catalog_enrichment_runs(id) on delete restrict,
  source text not null,
  source_listing_id text not null,
  source_url text not null,
  status text not null default 'queued'
    check (status in ('queued', 'leased', 'succeeded', 'unavailable', 'failed', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_until timestamptz,
  last_attempt_at timestamptz,
  completed_at timestamptz,
  last_error text,
  candidate_snapshot jsonb not null default '{}'::jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_listing_id)
);

create index if not exists catalog_enrichment_queue_claim_idx
  on public.catalog_enrichment_queue(status, lease_until, created_at);

create index if not exists catalog_enrichment_queue_run_idx
  on public.catalog_enrichment_queue(run_id, status);

-- A lightweight timestamp trigger is intentionally avoided: workers update
-- state explicitly inside their transaction, making each state transition
-- auditable in the row itself.
