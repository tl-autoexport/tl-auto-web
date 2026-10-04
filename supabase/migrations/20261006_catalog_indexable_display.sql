-- Keep exactly the existing display contract while exposing canonical brand
-- and model directly to the planner. COALESCE across a LEFT JOIN prevented
-- filtering until after joining all cars/names, even for a 13-car selection.
set local lock_timeout = '5s';
do $view$
declare
  named_projection text;
  fallback_projection text;
begin
  select string_agg(case column_name
    when 'brand' then 'n.brand'
    when 'model' then 'n.model'
    when 'trim' then 'n.trim_label as trim'
    when 'generation' then 'n.generation_label as generation'
    when 'generation_code' then 'case when n.generation_label is null then c.generation_code when n.generation_label ~ ''^[A-Za-z][A-Za-z0-9-]*$'' then lower(n.generation_label) else ''ordinal:'' || n.brand || '':'' || n.model || '':'' || n.generation_label end as generation_code'
    else 'c.' || quote_ident(column_name) end, ', ' order by ordinal_position),
    string_agg('c.' || quote_ident(column_name), ', ' order by ordinal_position)
    into named_projection, fallback_projection
  from information_schema.columns
  where table_schema = 'public' and table_name = 'cars'
    and column_name <> 'catalog_sort_published_at';

  execute 'create or replace view public.catalog_display_cascade_cars with (security_invoker=true) as select '
    || named_projection
    || ',n.generation_label,n.modification_label,n.version_line,n.compact_version,n.rules_version naming_rules_version '
    || ',c.catalog_sort_published_at '
    || 'from public.cars c join public.catalog_vehicle_names n on n.car_id=c.id '
    || 'union all select ' || fallback_projection
    || ',null::text as generation_label,null::text as modification_label,null::text as version_line '
    || ',null::text as compact_version,null::text as naming_rules_version,c.catalog_sort_published_at '
    || 'from public.cars c where not exists (select 1 from public.catalog_vehicle_names n where n.car_id=c.id)';
end
$view$;

grant select on public.catalog_display_cascade_cars to anon, authenticated, service_role;

-- Apply the indexed identity branches to aggregates only. The original view
-- stays available for the unfiltered, index-ordered first page and details.
do $function$
declare definition text;
begin
  select pg_get_functiondef('public.catalog_display_facet_options(jsonb,text[])'::regprocedure)
    into definition;
  if position('from public.catalog_display_cars c' in definition) > 0 then
    definition := replace(definition, 'predicate text :=', 'read_view text; predicate text :=');
    definition := replace(definition, 'return query execute format(', $selection$
    read_view := case when
      (selected_axis <> 'brand' and f->>'brand' is not null)
      or (selected_axis not in ('brand','model') and f->>'model' is not null)
      or (selected_axis not in ('brand','model','generation') and f->>'generation' is not null)
      or (selected_axis not in ('brand','model','generation','modification') and f->>'modification' is not null)
      or (selected_axis not in ('brand','model','generation','modification','trim') and f->>'trim' is not null)
      then 'catalog_display_cascade_cars' else 'catalog_display_cars' end;
    return query execute format($selection$);
    definition := replace(definition, 'from public.catalog_display_cars c', 'from public.%I c');
    definition := replace(definition, 'selected_axis, value_sql, label_sql,', 'selected_axis, value_sql, label_sql, read_view,');
    execute definition;
  elsif position('read_view text;' in definition) = 0 then
    raise exception 'Unexpected catalogue facet function definition';
  end if;
end
$function$;
notify pgrst, 'reload schema';
