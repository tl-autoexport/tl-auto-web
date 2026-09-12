alter table public.cars
  add column if not exists last_checked_at timestamptz,
  add column if not exists revalidation_miss_count integer not null default 0;

create index if not exists cars_revalidation_idx
  on public.cars (last_checked_at asc nulls first, id)
  where is_available = true;

create or replace function public.apply_catalog_revalidation(
  p_found_source_ids text[],
  p_missing_source_ids text[],
  p_checked_at timestamptz,
  p_hide_after integer default 2
)
returns table (found_count integer, missing_count integer, hidden_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found integer := 0;
  v_missing integer := 0;
  v_hidden integer := 0;
begin
  update public.cars
  set last_seen_at = p_checked_at,
      last_checked_at = p_checked_at,
      revalidation_miss_count = 0
  where source_id = any(coalesce(p_found_source_ids, '{}'::text[]))
    and primary_source in ('encar', 'chestny_prigon');
  get diagnostics v_found = row_count;

  update public.cars
  set last_checked_at = p_checked_at,
      revalidation_miss_count = revalidation_miss_count + 1,
      sale_status = case when revalidation_miss_count + 1 >= p_hide_after then 'source_unavailable' else sale_status end,
      is_available = case when revalidation_miss_count + 1 >= p_hide_after then false else is_available end
  where source_id = any(coalesce(p_missing_source_ids, '{}'::text[]))
    and primary_source in ('encar', 'chestny_prigon')
    and is_available = true;
  get diagnostics v_missing = row_count;

  select count(*)::integer into v_hidden
  from public.cars
  where source_id = any(coalesce(p_missing_source_ids, '{}'::text[]))
    and primary_source in ('encar', 'chestny_prigon')
    and not is_available
    and revalidation_miss_count >= p_hide_after;

  return query select v_found, v_missing, v_hidden;
end;
$$;

revoke all on function public.apply_catalog_revalidation(text[], text[], timestamptz, integer) from public;
grant execute on function public.apply_catalog_revalidation(text[], text[], timestamptz, integer) to service_role;
