import { config } from "dotenv";
import { createSupabaseAdmin } from "../src/server/supabase/admin";
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const ENCAR_DETAIL_URL = "https://fem.encar.com/cars/detail";
const DELETED_MARKERS = [
  "이 차량은 판매되었거나 삭제된 차량입니다.",
  "이 차량은 판매되었거나 삭제된 차량입니다",
];
type StaleCar = {
  id: string;
  primary_source: string;
  source_id: string;
  source_url: string | null;
  last_checked_at: string | null;
  last_seen_at: string | null;
  revalidation_miss_count: number;
};

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const dryRun = process.env.ENCAR_STALE_DRY_RUN !== "false";
  const limit = Math.min(
    positiveInt(process.env.ENCAR_STALE_VERIFY_LIMIT, 250),
    1_000,
  );
  const concurrency = Math.min(positiveInt(process.env.ENCAR_STALE_CONCURRENCY, 3), 4);
  const delayMs = Math.max(500, positiveInt(process.env.ENCAR_STALE_DELAY_MS, 1_000));
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("cars")
    .select("id, primary_source, source_id, source_url, last_checked_at, last_seen_at, revalidation_miss_count")
    .eq("is_available", true)
    .in("primary_source", ["encar", "chestny_prigon"])
    .not("source_url", "is", null)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) throw error;
  const candidates = (data ?? []) as StaleCar[];
  const confirmedUnavailable: StaleCar[] = [];
  const active: StaleCar[] = [];
  const uncertain: Array<{ car: StaleCar; status?: number; error?: string }> = [];

  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      const car = candidates[cursor++];
      if (!car) return;
      try {
        const encarId = car.source_url?.match(/[?&]carid=(\d+)/i)?.[1] ?? car.source_id;
        const response = await fetch(`${ENCAR_DETAIL_URL}/${encodeURIComponent(encarId)}`, {
          headers: { accept: "text/html,application/xhtml+xml" },
          signal: AbortSignal.timeout(15_000),
        });
        const html = await response.text();
        const hasDeletedMarker = DELETED_MARKERS.some((marker) => html.includes(marker));
        if (hasDeletedMarker) confirmedUnavailable.push(car);
        else if (response.ok) active.push(car);
        else uncertain.push({ car, status: response.status });
      } catch (error) {
        uncertain.push({ car, error: error instanceof Error ? error.message : String(error) });
      }
      await sleep(delayMs);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, () => worker()));

  let hidden = 0;
  if (!dryRun) {
    const checkedAt = new Date().toISOString();
    const { data: revalidationData, error: revalidationError } = await supabase.rpc("apply_catalog_revalidation", {
      p_found_source_ids: active.map((car) => car.source_id),
      p_missing_source_ids: confirmedUnavailable.map((car) => car.source_id),
      p_checked_at: checkedAt,
      p_hide_after: 1,
    });
    if (revalidationError) throw revalidationError;
    hidden = Number(revalidationData?.[0]?.hidden_count ?? 0);
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        concurrency,
        delayMs,
        checked: candidates.length,
        confirmedUnavailable: confirmedUnavailable.length,
        deactivated: hidden,
        active: active.length,
        uncertain: uncertain.length,
        unavailableSample: confirmedUnavailable.slice(0, 10).map((car) => ({
          sourceId: car.source_id,
          lastCheckedAt: car.last_checked_at,
          lastSeenAt: car.last_seen_at,
        })),
        activeSample: active.slice(0, 5).map((car) => ({
          sourceId: car.source_id,
          lastCheckedAt: car.last_checked_at,
          storedLastSeenAt: car.last_seen_at,
        })),
        uncertainSample: uncertain.slice(0, 5).map(({ car, status, error }) => ({
          sourceId: car.source_id,
          status,
          error,
        })),
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
