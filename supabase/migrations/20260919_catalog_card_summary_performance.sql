-- Compact data used by public catalogue cards.  Full galleries remain in
-- car_media and are loaded only on a vehicle page.
alter table public.cars
  add column if not exists primary_image_url text,
  add column if not exists primary_thumbnail_url text,
  add column if not exists media_count integer not null default 0,
  add column if not exists seats integer;

create or replace function public.refresh_car_catalog_media_summary(target_car_id uuid)
returns void
language sql
set search_path = public
as $$
  update public.cars as c
  set
    primary_image_url = summary.url,
    primary_thumbnail_url = summary.thumbnail_url,
    media_count = summary.media_count
  from (
    select
      count(*) filter (where m.media_type = 'image')::integer as media_count,
      (
        select candidate.url
        from public.car_media as candidate
        where candidate.car_id = target_car_id
          and candidate.media_type = 'image'
          and coalesce(lower(candidate.category), '') not in (
            'inner', 'inside', 'inside_image', 'interior', 'option', 'condition',
            'scratch', 'inspection_record', 'underbody', 'thermal',
            'thermal_reference', 'exterior_360_thumbnail'
          )
        order by
          case
            when lower(coalesce(candidate.category, '')) in ('outside', 'outside_image', 'exterior', 'outer') then 1
            when lower(coalesce(candidate.category, '')) = 'thumbnail' then 2
            when lower(coalesce(candidate.category, '')) = 'photo' then 3
            else 4
          end,
          candidate.sort_order asc,
          candidate.created_at asc
        limit 1
      ) as url,
      (
        select coalesce(candidate.thumbnail_url, candidate.url)
        from public.car_media as candidate
        where candidate.car_id = target_car_id
          and candidate.media_type = 'image'
          and coalesce(lower(candidate.category), '') not in (
            'inner', 'inside', 'inside_image', 'interior', 'option', 'condition',
            'scratch', 'inspection_record', 'underbody', 'thermal',
            'thermal_reference', 'exterior_360_thumbnail'
          )
        order by
          case
            when lower(coalesce(candidate.category, '')) in ('outside', 'outside_image', 'exterior', 'outer') then 1
            when lower(coalesce(candidate.category, '')) = 'thumbnail' then 2
            when lower(coalesce(candidate.category, '')) = 'photo' then 3
            else 4
          end,
          candidate.sort_order asc,
          candidate.created_at asc
        limit 1
      ) as thumbnail_url
    from public.car_media as m
    where m.car_id = target_car_id
  ) as summary
  where c.id = target_car_id;
$$;

create or replace function public.car_media_refresh_catalog_summary()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.refresh_car_catalog_media_summary(coalesce(new.car_id, old.car_id));
  if tg_op = 'UPDATE' and new.car_id is distinct from old.car_id then
    perform public.refresh_car_catalog_media_summary(old.car_id);
  end if;
  return null;
end;
$$;

drop trigger if exists car_media_catalog_summary_trigger on public.car_media;
create trigger car_media_catalog_summary_trigger
after insert or update or delete on public.car_media
for each row execute function public.car_media_refresh_catalog_summary();

create or replace function public.cars_refresh_catalog_seats()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.vehicle_specs ->> 'seats', '') ~ '^\d+$' then
    new.seats := (new.vehicle_specs ->> 'seats')::integer;
  elsif coalesce(new.vehicle_specs ->> 'seat_count', '') ~ '^\d+$' then
    new.seats := (new.vehicle_specs ->> 'seat_count')::integer;
  end if;
  return new;
end;
$$;

drop trigger if exists cars_catalog_seats_trigger on public.cars;
create trigger cars_catalog_seats_trigger
before insert or update of vehicle_specs on public.cars
for each row execute function public.cars_refresh_catalog_seats();

-- One initial reconciliation.  Subsequent changes are handled by the trigger.
do $$
declare target uuid;
begin
  for target in select id from public.cars loop
    perform public.refresh_car_catalog_media_summary(target);
  end loop;
end $$;

update public.cars
set seats = case
  when coalesce(vehicle_specs ->> 'seats', '') ~ '^\d+$' then (vehicle_specs ->> 'seats')::integer
  when coalesce(vehicle_specs ->> 'seat_count', '') ~ '^\d+$' then (vehicle_specs ->> 'seat_count')::integer
  else seats
end
where vehicle_specs is not null;

-- These predicates exactly match the public catalogue.  They support
-- keyset pagination without sorting the entire active catalogue.
create index if not exists cars_public_catalog_v2_fresh_idx
  on public.cars (source_updated_at desc nulls last, id)
  where is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric')
    and (fuel_type = 'electric' or (price_rub is not null and power_hp is not null));

create index if not exists cars_public_catalog_v2_price_asc_idx
  on public.cars (price_rub asc nulls last, id)
  where is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric')
    and (fuel_type = 'electric' or (price_rub is not null and power_hp is not null));

create index if not exists cars_public_catalog_v2_price_desc_idx
  on public.cars (price_rub desc nulls last, id)
  where is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric')
    and (fuel_type = 'electric' or (price_rub is not null and power_hp is not null));

create index if not exists cars_public_catalog_v2_mileage_idx
  on public.cars (mileage_km asc nulls last, id)
  where is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric')
    and (fuel_type = 'electric' or (price_rub is not null and power_hp is not null));

create index if not exists cars_public_catalog_v2_year_idx
  on public.cars (year desc nulls last, id)
  where is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric')
    and (fuel_type = 'electric' or (price_rub is not null and power_hp is not null));

create index if not exists cars_public_catalog_v2_brand_model_idx
  on public.cars (brand, model, source_updated_at desc nulls last, id)
  where is_available = true
    and primary_source in ('encar', 'chestny_prigon')
    and fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric')
    and (fuel_type = 'electric' or (price_rub is not null and power_hp is not null));

create extension if not exists pg_trgm;
create index if not exists cars_catalog_brand_trgm_idx on public.cars using gin (brand gin_trgm_ops);
create index if not exists cars_catalog_model_trgm_idx on public.cars using gin (model gin_trgm_ops);
create index if not exists cars_catalog_trim_trgm_idx on public.cars using gin (trim gin_trgm_ops);
