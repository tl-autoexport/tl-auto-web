-- The canonical provenance constraint can be validated now.
--
-- It was added NOT VALID so existing rows were not rejected mid-rollout. The
-- backfill has filled `published_at_source`, `catalog_added_at` and
-- `encar_enrichment_status` for every published card, so the rule can be made
-- mandatory for the past as well as for future writes.
alter table public.cars validate constraint cars_published_requires_canonical_provenance;
