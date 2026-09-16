-- Generic queue for repeatable Encar enrichment runs.  It is deliberately
-- separate from catalog_enrichment_* so completed historic runs stay intact.
create table if not exists public.encar_enrichment_runs (
  id uuid primary key default gen_random_uuid(),
  project text not null,
  purpose text not null check (purpose in ('insurance', 'options', 'gallery', 'full')),
  priority smallint not null default 40 check (priority between 0 and 100),
  status text not null default 'awaiting_approval'
    check (status in ('awaiting_approval', 'approved', 'running', 'completed', 'cancelled')),
  requested_limit integer not null check (requested_limit > 0),
  candidate_count integer not null default 0 check (candidate_count >= 0),
  rules_version text not null,
  summary jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.encar_enrichment_queue (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.encar_enrichment_runs(id) on delete restrict,
  source text not null,
  source_listing_id text not null,
  source_url text not null,
  task jsonb not null default '{}'::jsonb,
  candidate_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'leased', 'succeeded', 'unavailable', 'failed', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_until timestamptz,
  last_attempt_at timestamptz,
  completed_at timestamptz,
  last_error text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, source, source_listing_id)
);

create table if not exists public.encar_enrichment_staging (
  queue_id uuid primary key references public.encar_enrichment_queue(id) on delete cascade,
  run_id uuid not null references public.encar_enrichment_runs(id) on delete restrict,
  source text not null,
  source_listing_id text not null,
  status text not null check (status in ('succeeded', 'unavailable', 'failed')),
  raw_payload jsonb,
  normalized jsonb not null default '{}'::jsonb,
  fetched_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists encar_enrichment_runs_ready_idx
  on public.encar_enrichment_runs (status, priority desc, created_at);
create index if not exists encar_enrichment_queue_claim_idx
  on public.encar_enrichment_queue (status, lease_until, created_at);
create index if not exists encar_enrichment_queue_run_idx
  on public.encar_enrichment_queue (run_id, status);

create or replace function public.claim_next_encar_enrichment_queue(
  p_limit integer,
  p_lease_minutes integer
)
returns setof public.encar_enrichment_queue
language sql security definer set search_path = public as $$
  with candidates as (
    select q.id
    from public.encar_enrichment_queue q
    join public.encar_enrichment_runs r on r.id = q.run_id
    where r.status in ('approved', 'running')
      and q.status in ('queued', 'leased')
      and (q.status = 'queued' or q.lease_until is null or q.lease_until < now())
    order by r.priority desc, r.created_at, q.created_at
    for update of q skip locked
    limit greatest(1, least(p_limit, 50))
  )
  update public.encar_enrichment_queue q
  set status = 'leased',
      lease_until = now() + make_interval(mins => greatest(5, least(p_lease_minutes, 120))),
      last_attempt_at = now(),
      attempt_count = q.attempt_count + 1,
      updated_at = now()
  from candidates c
  where q.id = c.id
  returning q.*;
$$;

create or replace function public.complete_encar_enrichment_queue_item(
  p_queue_id uuid,
  p_status text,
  p_result jsonb,
  p_raw_payload jsonb default null,
  p_normalized jsonb default '{}'::jsonb,
  p_error text default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare v_run_id uuid; v_source text; v_source_listing_id text;
begin
  if p_status not in ('succeeded', 'unavailable', 'failed') then
    raise exception 'unsupported completion status: %', p_status;
  end if;
  select run_id, source, source_listing_id into v_run_id, v_source, v_source_listing_id
  from public.encar_enrichment_queue where id = p_queue_id for update;
  if v_run_id is null then raise exception 'queue item not found'; end if;
  insert into public.encar_enrichment_staging(queue_id, run_id, source, source_listing_id, status, raw_payload, normalized, fetched_at, updated_at)
  values (p_queue_id, v_run_id, v_source, v_source_listing_id, p_status, p_raw_payload, coalesce(p_normalized, '{}'::jsonb), now(), now())
  on conflict (queue_id) do update set status = excluded.status, raw_payload = excluded.raw_payload,
    normalized = excluded.normalized, fetched_at = excluded.fetched_at, updated_at = now();
  update public.encar_enrichment_queue
  set status = p_status, result = p_result, lease_until = null,
      completed_at = case when p_status in ('succeeded', 'unavailable') then now() else null end,
      last_error = case when p_status = 'failed' then p_error else null end,
      updated_at = now()
  where id = p_queue_id;
end;
$$;

grant execute on function public.claim_next_encar_enrichment_queue(integer, integer) to service_role;
grant execute on function public.complete_encar_enrichment_queue_item(uuid, text, jsonb, jsonb, jsonb, text) to service_role;
