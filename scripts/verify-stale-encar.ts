import { config } from "dotenv";
import { createSupabaseAdmin } from "../src/server/supabase/admin";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const ENCAR_DETAIL_URL = "https://api.encar.com/v1/readside/vehicle";
const headers = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "ko-KR,ko;q=0.8,en;q=0.6",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36",
  Referer: "https://www.encar.com/",
};

type StaleCar = {
  id: string;
  source_id: string;
  source_updated_at: string | null;
  last_seen_at: string | null;
};

type EncarDetailPayload = {
  manage?: {
    modifyDateTime?: string;
    firstAdvertisedDateTime?: string;
  };
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
  const staleDays = positiveInt(process.env.ENCAR_STALE_DAYS, 60);
  const limit = Math.min(
    positiveInt(process.env.ENCAR_STALE_VERIFY_LIMIT, 250),
    1_000,
  );
  const threshold = new Date(
    Date.now() - staleDays * 24 * 60 * 60 * 1_000,
  ).toISOString();
  const supabase = createSupabaseAdmin();
  const { data, error } = await supabase
    .from("cars")
    .select("id, source_id, source_updated_at, last_seen_at")
    .eq("primary_source", "encar")
    .eq("is_available", true)
    .or(`source_updated_at.is.null,source_updated_at.lt.${threshold}`)
    .order("source_updated_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) throw error;
  const candidates = (data ?? []) as StaleCar[];
  const confirmedUnavailable: StaleCar[] = [];
  const active: Array<{ car: StaleCar; modifiedAt: string | null }> = [];
  const uncertain: Array<{ car: StaleCar; status?: number; error?: string }> = [];

  for (const car of candidates) {
    try {
      const response = await fetch(`${ENCAR_DETAIL_URL}/${car.source_id}`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 404 || response.status === 410) {
        confirmedUnavailable.push(car);
      } else if (response.ok) {
        const payload = (await response.json()) as EncarDetailPayload;
        active.push({
          car,
          modifiedAt: payload.manage?.modifyDateTime ?? null,
        });
      } else {
        uncertain.push({ car, status: response.status });
      }
    } catch (error) {
      uncertain.push({
        car,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await sleep(80);
  }

  if (!dryRun) {
    const checkedAt = new Date().toISOString();
    const unavailableIds = confirmedUnavailable.map((car) => car.id);
    for (let from = 0; from < unavailableIds.length; from += 100) {
      const { error: updateError } = await supabase
        .from("cars")
        .update({
          is_available: false,
          sale_status: "source_unavailable",
          last_seen_at: checkedAt,
        })
        .in("id", unavailableIds.slice(from, from + 100));
      if (updateError) throw updateError;
    }

    for (const { car, modifiedAt } of active) {
      const { error: updateError } = await supabase
        .from("cars")
        .update({
          last_seen_at: checkedAt,
          // This field is also the freshness cursor for the verifier. If the
          // source has no modification timestamp, the successful live check
          // itself is the latest authoritative freshness signal.
          source_updated_at: modifiedAt ?? checkedAt,
        })
        .eq("id", car.id);
      if (updateError) throw updateError;
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        staleDays,
        threshold,
        checked: candidates.length,
        confirmedUnavailable: confirmedUnavailable.length,
        deactivated: dryRun ? 0 : confirmedUnavailable.length,
        active: active.length,
        uncertain: uncertain.length,
        unavailableSample: confirmedUnavailable.slice(0, 10).map((car) => ({
          sourceId: car.source_id,
          sourceUpdatedAt: car.source_updated_at,
          lastSeenAt: car.last_seen_at,
        })),
        activeSample: active.slice(0, 5).map(({ car, modifiedAt }) => ({
          sourceId: car.source_id,
          storedUpdatedAt: car.source_updated_at,
          storedLastSeenAt: car.last_seen_at,
          sourceModifiedAt: modifiedAt,
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
