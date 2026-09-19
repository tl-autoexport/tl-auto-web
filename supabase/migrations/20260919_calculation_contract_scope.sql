-- Scopes the price/status invariant to published cards.
--
-- The first revision applied it to every row, which the validator rejected:
-- 4,279 delisted cards (is_available = false) keep a historical price with the
-- default 'unreviewed' status. That status is accurate for them — nobody
-- reviewed them and they are not shown — so forcing a resolution onto archived
-- rows would write meaningless data. The rule that matters is the published one:
-- a card that can be seen must not expose a landed price without a resolved
-- power.
--
-- Added NOT VALID on purpose: the remaining data repair (filling the power basis
-- for rows that carry an exact kW) runs afterwards, and only then are the
-- constraints validated. See `backfill-calculation-contract.ts`, which validates
-- them at the end of its write.
alter table public.cars drop constraint if exists cars_price_requires_resolved_power;
alter table public.cars add constraint cars_price_requires_resolved_power
  check (is_available = false or price_rub is null or calculation_power_status in ('matched', 'approved')) not valid;
