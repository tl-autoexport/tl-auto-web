-- Read-only aggregates. Avoid passing the entire wide cars row to a predicate:
-- plan each requested axis against scalar display columns with bound filters.
create or replace function public.catalog_display_facet_options(f jsonb, requested_axes text[])
returns table(axis text, value text, label text, cars integer, sort_order integer)
language plpgsql stable security definer
set search_path = public, extensions
as $function$
declare
  selected_axis text;
  omitted_axis text;
  value_sql text;
  label_sql text;
  extra_sql text;
  predicate text := $predicate$    c.is_available
    and c.primary_source in ('encar', 'chestny_prigon')
    and c.fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric', 'lpg')
    and (c.fuel_type = 'electric' or (c.price_rub is not null and c.power_hp is not null))
    and (omit is not distinct from 'source' or f->>'source' is null or c.primary_source = f->>'source')
    and (
      omit is not distinct from 'brand'
      or f->>'brand' is null
      or (f->'brandValues' is not null and c.brand = any(array(select jsonb_array_elements_text(f->'brandValues'))))
      or (f->'brandValues' is null and public.normalize_catalog_brand(c.brand) = public.normalize_catalog_brand(f->>'brand'))
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
$predicate$;
begin
  foreach selected_axis in array requested_axes loop
    extra_sql := '';
    omitted_axis := selected_axis;
    case selected_axis
      when 'brand' then value_sql := 'c.brand';
      when 'model' then value_sql := 'c.model';
      when 'generation' then value_sql := 'c.generation_code'; extra_sql := ' and c.generation_label is not null';
      when 'modification' then value_sql := 'c.modification_label';
      when 'trim' then value_sql := 'c.trim';
      when 'fuel' then value_sql := 'c.fuel_type';
      when 'drive' then value_sql := 'c.drive_type';
      when 'transmission' then value_sql := 'c.transmission';
      when 'body' then value_sql := 'c.body_type';
      when 'color' then value_sql := 'c.color';
      when 'power_band' then
        omitted_axis := 'power';
        value_sql := $$case when c.power_hp <= 160 then 'up_to_160' else 'over_160' end$$;
        extra_sql := ' and c.power_hp is not null';
      when 'no_accident' then
        omitted_axis := 'accident'; value_sql := $$'confirmed'::text$$; extra_sql := ' and c.accident_count = 0';
      when 'no_insurance' then
        omitted_axis := 'insurance'; value_sql := $$'confirmed'::text$$; extra_sql := ' and c.insurance_payout_count = 0';
      when '__total' then value_sql := $$'total'::text$$;
      else raise exception 'Unsupported catalog facet axis' using errcode = '22023';
    end case;
    label_sql := case selected_axis
      when 'generation' then 'min(c.generation_label)'
      when 'power_band' then $$case when c.power_hp <= 160 then 'до 160 л.с.' else 'свыше 160 л.с.' end$$
      when 'no_accident' then $$'Без ДТП (подтверждено)'::text$$
      when 'no_insurance' then $$'Без страховых (подтверждено)'::text$$
      else value_sql end;
    return query execute format(
      'select %L::text, %s::text, %s::text, count(*)::int, null::int
       from public.catalog_display_cars c where %s %s and (%s) is not null%s',
      selected_axis, value_sql, label_sql,
      replace(replace(predicate, 'omit', quote_literal(omitted_axis)), 'f->', '$1->'),
      extra_sql, value_sql, case
        when selected_axis in ('no_accident','no_insurance','__total') then ''
        when selected_axis = 'generation' then ' group by 2'
        else ' group by 2,3' end
    ) using f;
  end loop;
end
$function$;

create or replace function public.catalog_display_listing_count(f jsonb)
returns integer language sql stable security definer set search_path = public, extensions
as $function$
  select cars from public.catalog_display_facet_options(f, array['__total']);
$function$;

-- Keep the existing contract working for older deployments during rollout.
create or replace function public.catalog_display_facets(f jsonb)
returns table(axis text, value text, label text, cars integer, sort_order integer)
language sql stable security definer set search_path = public, extensions
as $function$
  select * from public.catalog_display_facet_options(f, array[
    'brand','model','generation','modification','trim','fuel','drive',
    'transmission','body','color','power_band','no_accident','no_insurance']);
$function$;

revoke all on function public.catalog_display_facet_options(jsonb,text[]) from public;
grant execute on function public.catalog_display_facet_options(jsonb,text[]) to anon, authenticated, service_role;
notify pgrst, 'reload schema';
