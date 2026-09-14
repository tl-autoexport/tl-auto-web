-- The VPS has service-role Supabase API credentials, not a raw Postgres URL.
-- These RPCs keep queue leasing and completion atomic without adding a new
-- database secret to that host.
create or replace function public.claim_catalog_enrichment_queue(
  p_run_id uuid,
  p_limit integer,
  p_lease_minutes integer
)
returns setof public.catalog_enrichment_queue
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select q.id
      from public.catalog_enrichment_queue q
     where q.run_id = p_run_id
       and q.status in ('queued','leased')
       and (q.status = 'queued' or q.lease_until < now())
     order by q.created_at
     for update skip locked
     limit greatest(1, least(p_limit, 50))
  )
  update public.catalog_enrichment_queue q
     set status = 'leased',
         lease_until = now() + make_interval(mins => greatest(5, least(p_lease_minutes, 120))),
         last_attempt_at = now(),
         attempt_count = q.attempt_count + 1,
         updated_at = now()
    from candidates c
   where q.id = c.id
  returning q.*;
$$;

create or replace function public.complete_catalog_enrichment_queue_item(
  p_queue_id uuid,
  p_status text,
  p_result jsonb,
  p_fuel text default null,
  p_color text default null,
  p_image_urls jsonb default '[]'::jsonb,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_listing_id text;
begin
  if p_status not in ('succeeded','unavailable','failed') then
    raise exception 'unsupported enrichment completion status: %', p_status;
  end if;
  select source_listing_id into v_source_listing_id
    from public.catalog_enrichment_queue where id = p_queue_id for update;
  if v_source_listing_id is null then raise exception 'queue item not found'; end if;
  if p_status = 'succeeded' then
    update public.chestny_catalog_staging
       set raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object('encar_enrichment', p_result->'payload'),
           fuel_type = coalesce(fuel_type, p_fuel),
           exterior_color = coalesce(exterior_color, p_color),
           image_urls = case when jsonb_array_length(image_urls) = 0 and jsonb_array_length(p_image_urls) > 0 then p_image_urls else image_urls end,
           updated_at = now()
     where source_listing_id = v_source_listing_id;
  end if;
  update public.catalog_enrichment_queue
     set status = p_status,
         result = p_result - 'payload',
         completed_at = case when p_status in ('succeeded','unavailable') then now() else null end,
         lease_until = null,
         last_error = case when p_status = 'failed' then p_error else null end,
         updated_at = now()
   where id = p_queue_id;
end;
$$;

grant execute on function public.claim_catalog_enrichment_queue(uuid, integer, integer) to service_role;
grant execute on function public.complete_catalog_enrichment_queue_item(uuid, text, jsonb, text, text, jsonb, text) to service_role;
