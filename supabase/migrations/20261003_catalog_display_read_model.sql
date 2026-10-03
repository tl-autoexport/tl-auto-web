-- Canonical read model; the existing public catalogue/functions remain unchanged until UI deployment.
do $view$
declare projection text;
begin
 select string_agg(case column_name
   when 'brand' then 'coalesce(n.brand,c.brand) as brand'
   when 'model' then 'coalesce(n.model,c.model) as model'
   when 'trim' then 'case when n.car_id is not null then n.trim_label else c.trim end as trim'
   when 'generation' then 'case when n.car_id is not null then n.generation_label else c.generation end as generation'
   when 'generation_code' then 'case when n.generation_label is null then c.generation_code when n.generation_label ~ ''^[A-Za-z][A-Za-z0-9-]*$'' then lower(n.generation_label) else ''ordinal:'' || n.brand || '':'' || n.model || '':'' || n.generation_label end as generation_code'
   else 'c.' || quote_ident(column_name) end, ', ' order by ordinal_position) into projection
 from information_schema.columns where table_schema='public' and table_name='cars';
 execute 'create or replace view public.catalog_display_cars with (security_invoker=true) as select ' || projection ||
 ',n.generation_label,n.modification_label,n.version_line,n.compact_version,n.rules_version naming_rules_version from public.cars c left join public.catalog_vehicle_names n on n.car_id=c.id';
end $view$;
revoke all on public.catalog_display_cars from anon,authenticated;
grant select on public.catalog_display_cars to service_role;

