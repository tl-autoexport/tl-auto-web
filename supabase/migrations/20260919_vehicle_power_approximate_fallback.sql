-- TL Auto: card-power fallback for preliminary calculations.
-- This never promotes a car to an approved reference specification.

alter table public.cars drop constraint if exists cars_power_confidence_check;
alter table public.cars
  add constraint cars_power_confidence_check
  check (power_confidence in ('official', 'high', 'medium', 'approximate', 'automatic'));

comment on column public.cars.power_confidence is
  'official/high = approved reference; medium = inferred but constrained; approximate = card power fallback for preliminary calculation; automatic = legacy non-final value.';
