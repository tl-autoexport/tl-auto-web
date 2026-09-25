-- Close the public API leak of the raw vehicle number.
--
-- `cars.vehicle_no_masked` currently holds the *raw* plate for existing rows (the masking
-- trigger only affects new writes), and the hardening migration
-- `20260730_public_access_hardening.sql` granted `anon`/`authenticated` SELECT on the whole
-- `cars` table, with an RLS policy that allows reading every available row. A column-level
-- revoke cannot beat a table-level grant, so the table grant is removed and only the columns
-- the public storefront actually reads are granted back.
--
-- The server-side jobs (history requests, imports, publishing) use the service role and are
-- unaffected. Anything that needs the raw number must move to a private store; it must not be
-- granted here.
--
-- Two catalog functions are SECURITY INVOKER and read `public.cars`, so they would break once
-- the table grant is gone. They are switched to SECURITY DEFINER with a locked search_path,
-- matching `catalog_public_metrics`, which is already definer.

alter function public.catalog_facets(jsonb) security definer;
alter function public.catalog_facets(jsonb) set search_path = public, extensions;
alter function public.catalog_listing_count(jsonb) security definer;
alter function public.catalog_listing_count(jsonb) set search_path = public, extensions;

revoke select on table public.cars from anon, authenticated;

-- Exactly what the storefront reads: the catalog/card select lists, the facet and sitemap
-- selects, the count query, and every column used in a filter or an order by.
-- Deliberately absent: vehicle_no_masked, vehicle_no_hash, vin_masked, and every ingestion or
-- calculation column that is not part of the public presentation.
grant select (
  id, primary_source, source_kind, source_id, source_url,
  published_at, published_at_source, catalog_added_at, created_at, source_updated_at,
  brand, model, trim, badge, badge_detail, body_type, year, registration_month, generation_code,
  mileage_km, price_krw, price_rub, engine_cc, power_hp, power_confidence, power_finality,
  power_resolution_note, fuel_type, transmission, drive_type, color, owners_count,
  accident_count, insurance_payout_count, insurance_payout_total_krw,
  has_360_exterior, has_360_interior, has_heydealer_eye, has_obd_scan,
  has_underbody_photo, has_thermal_images, data_confidence,
  vehicle_specs, primary_image_url, primary_thumbnail_url, media_count, seats,
  is_available
) on table public.cars to anon, authenticated;

comment on column public.cars.vehicle_no_masked is
  'Display value of the plate. Raw values must move to a private store; this column is intentionally not granted to anon/authenticated.';
comment on column public.cars.vehicle_no_hash is
  'Hash for duplicate detection only. Never granted to anon/authenticated.';
