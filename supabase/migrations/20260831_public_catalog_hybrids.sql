-- Hybrid listings are calculated only after their separate combustion-engine
-- and electric-motor powers are verified. Once calculated, they belong to the
-- same public catalogue and metrics as petrol and diesel cars.
create index if not exists cars_public_catalog_hybrid_fresh_idx
  on public.cars(source_updated_at desc, id)
  where is_available = true
    and primary_source = 'encar'
    and fuel_type = 'hybrid'
    and price_rub is not null
    and power_hp is not null;

create index if not exists cars_public_catalog_hybrid_under160_idx
  on public.cars(power_hp, source_updated_at desc, id)
  where is_available = true
    and primary_source = 'encar'
    and fuel_type = 'hybrid'
    and price_rub is not null
    and power_hp is not null;

create index if not exists cars_public_catalog_hybrid_registration_idx
  on public.cars(year, registration_month, source_updated_at desc, id)
  where is_available = true
    and primary_source = 'encar'
    and fuel_type = 'hybrid'
    and price_rub is not null
    and power_hp is not null;

create or replace function public.catalog_public_metrics()
returns table (calculated bigint, under160 bigint, clean bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*)::bigint as calculated,
    count(*) filter (where power_hp <= 160)::bigint as under160,
    count(*) filter (where accident_count = 0)::bigint as clean
  from public.cars
  where is_available = true
    and primary_source = 'encar'
    and fuel_type in ('gasoline', 'diesel', 'hybrid')
    and price_rub is not null
    and power_hp is not null;
$$;

revoke all on function public.catalog_public_metrics() from public;
grant execute on function public.catalog_public_metrics() to anon, authenticated, service_role;
