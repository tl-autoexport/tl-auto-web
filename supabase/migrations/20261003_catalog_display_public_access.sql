-- Allow the public storefront to read the safe display projection with its
-- publishable Supabase key. The view remains security-invoker, so the existing
-- cars RLS policy still limits rows to available cars.
revoke all on public.catalog_display_cars from anon, authenticated;
grant select on public.catalog_display_cars to anon, authenticated, service_role;
-- The public storefront uses the same read-only car grant as the legacy view;
-- row access remains constrained by "Public can read available cars" RLS.
grant select on public.cars to anon, authenticated;

-- A security-invoker view also needs column-level access to its joined table.
-- Expose only canonical display fields; source evidence and run metadata stay
-- inaccessible to public roles. RLS limits rows to publicly visible cars.
alter table public.catalog_vehicle_names enable row level security;
drop policy if exists "Public can read names for published catalog cars"
  on public.catalog_vehicle_names;
create policy "Public can read names for published catalog cars"
  on public.catalog_vehicle_names
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.cars c
      where c.id = catalog_vehicle_names.car_id
        and c.is_available = true
        and c.primary_source in ('encar', 'chestny_prigon')
        and c.fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric', 'lpg')
        and (c.fuel_type = 'electric' or (c.price_rub is not null and c.power_hp is not null))
    )
  );
revoke all on public.catalog_vehicle_names from anon, authenticated;
grant select (
  car_id,
  rules_version,
  brand,
  model,
  generation_label,
  modification_label,
  trim_label,
  version_line,
  compact_version
) on public.catalog_vehicle_names to anon, authenticated;

-- Facets and counts disclose only aggregated public catalogue information.
grant execute on function public.catalog_display_facets(jsonb) to anon, authenticated;
grant execute on function public.catalog_display_listing_count(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
