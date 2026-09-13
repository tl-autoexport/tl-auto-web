-- Per-project Encar freshness queue. The worker advances each car independently
-- so retries and partial runs do not require OFFSET-based pagination.
alter table public.cars
  add column if not exists next_encar_check_at timestamptz,
  add column if not exists encar_check_status text,
  add column if not exists encar_check_attempts integer not null default 0,
  add column if not exists encar_check_error text,
  add column if not exists encar_price_checked_at timestamptz;

create index if not exists cars_encar_check_queue_idx
  on public.cars(primary_source, is_available, next_encar_check_at, source_updated_at);
