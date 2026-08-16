-- Public API hardening for the Autoexport catalogue.
--
-- The storefront only needs read access to available cars and their related
-- presentation data. All ingestion, operational and lead data stays private
-- and is written exclusively by the server-side Supabase secret/service role.

alter table public.cars enable row level security;
alter table public.car_media enable row level security;
alter table public.car_options enable row level security;
alter table public.car_condition_reports enable row level security;
alter table public.calc_snapshots enable row level security;
alter table public.source_snapshots enable row level security;
alter table public.source_import_runs enable row level security;
alter table public.leads enable row level security;
alter table public.lead_events enable row level security;

revoke all privileges on table
  public.cars,
  public.car_media,
  public.car_options,
  public.car_condition_reports,
  public.calc_snapshots,
  public.source_snapshots,
  public.source_import_runs,
  public.leads,
  public.lead_events
from anon, authenticated;

grant select on table
  public.cars,
  public.car_media,
  public.car_options,
  public.car_condition_reports,
  public.calc_snapshots
to anon, authenticated;

drop policy if exists "Public can read available cars" on public.cars;
create policy "Public can read available cars"
on public.cars
for select
to anon, authenticated
using (is_available = true);

drop policy if exists "Public can read media for available cars" on public.car_media;
create policy "Public can read media for available cars"
on public.car_media
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.cars
    where cars.id = car_media.car_id
      and cars.is_available = true
  )
);

drop policy if exists "Public can read options for available cars" on public.car_options;
create policy "Public can read options for available cars"
on public.car_options
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.cars
    where cars.id = car_options.car_id
      and cars.is_available = true
  )
);

drop policy if exists "Public can read reports for available cars" on public.car_condition_reports;
create policy "Public can read reports for available cars"
on public.car_condition_reports
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.cars
    where cars.id = car_condition_reports.car_id
      and cars.is_available = true
  )
);

drop policy if exists "Public can read calculations for available cars" on public.calc_snapshots;
create policy "Public can read calculations for available cars"
on public.calc_snapshots
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.cars
    where cars.id = calc_snapshots.car_id
      and cars.is_available = true
  )
);

revoke execute on function public.set_updated_at() from public, anon, authenticated;
