-- migrate:non-transactional
-- Canonical names are used by every cascade level. Keep their small display
-- fields in a covering index instead of reading the wide evidence heap.
create index concurrently if not exists catalog_vehicle_names_cascade_idx
  on public.catalog_vehicle_names (brand, model, car_id)
  include (generation_label, modification_label, trim_label);
