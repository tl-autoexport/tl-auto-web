-- Ignore legacy primary flags/order for standard Encar exterior frames.
create or replace function public.refresh_car_catalog_media_summary(target_car_id uuid)
returns void language sql set search_path = public as $$
  update public.cars c set
    primary_image_url = cover.url,
    primary_thumbnail_url = coalesce(cover.thumbnail_url, cover.url),
    media_count = (select count(*) from public.car_media where car_id = target_car_id and media_type = 'image')
  from (select picked.url, picked.thumbnail_url from (select 1) seed
    left join lateral (
      select m.url, m.thumbnail_url from public.car_media m
      where m.car_id = target_car_id and m.media_type = 'image'
        and coalesce(lower(m.category), '') !~ '^(inner|inside|inside_image|interior|option|condition|scratch|inspection_record|underbody|thermal|thermal_reference|exterior_360_thumbnail|encar_inspection_document)($|_)'
      order by
        case
          when m.url ~* '^https://ci\.encar\.com/carpicture.*_001\.(jpg|jpeg|webp)(\?|$)' then 1000
          when m.url ~* '^https://ci\.encar\.com/carpicture.*_003\.(jpg|jpeg|webp)(\?|$)' then 900
          when m.url ~* '^https://ci\.encar\.com/carpicture.*_002\.(jpg|jpeg|webp)(\?|$)' then 800
          when m.url ~* '^https://ci\.encar\.com/carpicture.*_004\.(jpg|jpeg|webp)(\?|$)' then 700
          when m.url ~* '^https://ci\.encar\.com/carpicture' then 100
          when lower(m.category) in ('outer', 'outside', 'outside_image', 'exterior') then 400
          when lower(m.category) = 'thumbnail' then 300
          when lower(m.category) = 'photo' then 260
          else 120
        end desc, m.is_primary desc, m.sort_order, m.created_at, m.url
      limit 1
    ) picked on true
  ) cover where c.id = target_car_id;
$$;

-- Reconcile existing cached covers as well as future media changes.
do $$ declare target uuid;
begin
  for target in select id from public.cars where primary_source in ('encar', 'chestny_prigon') loop
    perform public.refresh_car_catalog_media_summary(target);
  end loop;
end $$;
