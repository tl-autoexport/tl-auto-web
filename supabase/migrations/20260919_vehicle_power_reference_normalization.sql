-- TL Auto: canonical keys for approved power-reference matches.
-- Raw values remain untouched; normalized keys are used only for matching.

alter table public.vehicle_power_spec_matches
  add column if not exists generation_normalized text,
  add column if not exists trim_normalized text,
  add column if not exists model_code_normalized text,
  add column if not exists engine_code_normalized text;

update public.vehicle_power_spec_matches
set
  generation_normalized = nullif(regexp_replace(lower(trim(regexp_replace(coalesce(generation, ''), '^.*\\(([^)]*)\\).*$', '\\1'))), '[\\s_-]+', '', 'g'), ''),
  trim_normalized = nullif(regexp_replace(lower(trim(coalesce(trim, ''))), '[\\s_-]+', ' ', 'g'), ''),
  model_code_normalized = nullif(regexp_replace(upper(trim(coalesce(model_code, ''))), '[\\s_-]+', '', 'g'), ''),
  engine_code_normalized = nullif(regexp_replace(upper(trim(coalesce(engine_code, ''))), '[\\s_-]+', '', 'g'), '');

create index if not exists vehicle_power_spec_matches_normalized_lookup_idx
  on public.vehicle_power_spec_matches(brand, model, fuel_type, generation_normalized, trim_normalized, priority);

comment on column public.vehicle_power_spec_matches.generation_normalized is
  'Canonical generation key for matching; raw generation is preserved.';
comment on column public.vehicle_power_spec_matches.trim_normalized is
  'Canonical trim/badge key for matching; raw trim is preserved.';
