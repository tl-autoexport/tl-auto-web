-- Persistent review queue for TL Auto power configurations.
-- This is operational metadata only and never changes a car calculation.

create table if not exists public.vehicle_power_review_queue (
  id uuid primary key default gen_random_uuid(),
  configuration_key text not null unique,
  brand text,
  model text,
  fuel_type text,
  engine_cc integer,
  drive_type text,
  badge text,
  badge_detail text,
  year_from integer,
  year_to integer,
  cards_count integer not null default 0,
  current_sources jsonb not null default '{}'::jsonb,
  priority integer not null default 50 check (priority between 1 and 100),
  required_evidence text[] not null default '{}'::text[],
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'verified', 'blocked', 'ignored')),
  last_seen_at timestamptz not null default now(),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vehicle_power_review_queue_priority_idx
  on public.vehicle_power_review_queue(status, priority, cards_count desc);

drop trigger if exists vehicle_power_review_queue_set_updated_at on public.vehicle_power_review_queue;
create trigger vehicle_power_review_queue_set_updated_at
before update on public.vehicle_power_review_queue
for each row execute procedure public.set_updated_at();

alter table public.vehicle_power_review_queue enable row level security;
revoke all privileges on table public.vehicle_power_review_queue from anon, authenticated;

comment on table public.vehicle_power_review_queue is
  'TL Auto configuration review queue. It does not authorize or alter calculator values.';
