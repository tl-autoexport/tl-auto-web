-- Stable, curated option keys for the shared catalogue appearance filters.
-- Schema only. Backfill separately in bounded transactions before enabling UI.

create or replace function public.catalog_filter_option_id(option_name text)
returns text
language sql
immutable
parallel safe
as $$
  select case lower(btrim(coalesce(option_name, '')))
    when 'камера заднего вида' then 'rear-camera'
    when '후방 카메라' then 'rear-camera'
    when 'круговой обзор 360°' then 'surround-view'
    when '360도 카메라' then 'surround-view'
    when '360도 어라운드 뷰' then 'surround-view'
    when '서라운드뷰 모니터(svm)' then 'surround-view'
    when 'передние и задние парктроники' then 'parking-sensors-front-rear'
    when '주차감지센서(전방, 후방)' then 'parking-sensors-front-rear'
    when 'контроль слепых зон' then 'blind-spot'
    when '후측방 경보 시스템' then 'blind-spot'
    when 'боковые подушки безопасности' then 'side-airbags'
    when '에어백(사이드)' then 'side-airbags'
    when 'контроль выхода из полосы ldws' then 'lane-warning'
    when '차선이탈 경보 시스템(ldws)' then 'lane-warning'
    when 'антиблокировочная система abs' then 'abs'
    when '브레이크 잠김 방지(abs)' then 'abs'
    when 'система стабилизации esc' then 'stability-control'
    when '차체자세 제어장치(esc)' then 'stability-control'
    when 'адаптивный круиз-контроль' then 'cruise-adaptive'
    when '크루즈 컨트롤(어댑티브)' then 'cruise-adaptive'
    when '스마트 크루즈 컨트롤(scc)' then 'cruise-adaptive'
    when '어댑티브 크루즈컨트롤(acc)' then 'cruise-adaptive'
    when 'люк' then 'sunroof'
    when '선루프' then 'sunroof'
    when 'панорамная крыша' then 'panoramic-roof'
    when '파노라마 선루프' then 'panoramic-roof'
    when 'подогрев передних сидений' then 'heated-front-seats'
    when '열선시트(앞좌석)' then 'heated-front-seats'
    when '열선시트(앞좌석, 뒷좌석)' then 'heated-front-seats'
    when '열선시트(앞·뒷좌석)' then 'heated-front-seats'
    when 'вентиляция передних сидений' then 'ventilated-front-seats'
    when '통풍시트(운전석, 동승석)' then 'ventilated-front-seats'
    when '통풍시트(앞좌석)' then 'ventilated-front-seats'
    when 'кожаный салон' then 'leather-seats'
    when '가죽시트' then 'leather-seats'
    when 'электропривод багажника' then 'electric-trunk'
    when '전동식 트렁크' then 'electric-trunk'
    when '파워 전동 트렁크' then 'electric-trunk'
    when '파워 테일게이트(전동식 트렁크)' then 'electric-trunk'
    when 'автоматический климат-контроль' then 'auto-climate'
    when '풀오토 에어컨' then 'auto-climate'
    when '2존 풀오토에어컨' then 'auto-climate'
    when '전자동에어컨' then 'auto-climate'
    when '자동 에어컨' then 'auto-climate'
    when 'электростеклоподъемники' then 'power-windows'
    when 'электростеклоподъёмники' then 'power-windows'
    when '파워 윈도우' then 'power-windows'
    when 'электроскладывание зеркал' then 'folding-mirrors'
    when '전동접이미러' then 'folding-mirrors'
    when '전동접이 사이드 미러' then 'folding-mirrors'
    when 'электрорегулировка передних сидений' then 'electric-front-seats'
    when '전동시트(앞좌석)' then 'electric-front-seats'
    when '전동시트(운전석, 동승석)' then 'electric-front-seats'
    when 'подогрев руля' then 'heated-steering-wheel'
    when '열선 스티어링 휠' then 'heated-steering-wheel'
    when 'электронный стояночный тормоз epb' then 'electric-parking-brake'
    when '전자식 주차브레이크(epb)' then 'electric-parking-brake'
    when '전자식 파킹브레이크(epb)' then 'electric-parking-brake'
    when 'навигация' then 'navigation'
    when '내비게이션' then 'navigation'
    when '내비게이션(정품)' then 'navigation'
    when 'проекционный дисплей hud' then 'head-up-display'
    when '헤드업 디스플레이(hud)' then 'head-up-display'
    when 'смарт-ключ' then 'smart-key'
    when '스마트키' then 'smart-key'
    else null
  end
$$;

alter table public.cars
  add column if not exists filter_option_ids text[] not null default '{}'::text[];

create index if not exists cars_filter_option_ids_gin_idx
  on public.cars using gin (filter_option_ids);

