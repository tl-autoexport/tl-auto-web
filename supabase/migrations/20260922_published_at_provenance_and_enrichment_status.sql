-- Provenance for the publication timestamp and an explicit enrichment status.
--
-- `published_at` is shown to customers as "В продаже N дней в Корее", so it must
-- never be invented. The Encar payload we store does carry an advertisement
-- timestamp in `detail.manage.firstAdvertisedDateTime`; the earlier assumption
-- that it carries no listing date at all was wrong and is corrected here. It is
-- used only when it is actually present, so a value can only be one of:
--   source_payload      the date came from the source payload itself;
--   source_snapshot     the date came from a stored source snapshot;
--   internal_created_at we first saw this listing at our own created_at;
--   internal_publish_time our publisher set it when the card was published;
--   unknown             nothing provable exists.
-- Distinguishing the internal cases matters because the card label presents the
-- number as time on sale in Korea, and only a source date supports that claim.
--
-- `enrichment_status` already exists on `cars` with a different vocabulary
-- (source_only, heydealer_matched, merged_duplicate), so the Encar enrichment
-- coverage gets its own column instead of overloading that one.
alter table public.cars
  add column if not exists published_at_source text
    check (published_at_source in ('source_payload', 'source_snapshot', 'internal_created_at', 'internal_publish_time', 'unknown')),
  add column if not exists encar_enrichment_status text
    check (encar_enrichment_status in ('applied', 'available_not_applied', 'absent', 'unavailable'));

comment on column public.cars.published_at_source is
  'Where published_at came from. Only source_payload and source_snapshot support the "time on sale in Korea" wording; the internal values describe our own timeline.';
comment on column public.cars.encar_enrichment_status is
  'Encar enrichment coverage for this card: applied, available but not applied, absent, or reported unavailable by the source.';

create index if not exists cars_enrichment_status_idx
  on public.cars(encar_enrichment_status) where is_available;
