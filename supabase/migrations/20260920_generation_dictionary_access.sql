-- Public read access for the generation dictionary and the facet functions.
--
-- The dictionary is not sensitive — it maps a source string to a Russian label —
-- but it must not be writable from the browser. Row level security is enabled
-- with a read-only policy, write privileges are revoked, and the read is granted
-- explicitly so the public catalogue can render labels.
--
-- The facet functions run with the caller's privileges, so they need execute
-- permission and the dictionary read policy above.
alter table public.catalog_generation_dictionary enable row level security;

drop policy if exists "Public can read the generation dictionary" on public.catalog_generation_dictionary;
create policy "Public can read the generation dictionary"
  on public.catalog_generation_dictionary for select using (true);

revoke insert, update, delete on public.catalog_generation_dictionary from anon, authenticated;
grant select on public.catalog_generation_dictionary to anon, authenticated;

grant execute on function public.catalog_match(public.cars, jsonb, text) to anon, authenticated;
grant execute on function public.catalog_listing_count(jsonb) to anon, authenticated;
grant execute on function public.catalog_facets(jsonb) to anon, authenticated;
