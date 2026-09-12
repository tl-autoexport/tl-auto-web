-- Current public catalogue predicates include both original Encar inventory
-- and approved Chestny Prigon cards. The older partial indexes only cover
-- Encar, which makes PostgreSQL scan and sort the whole public set once the
-- second source is present.
--
-- Keep this predicate aligned with getCatalogCars/getCatalogCount. It serves
-- the default fresh ordering and exact count; specialised filters continue to
-- use their existing single-column indexes.
create index if not exists cars_public_catalog_all_sources_fresh_idx
  on public.cars (source_updated_at desc, id)
  where vehicle_type = 'car'
    and is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric')
    and price_rub is not null
    and power_hp is not null;

create index if not exists cars_public_catalog_all_sources_under160_idx
  on public.cars (power_hp, source_updated_at desc, id)
  where vehicle_type = 'car'
    and is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric')
    and price_rub is not null
    and power_hp is not null;
