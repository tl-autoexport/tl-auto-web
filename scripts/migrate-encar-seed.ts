import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { Client as PgClient } from "pg";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

type Row = Record<string, unknown>;
type FilterQuery = {
  eq(column: string, value: unknown): FilterQuery;
  in(column: string, values: readonly unknown[]): FilterQuery;
};
type QueryResponse = {
  data: unknown[] | null;
  error: { message: string } | null;
};

const sourceUrl = process.env.SOURCE_SUPABASE_URL;
const sourceKey = process.env.SOURCE_SUPABASE_READ_KEY;
const sourceDbUrl = process.env.SOURCE_SUPABASE_DB_URL;
const targetUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const targetKey =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.env.MIGRATION_DRY_RUN !== "false";
const pageSize = 1_000;
const relationChunkSize = 100;

if (!sourceUrl || !sourceKey) {
  throw new Error(
    "SOURCE_SUPABASE_URL and SOURCE_SUPABASE_READ_KEY are required",
  );
}
if (!targetUrl || !targetKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required",
  );
}

const source = createClient(sourceUrl, sourceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const target = createClient(targetUrl, targetKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function fetchAll(
  client: SupabaseClient,
  table: string,
  filter?: (query: FilterQuery) => FilterQuery,
) {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const baseQuery = client
      .from(table)
      .select("*")
      .range(offset, offset + pageSize - 1);
    const filteredQuery = filter
      ? filter(baseQuery as unknown as FilterQuery)
      : baseQuery;
    const { data, error } = await (filteredQuery as unknown as PromiseLike<QueryResponse>);
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    const batch = (data ?? []) as Row[];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
}

async function fetchByCarIds(client: SupabaseClient, table: string, carIds: string[]) {
  const rows: Row[] = [];
  for (let offset = 0; offset < carIds.length; offset += relationChunkSize) {
    const ids = carIds.slice(offset, offset + relationChunkSize);
    const batch = await fetchAll(client, table, (query) => query.in("car_id", ids));
    rows.push(...batch);
  }
  return rows;
}

async function readFromSourceDatabase() {
  if (!sourceDbUrl) return null;
  const client = new PgClient({
    connectionString: sourceDbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const cars = (await client.query(
      "select * from public.cars where primary_source = $1 order by id",
      ["encar"],
    )).rows as Row[];
    const carIds = cars.map((car) => car.id).filter((id): id is string => typeof id === "string");
    const related = async (table: string) =>
      (await client.query(`select * from public.${table} where car_id = any($1::uuid[])`, [carIds])).rows as Row[];
    const media = await related("car_media");
    const options = await related("car_options");
    const reports = await related("car_condition_reports");
    const calculations = await related("calc_snapshots");
    return { cars, media, options, reports, calculations };
  } finally {
    await client.end();
  }
}

async function writeRows(table: string, rows: Row[]) {
  if (dryRun || rows.length === 0) return;
  for (let offset = 0; offset < rows.length; offset += 500) {
    const batch = rows.slice(offset, offset + 500);
    const { error } = await target.from(table).upsert(batch, { onConflict: "id" });
    if (error) throw new Error(`${table} write failed: ${error.message}`);
  }
}

async function main() {
  const databaseRows = await readFromSourceDatabase();
  const cars = databaseRows?.cars ?? (await fetchAll(source, "cars", (query) =>
    query.eq("primary_source", "encar"),
  ));
  const carIds = cars
    .map((car) => car.id)
    .filter((id): id is string => typeof id === "string");
  const media = databaseRows?.media ?? (await fetchByCarIds(source, "car_media", carIds));
  const options = databaseRows?.options ?? (await fetchByCarIds(source, "car_options", carIds));
  const reports = databaseRows?.reports ?? (await fetchByCarIds(source, "car_condition_reports", carIds));
  const calculations = databaseRows?.calculations ?? (await fetchByCarIds(source, "calc_snapshots", carIds));

  const counts = {
    cars: cars.length,
    car_media: media.length,
    car_options: options.length,
    car_condition_reports: reports.length,
    calc_snapshots: calculations.length,
  };

  if (!dryRun) {
    await writeRows("cars", cars);
    await writeRows("car_media", media);
    await writeRows("car_options", options);
    await writeRows("car_condition_reports", reports);
    await writeRows("calc_snapshots", calculations);
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        source: "autoexport",
        readMode: databaseRows ? "source-postgres" : "source-rest",
        included: [
          "cars where primary_source=encar",
          "car_media",
          "car_options",
          "car_condition_reports",
          "calc_snapshots",
        ],
        excluded: ["auth", "leads", "lead_events", "source_snapshots", "HeyDealer"],
        counts,
        written: dryRun ? 0 : counts,
        preservedCarIds: true,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
