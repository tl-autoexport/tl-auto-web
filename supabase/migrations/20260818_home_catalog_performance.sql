-- Keep the storefront queries below the PostgREST statement timeout as the
-- Encar catalogue grows. Every index mirrors a public catalogue predicate.
create index if not exists cars_public_catalog_fresh_idx
  on public.cars(source_updated_at desc, id)
  where is_available = true
    and primary_source = 'encar'
    and fuel_type in ('gasoline', 'diesel')
    and price_rub is not null
    and power_hp is not null;

create index if not exists cars_public_catalog_under160_idx
  on public.cars(power_hp, source_updated_at desc, id)
  where is_available = true
    and primary_source = 'encar'
    and fuel_type in ('gasoline', 'diesel')
    and price_rub is not null
    and power_hp is not null;

create index if not exists cars_public_catalog_registration_idx
  on public.cars(year, registration_month, source_updated_at desc, id)
  where is_available = true
    and primary_source = 'encar'
    and fuel_type in ('gasoline', 'diesel')
    and price_rub is not null
    and power_hp is not null;

-- The home screen needs three related counts. A single aggregate query avoids
-- making three separate count requests while rendering the page.
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
    and fuel_type in ('gasoline', 'diesel')
    and price_rub is not null
    and power_hp is not null;
$$;

revoke all on function public.catalog_public_metrics() from public;
grant execute on function public.catalog_public_metrics() to anon, authenticated, service_role;
