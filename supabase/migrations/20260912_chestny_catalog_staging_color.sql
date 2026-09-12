-- Retain the source colour during staging so public-card promotion cannot drop it.
alter table public.chestny_catalog_staging
  add column if not exists exterior_color text;

comment on column public.chestny_catalog_staging.exterior_color is
  'Exterior colour supplied by the Chesty source; normalized before public display.';
