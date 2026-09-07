-- Persist the staging audit result without promoting any value to a calculation.
alter table public.vehicle_power_source_rows
  add column if not exists review_classification text check (review_classification in (
    '30_min_candidate', 'peak_or_fallback', 'range_or_ambiguous', 'non_power_note'
  )),
  add column if not exists classification_rule_version text,
  add column if not exists classified_at timestamptz;

create index if not exists vehicle_power_source_rows_classification_idx
  on public.vehicle_power_source_rows(review_classification, parse_status);

comment on column public.vehicle_power_source_rows.review_classification is
  'Staging audit label only; it never authorizes calculator use.';
