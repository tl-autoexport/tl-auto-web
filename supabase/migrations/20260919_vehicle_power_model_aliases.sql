-- Additive canonical aliases. Does not merge specifications or modify cars.
create table if not exists public.vehicle_power_model_aliases (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('brand', 'model', 'generation', 'fuel', 'drive')),
  raw_value text not null,
  canonical_value text not null,
  source text not null default 'tl_auto_canonical_v1',
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_type, raw_value)
);
create index if not exists vehicle_power_model_aliases_lookup_idx on public.vehicle_power_model_aliases(entity_type, raw_value, status);
insert into public.vehicle_power_model_aliases(entity_type, raw_value, canonical_value) values
  ('model', 'Ioniq5', 'Ioniq 5'), ('model', 'IONIQ 5', 'Ioniq 5'),
  ('model', 'Ioniq6', 'Ioniq 6'), ('model', 'IONIQ 6', 'Ioniq 6'),
  ('model', 'EV 5', 'EV5'), ('model', 'ST 1', 'ST1'),
  ('brand', 'Mercedes', 'Mercedes-Benz'), ('brand', 'Mercedes Benz', 'Mercedes-Benz'),
  ('drive', '2 WD', '2WD'), ('drive', '4 WD', '4WD'),
  ('drive', 'FF', '2WD'), ('drive', 'RR', '2WD')
on conflict (entity_type, raw_value) do update set canonical_value = excluded.canonical_value, status = 'active', updated_at = now();
alter table public.vehicle_power_model_aliases enable row level security;
revoke all privileges on table public.vehicle_power_model_aliases from anon, authenticated;
