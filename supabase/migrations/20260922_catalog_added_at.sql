-- A separate internal timestamp for "when the card entered our catalogue".
--
-- `published_at` means the advertisement date at the source, and the card shows
-- it as "В продаже N дней в Корее". Writing our own timestamps there — even with
-- a provenance column — turns an internal fact into a claim about the Korean
-- market, so the internal timeline gets its own field instead.
--
-- Rule from here on:
--   published_at           only a confirmed source date, otherwise null;
--   published_at_source    source_payload | source_snapshot when dated,
--                          unknown when the source date does not exist;
--   catalog_added_at       when the card entered TL Auto, always our own value.
alter table public.cars add column if not exists catalog_added_at timestamptz;

comment on column public.cars.catalog_added_at is
  'When the card entered the TL Auto catalogue. Internal timeline only; never presented as time on sale in Korea.';

create index if not exists cars_catalog_added_at_idx
  on public.cars(catalog_added_at) where is_available;
