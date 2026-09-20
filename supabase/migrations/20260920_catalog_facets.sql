-- Server-side faceting for the catalogue.
--
-- One predicate decides everything. `catalog_match` holds the single definition
-- of "this car is in the current selection", and both the facet counters and the
-- listing count are built from it, so a counter cannot disagree with the list.
--
-- The cascade needs counts for the *other* axes while the current one is open:
-- with Kia selected the brand axis must still offer every brand, not only Kia.
-- That is why the predicate takes an `omit` argument: when the brand axis is
-- counted, the brand condition is skipped while every other filter still
-- applies. `catalog_facets` does exactly that per axis.
--
-- Only `approved` dictionary entries are offered for generations. Cards without
-- a generation code are never removed from the catalogue: they simply do not
-- appear in the generation axis, which is the correct behaviour and is covered
-- by the verification scenarios.
create or replace function public.catalog_match(c public.cars, f jsonb, omit text default null)
returns boolean
language sql
stable
as $$
  select
    c.is_available
    and c.primary_source in ('encar', 'chestny_prigon')
    and c.fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric')
    and (c.fuel_type = 'electric' or (c.price_rub is not null and c.power_hp is not null))
    and (omit is not distinct from 'source' or f->>'source' is null or c.primary_source = f->>'source')
    and (omit is not distinct from 'brand' or f->>'brand' is null or c.brand = f->>'brand')
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
  'Single definition of the catalogue selection. omit skips one axis so a cascade can count the options of the axis it is showing.';

create or replace function public.catalog_listing_count(f jsonb)
returns integer
language sql
stable
as $$
  select count(*)::int from public.cars c where public.catalog_match(c, f)
$$;

comment on function public.catalog_listing_count(jsonb) is
  'Number of cars the listing shows for these filters. The same predicate drives the facet counters.';

-- Facets for the cascade and the quick presets. Every axis is counted with all
-- other filters applied and its own filter omitted.
create or replace function public.catalog_facets(f jsonb)
returns table (axis text, value text, label text, cars integer, sort_order integer)
language sql
stable
as $$
  with
  brand_axis as (
    select 'brand'::text as axis, c.brand as value, c.brand as label, count(*)::int as cars, null::int as sort_order
    from public.cars c where public.catalog_match(c, f, 'brand') and c.brand is not null group by c.brand
  ),
  model_axis as (
    select 'model'::text, c.model, c.model, count(*)::int, null::int
    from public.cars c where public.catalog_match(c, f, 'model') and c.model is not null group by c.model
  ),
  generation_axis as (
    select 'generation'::text, d.code, d.label_ru, count(*)::int, null::int
    from public.cars c
    join public.catalog_generation_dictionary d on d.code = c.generation_code and d.status = 'approved'
    where public.catalog_match(c, f, 'generation')
    group by d.code, d.label_ru
  ),
  fuel_axis as (
    select 'fuel'::text, c.fuel_type, c.fuel_type, count(*)::int, null::int
    from public.cars c where public.catalog_match(c, f, 'fuel') and c.fuel_type is not null group by c.fuel_type
  ),
  drive_axis as (
    select 'drive'::text, c.drive_type, c.drive_type, count(*)::int, null::int
    from public.cars c where public.catalog_match(c, f, 'drive') and c.drive_type is not null group by c.drive_type
  ),
  transmission_axis as (
    select 'transmission'::text, c.transmission, c.transmission, count(*)::int, null::int
    from public.cars c where public.catalog_match(c, f, 'transmission') and c.transmission is not null group by c.transmission
  ),
  body_axis as (
    select 'body'::text, c.body_type, c.body_type, count(*)::int, null::int
    from public.cars c where public.catalog_match(c, f, 'body') and c.body_type is not null group by c.body_type
  ),
  color_axis as (
    select 'color'::text, c.color, c.color, count(*)::int, null::int
    from public.cars c where public.catalog_match(c, f, 'color') and c.color is not null group by c.color
  ),
  power_axis as (
    select 'power_band'::text,
           case when c.power_hp <= 160 then 'up_to_160' else 'over_160' end,
           case when c.power_hp <= 160 then 'до 160 л.с.' else 'свыше 160 л.с.' end,
           count(*)::int, null::int
    from public.cars c where public.catalog_match(c, f, 'power') and c.power_hp is not null
    group by 2, 3
  ),
  accident_axis as (
    select 'no_accident'::text, 'confirmed'::text, 'Без ДТП (подтверждено)'::text, count(*)::int, null::int
    from public.cars c where public.catalog_match(c, f, 'accident') and c.accident_count = 0
  ),
  insurance_axis as (
    select 'no_insurance'::text, 'confirmed'::text, 'Без страховых (подтверждено)'::text, count(*)::int, null::int
    from public.cars c where public.catalog_match(c, f, 'insurance') and c.insurance_payout_count = 0
  )
  select * from brand_axis
  union all select * from model_axis
  union all select * from generation_axis
  union all select * from fuel_axis
  union all select * from drive_axis
  union all select * from transmission_axis
  union all select * from body_axis
  union all select * from color_axis
  union all select * from power_axis
  union all select * from accident_axis
  union all select * from insurance_axis
$$;

comment on function public.catalog_facets(jsonb) is
  'Facet counters for the catalogue cascade. Each axis applies every filter except its own, so an open axis still offers the alternatives.';
