create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.cars (
  id uuid primary key default gen_random_uuid(),
  primary_source text not null,
  source_kind text not null,
  source_id text not null,
  source_url text,
  enrichment_status text not null default 'source_only',
  is_available boolean not null default true,
  sale_status text,
  published_at timestamptz,
  source_updated_at timestamptz,
  last_seen_at timestamptz,
  brand text,
  model text,
  generation text,
  grade text,
  trim text,
  badge text,
  badge_detail text,
  year integer,
  registration_year integer,
  registration_month integer,
  registration_date date,
  mileage_km integer,
  price_krw bigint,
  price_rub bigint,
  engine_cc integer,
  power_hp integer,
  power_source text,
  fuel_type text,
  transmission text,
  drive_type text,
  body_type text,
  color text,
  seller_region text,
  vehicle_no_masked text,
  vin_masked text,
  owners_count integer,
  accident_count integer,
  insurance_payout_count integer,
  insurance_payout_total_krw bigint,
  has_360_exterior boolean not null default false,
  has_360_interior boolean not null default false,
  has_heydealer_eye boolean not null default false,
  has_obd_scan boolean not null default false,
  has_underbody_photo boolean not null default false,
  has_thermal_images boolean not null default false,
  data_confidence numeric(5,2),
  data_warnings text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (primary_source, source_id)
);

drop trigger if exists cars_set_updated_at on public.cars;
create trigger cars_set_updated_at
before update on public.cars
for each row
execute procedure public.set_updated_at();

create index if not exists cars_available_updated_idx on public.cars(is_available, source_updated_at desc);
create index if not exists cars_brand_model_idx on public.cars(brand, model);
create index if not exists cars_price_rub_idx on public.cars(price_rub);
create index if not exists cars_power_hp_idx on public.cars(power_hp);
create index if not exists cars_engine_cc_idx on public.cars(engine_cc);
create index if not exists cars_year_idx on public.cars(year);
create index if not exists cars_mileage_idx on public.cars(mileage_km);

create table if not exists public.source_snapshots (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_id text not null,
  source_url text,
  payload jsonb not null,
  payload_hash text,
  fetched_at timestamptz not null default now(),
  parser_version text not null,
  status text not null default 'ok',
  error_message text
);

create index if not exists source_snapshots_lookup_idx on public.source_snapshots(source, source_id, fetched_at desc);
create index if not exists source_snapshots_payload_gin_idx on public.source_snapshots using gin(payload);

create table if not exists public.car_media (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references public.cars(id) on delete cascade,
  source text not null,
  media_type text not null,
  category text,
  url text not null,
  thumbnail_url text,
  sort_order integer not null default 0,
  width integer,
  height integer,
  mime_type text,
  is_primary boolean not null default false,
  legal_mode text not null default 'external_url',
  created_at timestamptz not null default now()
);

create index if not exists car_media_car_sort_idx on public.car_media(car_id, sort_order);
create index if not exists car_media_type_idx on public.car_media(media_type, category);

create table if not exists public.car_options (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references public.cars(id) on delete cascade,
  source text not null,
  category text,
  name_original text,
  name_ru text,
  value_original text,
  value_ru text,
  is_present boolean,
  price_krw bigint,
  sort_order integer not null default 0
);

create index if not exists car_options_car_idx on public.car_options(car_id, category, sort_order);

create table if not exists public.car_condition_reports (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references public.cars(id) on delete cascade,
  source text not null,
  report_type text not null,
  summary jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists car_condition_reports_car_idx on public.car_condition_reports(car_id, report_type);
create index if not exists car_condition_reports_summary_gin_idx on public.car_condition_reports using gin(summary);

create table if not exists public.calc_snapshots (
  id uuid primary key default gen_random_uuid(),
  car_id uuid references public.cars(id),
  country_code text not null default 'RU',
  destination_city text not null default 'Владивосток',
  importer_type text not null default 'individual',
  calc_version text not null,
  inputs jsonb not null,
  rates jsonb not null default '{}'::jsonb,
  result jsonb not null,
  car_price_rub bigint,
  duty_rub bigint,
  fees_rub bigint,
  util_rub bigint,
  freight_rub bigint,
  broker_rub bigint,
  total_rub bigint,
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists calc_snapshots_car_idx on public.calc_snapshots(car_id, calculated_at desc);
create index if not exists calc_snapshots_total_idx on public.calc_snapshots(total_rub);
create index if not exists calc_snapshots_result_gin_idx on public.calc_snapshots using gin(result);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  car_id uuid references public.cars(id),
  calc_snapshot_id uuid references public.calc_snapshots(id),
  name text,
  contact text not null,
  comment text,
  source_page text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  status text not null default 'new',
  manager_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
before update on public.leads
for each row
execute procedure public.set_updated_at();

create index if not exists leads_status_created_idx on public.leads(status, created_at desc);
create index if not exists leads_car_idx on public.leads(car_id);

create table if not exists public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists lead_events_lead_idx on public.lead_events(lead_id, created_at);

create table if not exists public.source_import_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  job_name text not null,
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  cars_seen integer not null default 0,
  cars_created integer not null default 0,
  cars_updated integer not null default 0,
  cars_marked_unavailable integer not null default 0,
  errors_count integer not null default 0,
  error_sample jsonb not null default '[]'::jsonb,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists source_import_runs_lookup_idx on public.source_import_runs(source, job_name, started_at desc);
