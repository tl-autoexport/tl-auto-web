-- The AI evidence journal and its link to a published car.
--
-- `vehicle_power_ai_evidence` already exists in the live database, but it was
-- created outside migration control, so a fresh environment could not be built
-- from the repository and the table could not be reviewed. The definition below
-- is reconstructed from the live schema; every statement is idempotent, so on
-- the live database nothing is altered and only the two new audit columns are
-- added. The live definition stays authoritative where the two differ.
--
-- AI results never reach a price directly. The journal records what a provider
-- returned, a controlled step approves it, and only an approved row may be
-- referenced from a car. `approved_at` and `approved_by` exist so a manual or
-- automated approval can be audited afterwards instead of being indistinguishable
-- from an automatic acceptance.
create table if not exists public.vehicle_power_ai_evidence (
  id uuid primary key default gen_random_uuid(),
  configuration_key text not null,
  brand text not null,
  model text not null,
  generation text,
  fuel_type text,
  engine_cc integer,
  drive_type text,
  badge text,
  badge_detail text,
  year_from integer,
  year_to integer,
  power_hp numeric,
  power_kw numeric,
  power_basis text,
  status text not null,
  confidence text not null,
  source_name text,
  source_url text,
  source_date date,
  match_reason text,
  conflicts jsonb not null default '[]'::jsonb,
  provider text not null,
  raw_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists vehicle_power_ai_evidence_configuration_key_key
  on public.vehicle_power_ai_evidence(configuration_key);
-- Definition reconstructed from the live index name; skipped where it exists.
create index if not exists vehicle_power_ai_evidence_lookup_idx
  on public.vehicle_power_ai_evidence(brand, model, generation, year_from, year_to, engine_cc);

alter table public.vehicle_power_ai_evidence
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by text;

comment on table public.vehicle_power_ai_evidence is
  'AI/web fallback results with their provenance. A result is stored first, verified against the full configuration, and only then approved; an unapproved row must never drive a final price.';
comment on column public.vehicle_power_ai_evidence.approved_at is
  'When the result was approved by a person or a controlled process. Null means it is still unapproved.';
comment on column public.vehicle_power_ai_evidence.approved_by is
  'Who or what approved the result, so a manual acceptance is auditable.';

-- The car keeps only the reference; the provenance itself lives in the journal.
alter table public.cars
  add column if not exists power_ai_evidence_id uuid
    references public.vehicle_power_ai_evidence(id) on delete set null;

create index if not exists cars_power_ai_evidence_idx
  on public.cars(power_ai_evidence_id) where power_ai_evidence_id is not null;

comment on column public.cars.power_ai_evidence_id is
  'Approved AI evidence this car power came from, when the main sources failed. The rest of the provenance is read from the journal by this reference.';
