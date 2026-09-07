-- Evidence-backed vehicle power reference.
--
-- Raw imports and unreviewed power values must never affect a public price.
-- Only an approved specification linked to verified evidence may be assigned
-- to a car for the calculator.

create table if not exists public.vehicle_power_source_batches (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in (
    'customer_workbook', 'tks_har', 'sbkts', 'otts', 'epts',
    'manufacturer_document', 'vin_decoder', 'manual'
  )),
  source_name text not null,
  source_uri text,
  source_sha256 text,
  source_version text,
  imported_by text,
  metadata jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique nulls not distinct (source_kind, source_sha256)
);

create table if not exists public.vehicle_power_source_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.vehicle_power_source_batches(id) on delete cascade,
  source_sheet text,
  source_row_number integer,
  raw_record jsonb not null,
  raw_vehicle_name text,
  raw_vin text,
  raw_power_text text,
  parse_status text not null default 'unreviewed' check (parse_status in (
    'unreviewed', 'parsed', 'needs_review', 'rejected'
  )),
  parse_warnings text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  unique nulls not distinct (batch_id, source_sheet, source_row_number)
);

create index if not exists vehicle_power_source_rows_batch_idx
  on public.vehicle_power_source_rows(batch_id, source_sheet, source_row_number);
create index if not exists vehicle_power_source_rows_vin_idx
  on public.vehicle_power_source_rows(raw_vin)
  where raw_vin is not null;

create table if not exists public.vehicle_power_evidence (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.vehicle_power_source_batches(id) on delete set null,
  source_row_id uuid references public.vehicle_power_source_rows(id) on delete set null,
  source_kind text not null check (source_kind in (
    'sbkts', 'otts', 'epts', 'manufacturer_document', 'vin_decoder',
    'tks_har', 'customer_workbook', 'manual'
  )),
  source_uri text,
  document_reference text,
  document_page text,
  captured_at date,
  vehicle_category text check (vehicle_category in ('M1', 'N1', 'other')),
  brand text,
  model text,
  generation text,
  trim text,
  model_code text,
  engine_code text,
  fuel_type text,
  production_year_from integer,
  production_year_to integer,
  propulsion_type text not null check (propulsion_type in (
    'ice', 'electric', 'hybrid_parallel', 'hybrid_sequential'
  )),
  dvs_power_kw numeric(10,4),
  electric_power_kw_30min numeric(10,4),
  electric_motor_count integer,
  peak_power_kw numeric(10,4),
  source_units text,
  reliability text not null default 'unreviewed' check (reliability in (
    'unreviewed', 'low', 'medium', 'high', 'verified'
  )),
  review_status text not null default 'draft' check (review_status in (
    'draft', 'verified', 'rejected'
  )),
  review_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (production_year_to is null or production_year_from is null or production_year_to >= production_year_from),
  check (electric_motor_count is null or electric_motor_count > 0),
  check (
    (propulsion_type = 'ice' and dvs_power_kw is not null)
    or (propulsion_type in ('electric', 'hybrid_sequential') and electric_power_kw_30min is not null)
    or (propulsion_type = 'hybrid_parallel' and dvs_power_kw is not null and electric_power_kw_30min is not null)
  )
);

create index if not exists vehicle_power_evidence_vehicle_idx
  on public.vehicle_power_evidence(brand, model, model_code, engine_code, fuel_type);
create index if not exists vehicle_power_evidence_status_idx
  on public.vehicle_power_evidence(review_status, reliability);

drop trigger if exists vehicle_power_evidence_set_updated_at on public.vehicle_power_evidence;
create trigger vehicle_power_evidence_set_updated_at
before update on public.vehicle_power_evidence
for each row execute procedure public.set_updated_at();