create or replace function public.refresh_car_filter_option_ids(target_car_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Serialize concurrent option changes for a car before taking a fresh
  -- READ COMMITTED snapshot of its options. Always lock in UUID order.
  perform id from public.cars where id = any(target_car_ids) order by id for update;
  with keys as materialized (
    select car.id, coalesce(array_agg(distinct mapped.key order by mapped.key)
      filter (where mapped.key is not null), '{}'::text[]) as ids
    from public.cars car
    left join public.car_options option_row on option_row.car_id = car.id
      and option_row.is_present is true
    left join lateral (values
      (public.catalog_filter_option_id(option_row.name_ru)),
      (public.catalog_filter_option_id(option_row.name_original))
    ) mapped(key) on true
    where car.id = any(target_car_ids)
    group by car.id
  )
  update public.cars car set filter_option_ids = keys.ids
  from keys where car.id = keys.id and car.filter_option_ids is distinct from keys.ids;
end
$$;

create or replace function public.sync_car_filter_option_ids()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare ids uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct car_id) into ids from new_options;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct car_id) into ids from old_options;
  else
    select array_agg(distinct car_id) into ids from (
      select car_id from new_options union select car_id from old_options
    ) changed;
  end if;
  if ids is not null then perform public.refresh_car_filter_option_ids(ids); end if;
  return null;
end
$$;

drop trigger if exists car_options_sync_filter_option_ids on public.car_options;
drop trigger if exists car_options_filter_insert on public.car_options;
drop trigger if exists car_options_filter_update on public.car_options;
drop trigger if exists car_options_filter_delete on public.car_options;
create trigger car_options_filter_insert after insert on public.car_options
referencing new table as new_options for each statement
execute function public.sync_car_filter_option_ids();
create trigger car_options_filter_update after update on public.car_options
referencing old table as old_options new table as new_options for each statement
execute function public.sync_car_filter_option_ids();
create trigger car_options_filter_delete after delete on public.car_options
referencing old table as old_options for each statement
execute function public.sync_car_filter_option_ids();

-- Add the indexed array to the existing display read-model without changing
-- its canonical vehicle naming projection or any calculation fields.
do $view$
declare projection text;
begin
  select string_agg(case column_name
    when 'brand' then 'coalesce(n.brand,c.brand) as brand'
    when 'model' then 'coalesce(n.model,c.model) as model'
    when 'trim' then 'case when n.car_id is not null then n.trim_label else c.trim end as trim'
    when 'generation' then 'case when n.car_id is not null then n.generation_label else c.generation end as generation'
    when 'generation_code' then 'case when n.generation_label is null then c.generation_code when n.generation_label ~ ''^[A-Za-z][A-Za-z0-9-]*$'' then lower(n.generation_label) else ''ordinal:'' || n.brand || '':'' || n.model || '':'' || n.generation_label end as generation_code'
    else 'c.' || quote_ident(column_name) end, ', ' order by ordinal_position)
    into projection
  from information_schema.columns
  where table_schema = 'public' and table_name = 'cars'
    and column_name not in ('catalog_sort_published_at', 'filter_option_ids');

  execute 'create or replace view public.catalog_display_cars with (security_invoker=true) as select '
    || projection
    || ',n.generation_label,n.modification_label,n.version_line,n.compact_version,n.rules_version naming_rules_version'
    || ',c.catalog_sort_published_at,c.filter_option_ids'
    || ' from public.cars c left join public.catalog_vehicle_names n on n.car_id=c.id';
end
$view$;

