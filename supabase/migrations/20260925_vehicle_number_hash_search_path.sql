-- The trigger uses a locked search_path; pgcrypto is installed in extensions
-- on Supabase projects, so reference digest() with its schema explicitly.
create or replace function public.tl_auto_mask_vehicle_no_on_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  if new.vehicle_no_masked is null or new.vehicle_no_masked like '%*%' then
    return new;
  end if;
  v_key := public.tl_auto_vehicle_no_key(new.vehicle_no_masked);
  if v_key = '' then return new; end if;
  new.vehicle_no_hash := encode(extensions.digest(v_key, 'sha256'), 'hex');
  new.vehicle_no_masked := case when char_length(v_key) > 4
    then left(v_key, char_length(v_key) - 4) || '****' else '****' end;
  return new;
end;
$$;
