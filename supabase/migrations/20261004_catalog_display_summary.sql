-- The catalogue header needs generation labels and five preset counts, not
-- thirteen independently scanned facet axes. Read the public selection once.
create or replace function public.catalog_display_summary()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with visible as materialized (
    select c.generation_code, c.generation_label, c.power_hp, c.fuel_type,
      c.drive_type, c.accident_count, c.insurance_payout_count
    from public.catalog_display_cars c
    where c.is_available = true
      and c.primary_source in ('encar', 'chestny_prigon')
      and c.fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric', 'lpg')
      and (c.fuel_type = 'electric' or (c.price_rub is not null and c.power_hp is not null))
  ), generations as (
    select generation_code, min(generation_label) as label
    from visible
    where generation_code is not null and generation_label is not null
    group by generation_code
  )
  select jsonb_build_object(
    'generationLabels', coalesce((
      select jsonb_object_agg(generation_code, label) from generations
    ), '{}'::jsonb),
    'presetCounts', (
      select jsonb_build_object(
        'under160', count(*) filter (where power_hp <= 160),
        'electric', count(*) filter (where fuel_type = 'electric'),
        'fourWheelDrive', count(*) filter (where drive_type = '4WD'),
        'noAccident', count(*) filter (where accident_count = 0),
        'noInsurance', count(*) filter (where insurance_payout_count = 0)
      ) from visible
    )
  );
$$;

-- This function returns only public labels and aggregate counts, never source
-- payloads, unpublished cars, naming evidence or customer-specific data.
revoke all on function public.catalog_display_summary() from public;
grant execute on function public.catalog_display_summary() to anon, authenticated, service_role;
notify pgrst, 'reload schema';
