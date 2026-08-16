alter table public.cars
  add column if not exists vehicle_type text not null default 'car';

alter table public.cars
  add column if not exists vehicle_specs jsonb not null default '{}'::jsonb;

do $$
begin
  alter table public.cars
    add constraint cars_vehicle_type_check
    check (vehicle_type in ('car', 'motorcycle', 'scooter', 'jetski'));
exception
  when duplicate_object then null;
end;
$$;

create index if not exists cars_vehicle_type_available_idx
  on public.cars(vehicle_type, is_available, source_updated_at desc);

comment on column public.cars.vehicle_type is
  'Normalized category: car, motorcycle, scooter, or jetski.';

comment on column public.cars.vehicle_specs is
  'Category-specific specifications kept separate from shared catalog fields.';
