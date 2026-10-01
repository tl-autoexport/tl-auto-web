-- Treat source spellings of KG Mobility/SsangYong as one KGM brand in the
-- server-side catalog count and cascade facets. Stored source values remain
-- unchanged; only the filter predicate is canonicalized.
create or replace function public.catalog_match(c public.cars, f jsonb, omit text default null)
returns boolean
language sql
stable
as $$
  select
    c.is_available
    and c.primary_source in ('encar', 'chestny_prigon')
    and c.fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric', 'lpg')
    and (c.fuel_type = 'electric' or (c.price_rub is not null and c.power_hp is not null))
    and (omit is not distinct from 'source' or f->>'source' is null or c.primary_source = f->>'source')
    and (
      omit is not distinct from 'brand'
      or f->>'brand' is null
      or public.normalize_catalog_brand(c.brand) = public.normalize_catalog_brand(f->>'brand')
    )
    and (omit is not distinct from 'model' or f->>'model' is null or c.model = f->>'model')
    and (omit is not distinct from 'generation' or f->>'generation' is null or c.generation_code = f->>'generation')
    and (omit is not distinct from 'fuel' or f->>'fuel' is null or c.fuel_type = f->>'fuel')
    and (omit is not distinct from 'drive' or f->>'drive' is null or c.drive_type = f->>'drive')
    and (omit is not distinct from 'transmission' or f->>'transmission' is null or c.transmission = f->>'transmission')
    and (omit is not distinct from 'body' or f->>'body' is null or c.body_type = f->>'body')
    and (omit is not distinct from 'color' or f->>'color' is null or c.color = f->>'color')
    and (omit is not distinct from 'year' or f->>'yearFrom' is null or c.year >= (f->>'yearFrom')::int)
    and (omit is not distinct from 'year' or f->>'yearTo' is null or c.year <= (f->>'yearTo')::int)
    and (omit is not distinct from 'mileage' or f->>'mileageFrom' is null or c.mileage_km >= (f->>'mileageFrom')::int)
    and (omit is not distinct from 'mileage' or f->>'mileageTo' is null or c.mileage_km <= (f->>'mileageTo')::int)
    and (omit is not distinct from 'price' or f->>'priceFrom' is null or c.price_rub >= (f->>'priceFrom')::bigint)
    and (omit is not distinct from 'price' or f->>'priceTo' is null or c.price_rub <= (f->>'priceTo')::bigint)
    and (omit is not distinct from 'power' or f->>'maxPowerHp' is null or c.power_hp <= (f->>'maxPowerHp')::int)
    and (omit is not distinct from 'accident' or coalesce((f->>'noAccidents')::boolean, false) is not true or c.accident_count = 0)
    and (omit is not distinct from 'insurance' or coalesce((f->>'noInsurance')::boolean, false) is not true or c.insurance_payout_count = 0)
$$;

comment on function public.catalog_match(public.cars, jsonb, text) is
  'Single catalogue predicate; canonical brand filters include KGM, KG Mobility, and legacy SsangYong source aliases.';
