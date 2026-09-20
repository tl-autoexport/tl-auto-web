-- Fixes the generation facet: the join multiplied cars.
--
-- Nine codes have several source spellings (아반떼 (CN7) and 더 뉴 아반떼 (CN7) are
-- the same generation), so joining the dictionary on the code counted every car
-- once per spelling: 904 instead of 452 for cn7, 51 instead of 17 for ja.
--
-- The axis now groups by the car's own code and takes the label from the
-- dictionary in a scalar subquery. The import guarantees one code never carries
-- two labels within a model, so the label is unambiguous; grouping by the car's
-- code also makes the counter independent of how many spellings exist.
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
    select 'generation'::text,
           c.generation_code,
           (select min(d.label_ru) from public.catalog_generation_dictionary d
             where d.code = c.generation_code and d.status = 'approved'),
           count(*)::int,
           null::int
    from public.cars c
    where public.catalog_match(c, f, 'generation')
      and c.generation_code is not null
      and exists (select 1 from public.catalog_generation_dictionary d
                   where d.code = c.generation_code and d.status = 'approved')
    group by c.generation_code
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
