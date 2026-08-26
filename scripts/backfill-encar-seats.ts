import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { encarClient } from "../src/server/imports/encar-client";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const ENCAR_DETAIL_URL = "https://api.encar.com/v1/readside/vehicle";
type CarRow = {
  id: string;
  source_id: string;
  vehicle_specs: Record<string, unknown> | null;
};

type EncarDetail = {
  spec?: { seatCount?: number | null };
};

async function fetchSeats(sourceId: string) {
  const payload = await encarClient.request<EncarDetail>(`${ENCAR_DETAIL_URL}/${sourceId}`, {}, 1);
  const seats = payload.spec?.seatCount;
  return typeof seats === "number" && Number.isInteger(seats) && seats > 0
    ? seats
    : null;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase variables are not configured");

  const write = process.env.ENCAR_SEATS_DRY_RUN === "false";
  if (write && !process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Write mode requires SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rows: CarRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("cars")
      .select("id, source_id, vehicle_specs")
      .eq("primary_source", "encar")
      .eq("is_available", true)
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as CarRow[]));
    if (!data || data.length < 1000) break;
  }

  const candidates = rows.filter(
    (row) => typeof row.vehicle_specs?.seats !== "number",
  );
  const concurrency = Math.max(
    1,
    Math.min(8, Number(process.env.ENCAR_SEATS_CONCURRENCY ?? 6)),
  );
  const results: Array<Record<string, unknown>> = [];
  let cursor = 0;

  async function worker() {
    while (cursor < candidates.length) {
      const row = candidates[cursor];
      cursor += 1;
      try {
        const seats = await fetchSeats(row.source_id);
        if (seats == null) {
          results.push({ sourceId: row.source_id, status: "missing" });
          continue;
        }
        if (write) {
          const vehicleSpecs = { ...(row.vehicle_specs ?? {}), seats };
          const { error } = await supabase
            .from("cars")
            .update({ vehicle_specs: vehicleSpecs })
            .eq("id", row.id);
          if (error) throw error;
        }
        results.push({
          sourceId: row.source_id,
          seats,
          status: write ? "written" : "would_write",
        });
      } catch (error) {
        results.push({
          sourceId: row.source_id,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: concurrency }, () => worker()),
  );
  const counts = results.reduce<Record<string, number>>((acc, result) => {
    const status = String(result.status);
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    JSON.stringify(
      {
        write,
        totalActiveEncar: rows.length,
        candidates: candidates.length,
        counts,
        sample: results.slice(0, 12),
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
