-- Working dictionary of vehicle generations.
--
-- It maps a source generation string (as stored in `cars.generation`) to a
-- canonical code and a Russian label, so the catalogue can filter by generation
-- without parsing Korean text at query time.
--
-- Design notes:
--   - the source string is unique per brand and model: one source value maps to
--     exactly one code;
--   - a code may legitimately have several source spellings (투싼 (NX4) and
--     더 뉴 투싼 (NX4) are the same generation), so uniqueness on the code would
--     reject valid rows. The import instead refuses a code whose label differs
--     within the same model, which is the property that actually matters;
--   - the normalized key columns strip case, spaces, brackets and punctuation
--     but keep letters of any script, so Korean strings compare reliably;
--   - provenance records how the label was obtained: written in the source
--     value, or approved per model.
create table if not exists public.catalog_generation_dictionary (
  id uuid primary key default gen_random_uuid(),
  brand text not null default '',
  model text not null default '',
  source_value text not null,
  code text,
  label_ru text,
  provenance text check (provenance in ('source_explicit', 'derived_from_model_allowlist')),
  status text not null default 'review' check (status in ('approved', 'review', 'rejected')),
  cars_count integer,
  audited_at timestamptz,
  brand_key text generated always as (lower(regexp_replace(brand, '[\s()\[\]{}_\-/\\.,]+', '', 'g'))) stored,
  model_key text generated always as (lower(regexp_replace(model, '[\s()\[\]{}_\-/\\.,]+', '', 'g'))) stored,
  source_key text generated always as (lower(regexp_replace(source_value, '[\s()\[\]{}_\-/\\.,]+', '', 'g'))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists catalog_generation_dictionary_source_uidx
  on public.catalog_generation_dictionary(brand_key, model_key, source_key);

create index if not exists catalog_generation_dictionary_code_idx
  on public.catalog_generation_dictionary(brand_key, model_key, code);

comment on table public.catalog_generation_dictionary is
  'Maps a source generation string to a canonical code and a Russian label. status approved means the mapping may drive the public filter.';
comment on column public.catalog_generation_dictionary.provenance is
  'source_explicit = the code is written in the source value; derived_from_model_allowlist = the code was approved for this model.';
comment on column public.catalog_generation_dictionary.cars_count is
  'How many published cars carried this source value at the last audit.';

-- The filter reads this column, never the raw source string.
alter table public.cars add column if not exists generation_code text;
create index if not exists cars_generation_code_idx
  on public.cars(generation_code) where is_available;
comment on column public.cars.generation_code is
  'Canonical generation code resolved through catalog_generation_dictionary. cars.generation keeps the raw source value for audit and display.';