create table if not exists public.vehicle_power_specs (
  id uuid primary key default gen_random_uuid(),
  spec_key text not null,
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  vehicle_category text not null check (vehicle_category in ('M1', 'N1', 'other')),
  propulsion_type text not null check (propulsion_type in (
    'ice', 'electric', 'hybrid_parallel', 'hybrid_sequential'
  )),
  engine_cc_from integer,
  engine_cc_to integer,
  dvs_power_kw numeric(10,4),
  electric_power_kw_30min numeric(10,4),
  calculation_power_kw numeric(10,4) not null,
  effective_from date,
  effective_to date,
  evidence_id uuid not null references public.vehicle_power_evidence(id) on delete restrict,
  approval_note text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (spec_key, version),
  check (engine_cc_from is null or engine_cc_from >= 0),
  check (engine_cc_to is null or engine_cc_from is null or engine_cc_to >= engine_cc_from),
  check (effective_to is null or effective_from is null or effective_to >= effective_from),
  check (calculation_power_kw > 0),
  check (
    (propulsion_type = 'ice' and dvs_power_kw is not null and calculation_power_kw = dvs_power_kw)
    or (propulsion_type in ('electric', 'hybrid_sequential') and electric_power_kw_30min is not null and calculation_power_kw = electric_power_kw_30min)
    or (propulsion_type = 'hybrid_parallel' and dvs_power_kw is not null and electric_power_kw_30min is not null and calculation_power_kw = dvs_power_kw + electric_power_kw_30min)
  ),
  check ((status <> 'approved') or (approved_at is not null and approved_by is not null))
);

create unique index if not exists vehicle_power_specs_one_active_version_idx
  on public.vehicle_power_specs(spec_key)
  where status = 'approved';

drop trigger if exists vehicle_power_specs_set_updated_at on public.vehicle_power_specs;
create trigger vehicle_power_specs_set_updated_at
before update on public.vehicle_power_specs
for each row execute procedure public.set_updated_at();

create table if not exists public.vehicle_power_spec_matches (
  id uuid primary key default gen_random_uuid(),
  spec_id uuid not null references public.vehicle_power_specs(id) on delete cascade,
  priority integer not null default 100 check (priority > 0),
  brand text not null,
  model text not null,
  generation text,
  trim text,
  model_code text,
  engine_code text,
  fuel_type text,
  production_year_from integer,
  production_year_to integer,
  engine_cc_from integer,
  engine_cc_to integer,
  created_at timestamptz not null default now(),
  check (production_year_to is null or production_year_from is null or production_year_to >= production_year_from),
  check (engine_cc_to is null or engine_cc_from is null or engine_cc_to >= engine_cc_from)
);

create index if not exists vehicle_power_spec_matches_lookup_idx
  on public.vehicle_power_spec_matches(brand, model, fuel_type, priority);

alter table public.cars
  add column if not exists vehicle_category text check (vehicle_category in ('M1', 'N1', 'other')),
  add column if not exists calculation_power_spec_id uuid references public.vehicle_power_specs(id) on delete set null,
  add column if not exists calculation_power_spec_version integer,
  add column if not exists calculation_power_kw numeric(10,4),
  add column if not exists calculation_power_status text not null default 'unreviewed' check (calculation_power_status in (
    'unreviewed', 'matched', 'approved', 'review_required', 'not_applicable'
  ));

alter table public.cars
  add constraint cars_calculation_power_spec_version_check
  check (calculation_power_spec_id is null or calculation_power_spec_version is not null)
  not valid;

create index if not exists cars_calculation_power_status_idx
  on public.cars(calculation_power_status, calculation_power_spec_id);

comment on table public.vehicle_power_source_rows is
  'Immutable raw source rows. They never affect the calculator directly.';
comment on table public.vehicle_power_evidence is
  'Documented power facts reviewed before they can support a calculation spec.';
comment on table public.vehicle_power_specs is
  'Versioned approved legal calculation power specifications.';
comment on column public.cars.calculation_power_kw is
  'Exact kW used for the legal power band; no display rounding.';

alter table public.vehicle_power_source_batches enable row level security;
alter table public.vehicle_power_source_rows enable row level security;
alter table public.vehicle_power_evidence enable row level security;
alter table public.vehicle_power_specs enable row level security;
alter table public.vehicle_power_spec_matches enable row level security;

revoke all privileges on table
  public.vehicle_power_source_batches,
  public.vehicle_power_source_rows,
  public.vehicle_power_evidence,
  public.vehicle_power_specs,
  public.vehicle_power_spec_matches
from anon, authenticated;
