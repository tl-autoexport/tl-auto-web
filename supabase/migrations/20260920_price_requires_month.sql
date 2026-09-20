-- A published card cannot expose a price without the month the price was
-- calculated with.
--
-- The contract gate (`evaluatePublication`) and the catalogue audit already
-- check this, but both can only report what a writer left behind: a writer that
-- never calls them still creates the row. That is exactly what happened — one
-- card reached the catalogue with a price and no `calculation_month`, and the
-- repair had to be run manually.
--
-- With this constraint the class of defect becomes impossible, and the next
-- offender names itself: the insert or update fails with the constraint name,
-- so there is no need to search for the writer by inspection.
--
-- Together with `cars_month_source_requires_month` the chain is complete:
-- a price implies a month, and a month implies a stated source.
alter table public.cars drop constraint if exists cars_price_requires_calculation_month;
alter table public.cars add constraint cars_price_requires_calculation_month
  check (is_available = false or price_rub is null or calculation_month is not null);

comment on constraint cars_price_requires_calculation_month on public.cars is
  'A card that can be shown must not carry a price without calculation_month. A bypassing publisher fails loudly here instead of silently breaking the audit.';
