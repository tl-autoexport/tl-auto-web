-- Persist the evidence trust level as a first-class column.
--
-- Until now the level was derived from the source URI at read time and stored
-- only implicitly through `reliability`/`review_status`, which cannot separate
-- an official manufacturer document from a press release, a dealer PDF or a
-- provisional assignment. The tier also drives the publication gate, so it must
-- be reviewable in the database rather than recomputed differently by each
-- script.
--
-- T1 official manufacturer document or technical resource.
-- T2 official manufacturer communication (press, regional site, catalogue).
-- T3 third-party/open source: publishable only with T1/T2 corroboration.
-- T4 provisional/unverified: never publishable.
alter table public.vehicle_power_evidence
  add column if not exists evidence_tier text check (evidence_tier in ('T1', 'T2', 'T3', 'T4')),
  add column if not exists evidence_tier_source text,
  add column if not exists evidence_tier_reviewed_at timestamptz;

create index if not exists vehicle_power_evidence_tier_idx
  on public.vehicle_power_evidence(evidence_tier, verification_status);

comment on column public.vehicle_power_evidence.evidence_tier is
  'Trust level used by the publication gate. T4 rows are draft and excluded from approved resolution; T3 requires T1/T2 corroboration before publication.';
comment on column public.vehicle_power_evidence.evidence_tier_source is
  'How the tier was obtained: derived_from_provenance_v1 for the initial classification.';
