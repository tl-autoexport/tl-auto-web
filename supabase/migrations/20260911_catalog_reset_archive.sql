-- Reversible archive before replacing the public catalogue source.
create table if not exists public.catalog_archive_runs (
  id uuid primary key default gen_random_uuid(),
  reason text not null,
  source_filter text,
  cars_count integer not null default 0,
  created_at timestamptz not null default now(),
  restored_at timestamptz
);

create table if not exists public.catalog_archive_members (
  archive_run_id uuid not null references public.catalog_archive_runs(id) on delete cascade,
  car_id uuid not null references public.cars(id),
  original_payload jsonb not null,
  primary key (archive_run_id, car_id)
);

create index if not exists catalog_archive_members_car_idx
  on public.catalog_archive_members(car_id);

alter table public.catalog_archive_runs enable row level security;
alter table public.catalog_archive_members enable row level security;
revoke all privileges on table public.catalog_archive_runs, public.catalog_archive_members from anon, authenticated;

