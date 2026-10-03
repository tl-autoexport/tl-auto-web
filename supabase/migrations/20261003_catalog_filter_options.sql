-- One bounded query instead of eleven sequential public pages on a cold server.
drop function if exists public.catalog_display_filter_options();
create function public.catalog_display_filter_options()
returns jsonb
language sql stable security definer set search_path = public
as $$
 select coalesce(jsonb_agg(options),'[]'::jsonb) from (
 select c.brand,c.model,c.trim,c.body_type,c.fuel_type,c.transmission,c.drive_type,c.color,c.owners_count,count(*) as cars
 from public.catalog_display_cars c
 where c.is_available and c.primary_source in ('encar','chestny_prigon')
 and c.fuel_type in ('gasoline','diesel','hybrid','electric','lpg')
 and (c.fuel_type='electric' or (c.price_rub is not null and c.power_hp is not null))
 group by c.brand,c.model,c.trim,c.body_type,c.fuel_type,c.transmission,c.drive_type,c.color,c.owners_count
 ) options;
$$;
revoke all on function public.catalog_display_filter_options() from public;
grant execute on function public.catalog_display_filter_options() to anon,authenticated,service_role;
notify pgrst,'reload schema';
