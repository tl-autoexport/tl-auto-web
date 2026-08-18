-- Reduce catalogue storage without changing the public vehicle experience.
-- The current storefront reads only the latest calculation, normalized option
-- fields, inspection body marks, and normalized insurance events.

begin;

-- Old calculations are not part of the customer-facing product. Keep one
-- latest snapshot per car and detach optional lead references to snapshots
-- that are going away.
with ranked as (
  select
    id,
    row_number() over (
      partition by car_id
      order by calculated_at desc, created_at desc, id desc
    ) as position
  from public.calc_snapshots
  where car_id is not null
), retired as (
  select id from ranked where position > 1
)
update public.leads
set calc_snapshot_id = null
where calc_snapshot_id in (select id from retired);

with ranked as (
  select
    id,
    row_number() over (
      partition by car_id
      order by calculated_at desc, created_at desc, id desc
    ) as position
  from public.calc_snapshots
  where car_id is not null
)
delete from public.calc_snapshots snapshots
using ranked
where snapshots.id = ranked.id
  and ranked.position > 1;

-- Orphaned calculations have no public use.
delete from public.calc_snapshots snapshots
where snapshots.car_id is null;

-- Retired cars remain as lightweight catalogue identities, but their heavy
-- public relations are no longer needed.
create temporary table retired_cars on commit drop as
select id, source_id from public.cars where is_available = false;

update public.leads
set calc_snapshot_id = null
where car_id in (select id from retired_cars);

delete from public.car_media where car_id in (select id from retired_cars);
delete from public.car_options where car_id in (select id from retired_cars);
delete from public.car_condition_reports where car_id in (select id from retired_cars);
delete from public.calc_snapshots where car_id in (select id from retired_cars);
delete from public.source_snapshots
where source = 'encar'
  and source_id in (
    select source_id from retired_cars
  );

-- Keep only fields rendered by the option accordion. Verbose source labels,
-- descriptions and prices are not used by the storefront.
update public.car_options
set source_code = null,
    description_original = null,
    description_ru = null,
    price_krw = null;
drop index if exists public.car_options_source_code_idx;

-- Diagnosis payload is not rendered by TL Auto. Inspection keeps only the
-- body findings required by the damage diagram; history keeps only the
-- normalized accident events required by the insurance history section.
update public.car_condition_reports
set raw_payload = '{}'::jsonb
where report_type = 'encar_diagnosis';

update public.car_condition_reports
set raw_payload = jsonb_build_object(
  'inspection', jsonb_build_object(
    'outers', coalesce(raw_payload #> '{inspection,outers}', '[]'::jsonb)
  )
)
where report_type = 'encar_inspection';

update public.car_condition_reports
set raw_payload = jsonb_build_object(
  'accidentHistoryResponse', coalesce(raw_payload -> 'accidentHistoryResponse', items)
)
where report_type = 'encar_carhistory';

commit;
