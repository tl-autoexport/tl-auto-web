create table if not exists public.calc_rate_snapshots (
  id uuid primary key default gen_random_uuid(),
  rates jsonb not null,
  rate_details jsonb not null default '{}'::jsonb,
  source text not null,
  as_of text not null,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists calc_rate_snapshots_created_idx
  on public.calc_rate_snapshots(created_at desc);

alter table public.calc_rate_snapshots enable row level security;

drop policy if exists "Public can read calculation rates" on public.calc_rate_snapshots;
create policy "Public can read calculation rates"
on public.calc_rate_snapshots
for select
to anon, authenticated
using (true);
