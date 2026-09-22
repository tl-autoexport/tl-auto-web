-- A worker must never claim work from another approved enrichment run.
-- Expired leases are intentionally reclaimable; active leases remain owned
-- by their current worker until their lease expires.
create or replace function public.claim_encar_enrichment_queue_for_run(
  p_run_id uuid,
  p_lease_minutes integer
)
returns public.encar_enrichment_queue
language plpgsql security definer set search_path = public as $$
declare claimed public.encar_enrichment_queue;
begin
  with candidate as (
    select q.id
    from public.encar_enrichment_queue q
    join public.encar_enrichment_runs r on r.id = q.run_id
    where q.run_id = p_run_id
      and r.status in ('approved', 'running')
      and (
        q.status = 'queued'
        or (q.status = 'leased' and (q.lease_until is null or q.lease_until < now()))
      )
    order by q.created_at
    for update of q skip locked
    limit 1
  )
  update public.encar_enrichment_queue q
  set status = 'leased',
      lease_until = now() + make_interval(mins => greatest(5, least(p_lease_minutes, 120))),
      last_attempt_at = now(),
      attempt_count = q.attempt_count + 1,
      updated_at = now()
  from candidate
  where q.id = candidate.id
  returning q.* into claimed;

  return claimed;
end;
$$;

grant execute on function public.claim_encar_enrichment_queue_for_run(uuid, integer) to service_role;
