-- Separate "the value is settled" from "the value is a rehearsal".
--
-- `calculation_power_status = 'matched'` has meant both since the Encar
-- publishers started writing preliminary values with it, and
-- `scripts/recalculate-active-catalog.ts` read `matched` as an approved tariff
-- input. That let a preliminary value be re-priced and re-labelled as an
-- approved one on the next recalculation.
--
-- `power_finality` is the persisted form of `priceFinality()` from
-- `src/server/cars/calculation-contract.ts`; the contract stays the single rule
-- and this column only stores its result:
--   final       the value came from approved evidence and may drive a final price;
--   provisional a rehearsal: it may be shown, always marked, and a
--               recalculation must never treat it as approved;
--   null        no calculable power (no kw or no source), so no price is implied.
--
-- Backfill rule, in the same order as the code:
--   * no kw or no source                              -> null
--   * official/high                                   -> final, unless the
--     specification behind it rests on evidence weaker than T1/T2
--   * medium with an approved specification id        -> final
--   * everything else (medium without a spec, approximate, automatic) -> provisional
--
-- The three checks below are the invariant the recalculation relies on. They are
-- added NOT VALID and validated after the backfill so the table is not locked.

alter table public.cars add column if not exists power_finality text;

update public.cars c
set power_finality = case
  when c.calculation_power_kw is null or c.power_resolution_source is null then null
  when c.power_confidence in ('official', 'high') then
    case
      when c.calculation_power_spec_id is not null
        and exists (
          select 1
          from public.vehicle_power_specs sp
          join public.vehicle_power_evidence e on e.id = sp.evidence_id
          where sp.id = c.calculation_power_spec_id
            and e.evidence_tier not in ('T1', 'T2')
        )
      then 'provisional'
      else 'final'
    end
  when c.power_confidence = 'medium' and c.calculation_power_spec_id is not null then 'final'
  else 'provisional'
end
where c.is_available;

alter table public.cars drop constraint if exists cars_power_finality_check;
alter table public.cars
  add constraint cars_power_finality_check
  check (power_finality is null or power_finality in ('final', 'provisional')) not valid;

-- A final value can only come from a confidence that means "approved", or from an
-- approved specification whose weakness is visible in `medium`.
alter table public.cars drop constraint if exists cars_final_power_is_confirmed;
alter table public.cars
  add constraint cars_final_power_is_confirmed
  check (
    power_finality <> 'final'
    or power_confidence in ('official', 'high')
    or (power_confidence = 'medium' and calculation_power_spec_id is not null)
  ) not valid;

-- The exact leak this migration exists for: a rehearsal must never be stored as
-- approved, so `automatic`/`approximate` can never carry `final`.
--
-- The opposite direction is deliberately NOT constrained: a `high` value whose
-- evidence is weaker than T1/T2 is *expected* to be provisional (three Encar and
-- twenty-nine chestny cards are), and a partial CHECK cannot see the tier.
--
-- A published price always states which kind of value produced it.
alter table public.cars drop constraint if exists cars_price_requires_power_finality;
alter table public.cars
  add constraint cars_price_requires_power_finality
  check (not is_available or price_rub is null or power_finality is not null) not valid;

comment on column public.cars.power_finality is
  'Persisted price finality: final = approved evidence; provisional = a marked rehearsal that must never be treated as approved; null = no calculable power. Mirrors priceFinality() in src/server/cars/calculation-contract.ts.';

alter table public.cars validate constraint cars_power_finality_check;
alter table public.cars validate constraint cars_final_power_is_confirmed;
alter table public.cars validate constraint cars_price_requires_power_finality;

create index if not exists cars_power_finality_idx
  on public.cars (power_finality) where is_available;
