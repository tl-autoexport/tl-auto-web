-- A published card must carry the canonical provenance fields.
--
-- The standard requires every card to declare where its publication date came
-- from, when it entered our catalogue, and whether the Encar enrichment was
-- applied. Until now those were filled by a separate backfill, so a writer that
-- bypassed it could publish without them — which is how the catalogue drifted.
--
-- The constraint is added NOT VALID on purpose: existing rows are not checked at
-- creation, but every INSERT and UPDATE is, so a writer that skips the canonical
-- layer now fails loudly instead of adding another card without provenance.
-- It is validated right after the backfill fills the remaining rows.
alter table public.cars drop constraint if exists cars_published_requires_canonical_provenance;
alter table public.cars add constraint cars_published_requires_canonical_provenance
  check (
    not is_available
    or (
      published_at_source is not null
      and catalog_added_at is not null
      and encar_enrichment_status is not null
    )
  ) not valid;

comment on constraint cars_published_requires_canonical_provenance on public.cars is
  'A published card must state its publication-date provenance, when it entered the catalogue and its enrichment status. Enforced on writes so a bypassing publisher cannot add a card without them.';
