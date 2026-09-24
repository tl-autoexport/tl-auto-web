-- vehicle_no_masked is a public/display field.  Keep a deterministic hash for
-- duplicate detection and ensure future writes cannot store a full plate there.
alter table public.cars add column if not exists vehicle_no_hash text;

create or replace function public.tl_auto_vehicle_no_key(p_value text)
returns text language sql immutable strict as $$
  select upper(regexp_replace(p_value, '[^0-9A-Za-z가-힣]', '', 'g'))
$$;

update public.cars
set vehicle_no_hash = encode(digest(public.tl_auto_vehicle_no_key(vehicle_no_masked), 'sha256'), 'hex')
where vehicle_no_masked is not null
  and vehicle_no_masked not like '%*%'
  and vehicle_no_hash is null;

create index if not exists cars_active_vehicle_no_hash_idx
  on public.cars (vehicle_no_hash) where is_available and vehicle_no_hash is not null;

create or replace function public.tl_auto_mask_vehicle_no_on_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_key text;
begin
  if new.vehicle_no_masked is null or new.vehicle_no_masked like '%*%' then
    return new;
  end if;
  v_key := public.tl_auto_vehicle_no_key(new.vehicle_no_masked);
  if v_key = '' then return new; end if;
  new.vehicle_no_hash := encode(digest(v_key, 'sha256'), 'hex');
  new.vehicle_no_masked := case when char_length(v_key) > 4
    then left(v_key, char_length(v_key) - 4) || '****' else '****' end;
  return new;
end;
$$;

drop trigger if exists tl_auto_mask_vehicle_no_on_write on public.cars;
create trigger tl_auto_mask_vehicle_no_on_write
before insert or update of vehicle_no_masked on public.cars
for each row execute function public.tl_auto_mask_vehicle_no_on_write();
