#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pg_bin="${POWER_SYNC_PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
for tool in initdb pg_ctl createdb psql; do test -x "$pg_bin/$tool" || { echo "Missing PostgreSQL tool: $pg_bin/$tool"; exit 1; }; done
sandbox="$(mktemp -d /tmp/tl-power-sync-test.XXXXXX)"
port="$(node -e 'const n=require("node:net").createServer();n.listen(0,"127.0.0.1",()=>{console.log(n.address().port);n.close()})')"
cleanup(){ "$pg_bin/pg_ctl" -D "$sandbox/db" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$sandbox"; }
trap cleanup EXIT
"$pg_bin/initdb" -D "$sandbox/db" -A trust --no-locale >"$sandbox/init.log"
"$pg_bin/pg_ctl" -D "$sandbox/db" -l "$sandbox/pg.log" -o "-p $port -h 127.0.0.1 -k $sandbox" start >"$sandbox/start.log"
export PGHOST=127.0.0.1 PGPORT="$port"
"$pg_bin/createdb" tl_sync_canary_test
"$pg_bin/psql" -d tl_sync_canary_test -v ON_ERROR_STOP=1 -c 'create role anon; create role authenticated; create table public.cars(id uuid primary key); create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;' >"$sandbox/bootstrap.log"
for file in 20260906_vehicle_power_reference.sql 20260907_automatic_power_reference.sql 20260907_power_resolution_workflow.sql 20261024_vehicle_power_sync.sql; do
 "$pg_bin/psql" -d tl_sync_canary_test -v ON_ERROR_STOP=1 -f "supabase/migrations/$file" >>"$sandbox/migrations.log"
done
"$pg_bin/psql" -d tl_sync_canary_test -v ON_ERROR_STOP=1 -c 'create role tl_sync_canary_worker login; grant tl_auto_power_sync to tl_sync_canary_worker;' >"$sandbox/worker.log"
POWER_SYNC_TEST_ADMIN_URL="postgresql://${USER}@127.0.0.1:$port/tl_sync_canary_test" POWER_SYNC_TEST_WORKER_URL="postgresql://tl_sync_canary_worker@127.0.0.1:$port/tl_sync_canary_test" npx tsx --test src/server/power-sync/sync/canary-postgres.test.ts
