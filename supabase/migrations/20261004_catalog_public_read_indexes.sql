-- migrate:non-transactional
-- Run each statement separately: CONCURRENTLY must not run inside a transaction.
-- Additive only. Match the storefront predicate, including electric cars with
-- an unconfirmed price/power. v3 excludes those rows and cannot serve this OR.
create index concurrently if not exists cars_public_catalog_v4_fresh_idx
  on public.cars (source_updated_at desc nulls last, id)
  where is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric', 'lpg')
    and (fuel_type = 'electric' or (price_rub is not null and power_hp is not null));

create index concurrently if not exists cars_public_catalog_v4_price_asc_idx
  on public.cars (price_rub asc nulls last, id)
  where is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric', 'lpg')
    and (fuel_type = 'electric' or (price_rub is not null and power_hp is not null));

create index concurrently if not exists cars_public_catalog_v4_price_desc_idx
  on public.cars (price_rub desc nulls last, id)
  where is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric', 'lpg')
    and (fuel_type = 'electric' or (price_rub is not null and power_hp is not null));

create index concurrently if not exists cars_public_catalog_v4_mileage_idx
  on public.cars (mileage_km asc nulls last, id)
  where is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric', 'lpg')
    and (fuel_type = 'electric' or (price_rub is not null and power_hp is not null));

create index concurrently if not exists cars_public_catalog_v4_year_idx
  on public.cars (year desc nulls last, id)
  where is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric', 'lpg')
    and (fuel_type = 'electric' or (price_rub is not null and power_hp is not null));

create index concurrently if not exists cars_public_catalog_v4_count_idx
  on public.cars (id)
  where is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric', 'lpg')
    and (fuel_type = 'electric' or (price_rub is not null and power_hp is not null));

create index concurrently if not exists cars_public_catalog_v4_under160_fresh_idx
  on public.cars (source_updated_at desc nulls last, id)
  where is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric', 'lpg')
    and (fuel_type = 'electric' or (price_rub is not null and power_hp is not null))
    and power_hp <= 160;

create index concurrently if not exists cars_public_catalog_v4_body_drive_fresh_idx
  on public.cars (body_type, drive_type, source_updated_at desc nulls last, id)
  where is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric', 'lpg')
    and (fuel_type = 'electric' or (price_rub is not null and power_hp is not null));

-- The default header summary needs only these fields, not the wide source
-- payloads stored on cars and naming evidence stored on catalog_vehicle_names.
create index concurrently if not exists cars_public_catalog_v4_summary_idx
  on public.cars (id)
  include (generation_code, power_hp, fuel_type, drive_type, accident_count, insurance_payout_count)
  where is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric', 'lpg')
    and (fuel_type = 'electric' or (price_rub is not null and power_hp is not null));

create index concurrently if not exists catalog_vehicle_names_summary_idx
  on public.catalog_vehicle_names (car_id)
  include (brand, model, generation_label);
