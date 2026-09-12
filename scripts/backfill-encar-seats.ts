import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { ENCAR_HEADERS } from "../src/server/imports/encar-client";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const ENCAR_FEM_DETAIL_URL = "https://fem.encar.com/cars/detail";
type CarRow = {
  id: string;
  primary_source: string;
  source_url: string | null;
  source_id: string;
  vehicle_specs: Record<string, unknown> | null;
};

async function fetchSeatsOnce(sourceId: string) {
  // The readside API host is intermittently blocked by rate limiting, while
  // the public FEM card stays reachable and embeds the whole detail payload,
  // including "seatCount", in its HTML.
  const response = await fetch(`${ENCAR_FEM_DETAIL_URL}/${sourceId}`, {
    headers: ENCAR_HEADERS,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Encar HTTP ${response.status}`);
  const html = await response.text();
  const seats = Number(html.match(/"seatCount":\s*(\d+)/)?.[1] ?? "");
  return Number.isInteger(seats) && seats > 0 ? seats : null;
}

async function fetchSeatsWithRetry(sourceId: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetchSeatsOnce(sourceId);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

/**
 * The Chesty listing id is itself an Encar carid, while `source_url` can point
 * to an older, already removed carid. Try the link first and fall back to the
 * listing id so a stale URL does not lose otherwise available seat data.
 */
function encarSourceIds(row: Pick<CarRow, "source_id" | "source_url">) {
  const urlId = row.source_url?.match(/[?&]carid=(\d+)/i)?.[1] ?? null;
  return [...new Set([urlId, row.source_id].filter((value): value is string => Boolean(value)))];
}

async function fetchSeats(sourceIds: string[]) {
  for (const sourceId of sourceIds) {
    try {
      const seats = await fetchSeatsWithRetry(sourceId);
      if (seats != null) return seats;
    } catch {
      // A dead carid only means the next candidate id may still resolve.
    }
  }
  return null;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase variables are not configured");

  const write = process.env.ENCAR_SEATS_DRY_RUN === "false";
  const requestedIds = new Set((process.env.ENCAR_SEATS_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
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
      .select("id, primary_source, source_id, source_url, vehicle_specs")
      .in("primary_source", ["encar", "chestny_prigon"])
      .eq("is_available", true)
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as CarRow[]));
    if (!data || data.length < 1000) break;
  }

  const candidates = rows.filter(
    (row) => typeof row.vehicle_specs?.seats !== "number" &&
      (!requestedIds.size ||
        requestedIds.has(row.source_id) ||
        encarSourceIds(row).some((id) => requestedIds.has(id))),
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
        const seats = await fetchSeats(encarSourceIds(row));
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
