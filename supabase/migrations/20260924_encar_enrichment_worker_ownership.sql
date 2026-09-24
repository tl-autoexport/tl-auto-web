-- A lease belongs to one concrete worker.  This prevents a stale process from
-- completing or releasing work that has already been reclaimed by another.
alter table public.encar_enrichment_queue
  add column if not exists lease_token uuid,
  add column if not exists lease_owner text;

create index if not exists encar_enrichment_queue_claim_owned_idx
  on public.encar_enrichment_queue (run_id, status, lease_until, created_at);

create or replace function public.claim_encar_enrichment_queue_batch_for_run(
  p_run_id uuid,
  p_lease_owner text,
  p_limit integer,
  p_lease_minutes integer,
  p_max_attempts integer default 4
)
returns setof public.encar_enrichment_queue
language plpgsql security definer set search_path = public as $$
begin
  if nullif(trim(p_lease_owner), '') is null then
    raise exception 'lease owner is required';
  end if;

  -- Terminally fail rows which have exhausted their retry budget so a run can
  -- finish deterministically instead of waiting forever.
  update public.encar_enrichment_queue q
  set status = 'failed', lease_until = null, lease_token = null, lease_owner = null,
      last_error = coalesce(q.last_error, 'maximum enrichment attempts exceeded'),
      updated_at = now()
  where q.run_id = p_run_id
    and q.status in ('queued', 'leased')
    and q.attempt_count >= greatest(1, least(p_max_attempts, 10))
    and (q.status = 'queued' or q.lease_until is null or q.lease_until < now());

  return query
  with candidates as (
    select q.id
    from public.encar_enrichment_queue q
    join public.encar_enrichment_runs r on r.id = q.run_id
    where q.run_id = p_run_id
      and r.status in ('approved', 'running')
      and q.attempt_count < greatest(1, least(p_max_attempts, 10))
      and (q.status = 'queued' or (q.status = 'leased' and (q.lease_until is null or q.lease_until < now())))
    order by q.created_at
    for update of q skip locked
    limit greatest(1, least(p_limit, 30))
  )
  update public.encar_enrichment_queue q
  set status = 'leased',
      lease_until = now() + make_interval(mins => greatest(5, least(p_lease_minutes, 120))),
      lease_owner = p_lease_owner,
      lease_token = gen_random_uuid(),
      last_attempt_at = now(),
      attempt_count = q.attempt_count + 1,
      updated_at = now()
  from candidates c
  where q.id = c.id
  returning q.*;
end;
$$;

create or replace function public.complete_encar_enrichment_queue_item_owned(
  p_queue_id uuid, p_lease_token uuid, p_status text, p_result jsonb,
  p_raw_payload jsonb default null, p_normalized jsonb default '{}'::jsonb,
  p_error text default null
)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_run_id uuid; v_source text; v_source_listing_id text;
begin
  if p_status not in ('succeeded', 'unavailable', 'failed') then raise exception 'unsupported completion status: %', p_status; end if;
  select run_id, source, source_listing_id into v_run_id, v_source, v_source_listing_id
  from public.encar_enrichment_queue
  where id = p_queue_id and status = 'leased' and lease_token = p_lease_token
  for update;
  if v_run_id is null then return false; end if;
  insert into public.encar_enrichment_staging(queue_id, run_id, source, source_listing_id, status, raw_payload, normalized, fetched_at, updated_at)
  values (p_queue_id, v_run_id, v_source, v_source_listing_id, p_status, p_raw_payload, coalesce(p_normalized, '{}'::jsonb), now(), now())
  on conflict (queue_id) do update set status=excluded.status, raw_payload=excluded.raw_payload, normalized=excluded.normalized, fetched_at=excluded.fetched_at, updated_at=now();
  update public.encar_enrichment_queue
  set status=p_status, result=p_result, lease_until=null, lease_token=null, lease_owner=null,
      completed_at=case when p_status in ('succeeded','unavailable') then now() else null end,
      last_error=case when p_status='failed' then p_error else null end, updated_at=now()
  where id=p_queue_id;
  return true;
end;
$$;

create or replace function public.release_encar_enrichment_queue_item_owned(p_queue_id uuid, p_lease_token uuid, p_error text default null)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.encar_enrichment_queue
  set status='queued', lease_until=null, lease_token=null, lease_owner=null,
      last_error=p_error, updated_at=now()
  where id=p_queue_id and status='leased' and lease_token=p_lease_token;
  return found;
end;
$$;

grant execute on function public.claim_encar_enrichment_queue_batch_for_run(uuid,text,integer,integer,integer) to service_role;
grant execute on function public.complete_encar_enrichment_queue_item_owned(uuid,uuid,text,jsonb,jsonb,jsonb,text) to service_role;
grant execute on function public.release_encar_enrichment_queue_item_owned(uuid,uuid,text) to service_role;
