alter table public.car_options
  add column if not exists source_code text,
  add column if not exists description_original text,
  add column if not exists description_ru text;

create index if not exists car_options_source_code_idx
  on public.car_options(source, source_code);

create unique index if not exists car_condition_reports_source_type_uidx
  on public.car_condition_reports(car_id, source, report_type);