create or replace function public.catalog_display_match(c public.catalog_display_cars, f jsonb, omit text default null)
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
    and (omit is not distinct from 'brand' or f->>'brand' is null or public.normalize_catalog_brand(c.brand) = public.normalize_catalog_brand(f->>'brand'))
    and (coalesce(omit,'') = any(array['brand','model']) or f->>'model' is null or c.model = f->>'model')
    and (coalesce(omit,'') = any(array['brand','model','generation']) or f->>'generation' is null or c.generation_code = f->>'generation')
    and (coalesce(omit,'') = any(array['brand','model','generation','modification']) or f->>'modification' is null or c.modification_label = f->>'modification')
    and (coalesce(omit,'') = any(array['brand','model','generation','modification','trim']) or f->>'trim' is null or c.trim = f->>'trim')
    and (omit is not distinct from 'fuel' or f->>'fuel' is null or c.fuel_type = f->>'fuel')
    and (omit is not distinct from 'drive' or f->>'drive' is null or c.drive_type = any(case f->>'drive' when 'FWD' then array['FWD','Передний','전륜','전륜구동'] when 'RWD' then array['RWD','Задний','후륜','후륜구동'] when '2WD' then array['2WD','2륜','2륜구동'] when '4WD' then array['4WD','AWD','4륜','4륜구동','사륜','사륜구동'] else array[f->>'drive'] end))
    and (omit is not distinct from 'transmission' or f->>'transmission' is null or c.transmission = any(case f->>'transmission' when 'automatic' then array['automatic','auto','Автомат','АКПП','오토','오토(A/T)'] when 'manual' then array['manual','Механика','수동','수동(M/T)'] else array[f->>'transmission'] end))
    and (omit is not distinct from 'body' or f->>'body' is null or c.body_type = any(case f->>'body' when 'Кроссовер' then array['Кроссовер','SUV'] when 'Седан' then array['Седан','sedan','Sedan','Среднеразмерный автомобиль','Большой автомобиль','준중형차','중형차','대형차'] when 'Хэтчбек' then array['Хэтчбек','hatchback','Компактный автомобиль','Микроавтомобиль','소형차'] when 'Универсал' then array['Универсал','wagon'] when 'Минивэн' then array['Минивэн','minivan','RV','승합차'] when 'Малолитражка' then array['Малолитражка','경차'] when 'Спорткар' then array['Спорткар','스포츠카'] when 'Другой' then array['Другой','Коммерческий автомобиль','화물차'] when 'Коммерческий автомобиль' then array['Коммерческий автомобиль','화물차'] else array[f->>'body'] end))
    and (omit is not distinct from 'color' or f->>'color' is null or c.color = f->>'color')
    and (coalesce(omit,'') = any(array['color','colors']) or coalesce(jsonb_array_length(f->'colorValues'), 0) = 0 or c.color = any(array(select jsonb_array_elements_text(f->'colorValues'))))
    and (coalesce(omit,'') = any(array['options']) or coalesce(jsonb_array_length(f->'options'), 0) = 0 or c.filter_option_ids @> array(select jsonb_array_elements_text(f->'options')))
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

revoke all on function public.catalog_display_match(public.catalog_display_cars,jsonb,text) from public, anon, authenticated;
grant execute on function public.catalog_display_match(public.catalog_display_cars,jsonb,text) to service_role;

-- The cursor-based result page switches read models after identity selection;
-- keep the indexed option keys available on both branches of that view.
do $view$
declare named_projection text; fallback_projection text;
begin
  select string_agg(case column_name
    when 'brand' then 'n.brand'
    when 'model' then 'n.model'
    when 'trim' then 'n.trim_label as trim'
    when 'generation' then 'n.generation_label as generation'
    when 'generation_code' then 'case when n.generation_label is null then c.generation_code when n.generation_label ~ ''^[A-Za-z][A-Za-z0-9-]*$'' then lower(n.generation_label) else ''ordinal:'' || n.brand || '':'' || n.model || '':'' || n.generation_label end as generation_code'
    else 'c.' || quote_ident(column_name) end, ', ' order by ordinal_position),
    string_agg('c.' || quote_ident(column_name), ', ' order by ordinal_position)
    into named_projection, fallback_projection
  from information_schema.columns
  where table_schema = 'public' and table_name = 'cars'
    and column_name not in ('catalog_sort_published_at', 'filter_option_ids');

  execute 'create or replace view public.catalog_display_cascade_cars with (security_invoker=true) as select '
    || named_projection
    || ',n.generation_label,n.modification_label,n.version_line,n.compact_version,n.rules_version naming_rules_version,c.catalog_sort_published_at,c.filter_option_ids'
    || ' from public.cars c join public.catalog_vehicle_names n on n.car_id=c.id union all select '
    || fallback_projection
    || ',null::text as generation_label,null::text as modification_label,null::text as version_line,null::text as compact_version,null::text as naming_rules_version,c.catalog_sort_published_at,c.filter_option_ids'
    || ' from public.cars c where not exists (select 1 from public.catalog_vehicle_names n where n.car_id=c.id)';
end
$view$;

revoke all on function public.catalog_filter_option_id(text) from public, anon, authenticated;
revoke all on function public.refresh_car_filter_option_ids(uuid[]) from public, anon, authenticated;
revoke all on function public.sync_car_filter_option_ids() from public, anon, authenticated;

-- The facet RPC has a generated SQL predicate (separate from the listing
-- predicate); extend it too so counts and cascade choices honor these filters.
do $facets$
declare definition text;
begin
  select pg_get_functiondef('public.catalog_display_facet_options(jsonb,text[])'::regprocedure)
    into definition;
  if position('f->''colorValues''' in definition) = 0 then
    definition := replace(definition, '$predicate$;', $extra$
    and (coalesce(omit,'') = any(array['color','colors']) or coalesce(jsonb_array_length(f->'colorValues'), 0) = 0 or c.color = any(array(select jsonb_array_elements_text(f->'colorValues'))))
    and (coalesce(omit,'') = any(array['options']) or coalesce(jsonb_array_length(f->'options'), 0) = 0 or c.filter_option_ids @> array(select jsonb_array_elements_text(f->'options')))
$predicate$;$extra$);
    if position('f->''colorValues''' in definition) = 0 then
      raise exception 'Could not extend catalogue facet predicate';
    end if;
    execute definition;
  end if;
end
$facets$;

notify pgrst, 'reload schema';
