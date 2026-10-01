-- The public catalogue now includes LPG listings. The v2 partial indexes
-- predate LPG, so queries that include all public fuel types cannot use them.
-- Replace them with predicates matching the current listing and count queries.
create index if not exists cars_public_catalog_v3_fresh_idx
  on public.cars (source_updated_at desc nulls last, id)
  where is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric', 'lpg')
    and price_rub is not null
    and power_hp is not null;

create index if not exists cars_public_catalog_v3_price_asc_idx
  on public.cars (price_rub asc nulls last, id)
  where is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric', 'lpg')
    and price_rub is not null
    and power_hp is not null;

create index if not exists cars_public_catalog_v3_price_desc_idx
  on public.cars (price_rub desc nulls last, id)
  where is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric', 'lpg')
    and price_rub is not null
    and power_hp is not null;

create index if not exists cars_public_catalog_v3_mileage_idx
  on public.cars (mileage_km asc nulls last, id)
  where is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric', 'lpg')
    and price_rub is not null
    and power_hp is not null;

create index if not exists cars_public_catalog_v3_year_idx
  on public.cars (year desc nulls last, id)
  where is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric', 'lpg')
    and price_rub is not null
    and power_hp is not null;

create index if not exists cars_public_catalog_v3_brand_model_idx
  on public.cars (brand, model, source_updated_at desc nulls last, id)
  where is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric', 'lpg')
    and price_rub is not null
    and power_hp is not null;

-- The default catalogue count is an exact head count over this same set.
-- A compact partial index allows PostgreSQL to count the qualifying IDs
-- without scanning unrelated and unavailable source records.
create index if not exists cars_public_catalog_v3_count_idx
  on public.cars (id)
  where is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric', 'lpg')
    and price_rub is not null
    and power_hp is not null;

drop index if exists public.cars_public_catalog_v2_fresh_idx;
drop index if exists public.cars_public_catalog_v2_price_asc_idx;
drop index if exists public.cars_public_catalog_v2_price_desc_idx;
drop index if exists public.cars_public_catalog_v2_mileage_idx;
drop index if exists public.cars_public_catalog_v2_year_idx;
drop index if exists public.cars_public_catalog_v2_brand_model_idx;
