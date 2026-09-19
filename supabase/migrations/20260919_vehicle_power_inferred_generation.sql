-- TL Auto: inferred generation is metadata, not a replacement for source data.
alter table public.cars
  add column if not exists inferred_generation text,
  add column if not exists inferred_generation_source text,
  add column if not exists inferred_generation_confidence text
    check (inferred_generation_confidence in ('high', 'medium'));

create index if not exists cars_inferred_generation_idx
  on public.cars(brand, model, inferred_generation);
