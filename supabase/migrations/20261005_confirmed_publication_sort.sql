-- Sort public catalogue cards by a source-confirmed first-advertised date.
-- Internal/import timestamps must not be presented as time on sale in Korea.
alter table public.cars
  add column if not exists catalog_sort_published_at timestamptz
  generated always as (
    case
      when published_at_source in ('source_payload', 'source_snapshot') then published_at
      else null
    end
  ) stored;

comment on column public.cars.catalog_sort_published_at is
  'Generated sort key: published_at only when confirmed by source_payload/source_snapshot; unknown dates sort last.';

create index if not exists cars_catalog_confirmed_published_at_idx
  on public.cars (catalog_sort_published_at desc nulls last, id)
  where is_available;

-- Rebuild the display view projection so the generated key is exposed to the
-- server-side catalogue query. Keep the same canonical naming projection.
do $view$
declare projection text;
begin
  select string_agg(case column_name
    when 'brand' then 'coalesce(n.brand,c.brand) as brand'
    when 'model' then 'coalesce(n.model,c.model) as model'
    when 'trim' then 'case when n.car_id is not null then n.trim_label else c.trim end as trim'
    when 'generation' then 'case when n.car_id is not null then n.generation_label else c.generation end as generation'
    when 'generation_code' then 'case when n.generation_label is null then c.generation_code when n.generation_label ~ ''^[A-Za-z][A-Za-z0-9-]*$'' then lower(n.generation_label) else ''ordinal:'' || n.brand || '':'' || n.model || '':'' || n.generation_label end as generation_code'
    else 'c.' || quote_ident(column_name) end, ', ' order by ordinal_position)
    into projection
  from information_schema.columns
  where table_schema = 'public' and table_name = 'cars'
    and column_name <> 'catalog_sort_published_at';

  execute 'create or replace view public.catalog_display_cars with (security_invoker=true) as select '
    || projection
    || ',n.generation_label,n.modification_label,n.version_line,n.compact_version,n.rules_version naming_rules_version '
    || ',c.catalog_sort_published_at '
    || 'from public.cars c left join public.catalog_vehicle_names n on n.car_id=c.id';
end
$view$;

notify pgrst, 'reload schema';