CREATE OR REPLACE FUNCTION public.catalog_display_match(c public.catalog_display_cars, f jsonb, omit text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
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
    and (coalesce(omit,'') = any(array['brand','model']) or f->>'model' is null or c.model = f->>'model')
    and (coalesce(omit,'') = any(array['brand','model','generation']) or f->>'generation' is null or c.generation_code = f->>'generation')
    and (coalesce(omit,'') = any(array['brand','model','generation','modification']) or f->>'modification' is null or c.modification_label = f->>'modification')
    and (coalesce(omit,'') = any(array['brand','model','generation','modification','trim']) or f->>'trim' is null or c.trim = f->>'trim')
    and (omit is not distinct from 'fuel' or f->>'fuel' is null or c.fuel_type = f->>'fuel')
    and (omit is not distinct from 'drive' or f->>'drive' is null or c.drive_type = any(case f->>'drive' when 'FWD' then array['FWD','Передний','전륜','전륜구동'] when 'RWD' then array['RWD','Задний','후륜','후륜구동'] when '2WD' then array['2WD','2륜','2륜구동'] when '4WD' then array['4WD','AWD','4륜','4륜구동','사륜','사륜구동'] else array[f->>'drive'] end))
    and (omit is not distinct from 'transmission' or f->>'transmission' is null or c.transmission = any(case f->>'transmission' when 'automatic' then array['automatic','auto','Автомат','АКПП','오토','오토(A/T)'] when 'manual' then array['manual','Механика','수동','수동(M/T)'] else array[f->>'transmission'] end))
    and (omit is not distinct from 'body' or f->>'body' is null or c.body_type = any(case f->>'body' when 'Кроссовер' then array['Кроссовер','SUV'] when 'Седан' then array['Седан','sedan','Sedan','Среднеразмерный автомобиль','Большой автомобиль','준중형차','중형차','대형차'] when 'Хэтчбек' then array['Хэтчбек','hatchback','Компактный автомобиль','Микроавтомобиль','소형차'] when 'Универсал' then array['Универсал','wagon'] when 'Минивэн' then array['Минивэн','minivan','RV','승합차'] when 'Малолитражка' then array['Малолитражка','경차'] when 'Спорткар' then array['Спорткар','스포츠카'] when 'Другой' then array['Другой','Коммерческий автомобиль','화물차'] when 'Коммерческий автомобиль' then array['Коммерческий автомобиль','화물차'] else array[f->>'body'] end))
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
$function$
;
CREATE OR REPLACE FUNCTION public.catalog_display_facets(f jsonb)
 RETURNS TABLE(axis text, value text, label text, cars integer, sort_order integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  with
  brand_axis as (
    select 'brand'::text as axis, c.brand as value, c.brand as label, count(*)::int as cars, null::int as sort_order
    from public.catalog_display_cars c where public.catalog_display_match(c, f, 'brand') and c.brand is not null group by c.brand
  ),
  model_axis as (
    select 'model'::text, c.model, c.model, count(*)::int, null::int
    from public.catalog_display_cars c where public.catalog_display_match(c, f, 'model') and c.model is not null group by c.model
  ),
  generation_axis as (
    select 'generation'::text,c.generation_code,min(c.generation_label),count(*)::int,null::int
    from public.catalog_display_cars c where public.catalog_display_match(c,f,'generation')
    and c.generation_code is not null and c.generation_label is not null group by c.generation_code
  ),
  modification_axis as (
    select 'modification'::text,c.modification_label,c.modification_label,count(*)::int,null::int
    from public.catalog_display_cars c where public.catalog_display_match(c,f,'modification') and c.modification_label is not null group by c.modification_label
  ),
  trim_axis as (
    select 'trim'::text,c.trim,c.trim,count(*)::int,null::int
    from public.catalog_display_cars c where public.catalog_display_match(c,f,'trim') and c.trim is not null group by c.trim
  ),
  fuel_axis as (
    select 'fuel'::text, c.fuel_type, c.fuel_type, count(*)::int, null::int
    from public.catalog_display_cars c where public.catalog_display_match(c, f, 'fuel') and c.fuel_type is not null group by c.fuel_type
  ),
  drive_axis as (
    select 'drive'::text, c.drive_type, c.drive_type, count(*)::int, null::int
    from public.catalog_display_cars c where public.catalog_display_match(c, f, 'drive') and c.drive_type is not null group by c.drive_type
  ),
  transmission_axis as (
    select 'transmission'::text, c.transmission, c.transmission, count(*)::int, null::int
    from public.catalog_display_cars c where public.catalog_display_match(c, f, 'transmission') and c.transmission is not null group by c.transmission
  ),
  body_axis as (
    select 'body'::text, c.body_type, c.body_type, count(*)::int, null::int
    from public.catalog_display_cars c where public.catalog_display_match(c, f, 'body') and c.body_type is not null group by c.body_type
  ),
  color_axis as (
    select 'color'::text, c.color, c.color, count(*)::int, null::int
    from public.catalog_display_cars c where public.catalog_display_match(c, f, 'color') and c.color is not null group by c.color
  ),
  power_axis as (
    select 'power_band'::text,
           case when c.power_hp <= 160 then 'up_to_160' else 'over_160' end,
           case when c.power_hp <= 160 then 'до 160 л.с.' else 'свыше 160 л.с.' end,
           count(*)::int, null::int
    from public.catalog_display_cars c where public.catalog_display_match(c, f, 'power') and c.power_hp is not null
    group by 2, 3
  ),
  accident_axis as (
    select 'no_accident'::text, 'confirmed'::text, 'Без ДТП (подтверждено)'::text, count(*)::int, null::int
    from public.catalog_display_cars c where public.catalog_display_match(c, f, 'accident') and c.accident_count = 0
  ),
  insurance_axis as (
    select 'no_insurance'::text, 'confirmed'::text, 'Без страховых (подтверждено)'::text, count(*)::int, null::int
    from public.catalog_display_cars c where public.catalog_display_match(c, f, 'insurance') and c.insurance_payout_count = 0
  )
  select * from brand_axis
  union all select * from model_axis
  union all select * from generation_axis
  union all select * from modification_axis
  union all select * from trim_axis
  union all select * from fuel_axis
  union all select * from drive_axis
  union all select * from transmission_axis
  union all select * from body_axis
  union all select * from color_axis
  union all select * from power_axis
  union all select * from accident_axis
  union all select * from insurance_axis
$function$
;
CREATE OR REPLACE FUNCTION public.catalog_display_listing_count(f jsonb)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select count(*)::int from public.catalog_display_cars c where public.catalog_display_match(c, f)
$function$
;

revoke all on function public.catalog_display_match(public.catalog_display_cars,jsonb,text) from public,anon,authenticated;
revoke all on function public.catalog_display_facets(jsonb) from public,anon,authenticated;
revoke all on function public.catalog_display_listing_count(jsonb) from public,anon,authenticated;
grant execute on function public.catalog_display_match(public.catalog_display_cars,jsonb,text) to service_role;
grant execute on function public.catalog_display_facets(jsonb) to service_role;
grant execute on function public.catalog_display_listing_count(jsonb) to service_role;
notify pgrst, 'reload schema';
