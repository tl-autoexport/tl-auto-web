import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
const dryRun = process.env.POWER_QUEUE_DRY_RUN !== "false";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type Car = {
  brand: string | null;
  model: string | null;
  fuel_type: string | null;
  engine_cc: number | null;
  drive_type: string | null;
  badge: string | null;
  badge_detail: string | null;
  year: number | null;
  power_source: string | null;
  power_hp: number | null;
};

type Group = {
  configurationKey: string;
  brand: string | null;
  model: string | null;
  fuel_type: string | null;
  engine_cc: number | null;
  drive_type: string | null;
  badge: string | null;
  badge_detail: string | null;
  years: number[];
  cardsCount: number;
  sources: Record<string, number>;
  priority: number;
  requiredEvidence: Set<string>;
};

function text(value: string | null) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function sourcePriority(source: string | null, fuel: string | null) {
  if (!source) return { priority: 1, evidence: "power certificate or manufacturer document" };
  if (fuel === "electric") return { priority: 1, evidence: "30-minute electric power from SBKTS/EPTS or manufacturer document" };
  if (source === "engine_fallback") return { priority: 2, evidence: "exact engine/trim specification document" };
  if (source.includes("map")) return { priority: 3, evidence: "exact trim, engine and year confirmation" };
  return { priority: 4, evidence: "source document for exact configuration" };
}

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const result = await client.query<Car>(
      `select brand, model, fuel_type, engine_cc, drive_type, badge, badge_detail,
              year, power_source, power_hp
         from public.cars
        where is_available = true and vehicle_type = 'car'`,
    );
    const groups = new Map<string, Group>();
    for (const car of result.rows) {
      const configurationKey = [
        text(car.brand), text(car.model), text(car.fuel_type), car.engine_cc ?? "unknown",
        text(car.drive_type), text(car.badge), text(car.badge_detail),
      ].join("|");
      const group = groups.get(configurationKey) ?? {
        configurationKey,
        brand: car.brand,
        model: car.model,
        fuel_type: car.fuel_type,
        engine_cc: car.engine_cc,
        drive_type: car.drive_type,
        badge: car.badge,
        badge_detail: car.badge_detail,
        years: [],
        cardsCount: 0,
        sources: {},
        priority: 50,
        requiredEvidence: new Set<string>(),
      };
      group.cardsCount += 1;
      if (car.year != null) group.years.push(car.year);
      const source = car.power_source ?? "missing";
      group.sources[source] = (group.sources[source] ?? 0) + 1;
      const request = sourcePriority(car.power_source, car.fuel_type);
      group.priority = Math.min(group.priority, request.priority);
      group.requiredEvidence.add(request.evidence);
      groups.set(configurationKey, group);
    }
    const rows = [...groups.values()].sort((a, b) => a.priority - b.priority || b.cardsCount - a.cardsCount);
    if (!dryRun) {
      await client.query("begin");
      const payload = rows.map((row) => ({
        configuration_key: row.configurationKey,
        brand: row.brand,
        model: row.model,
        fuel_type: row.fuel_type,
        engine_cc: row.engine_cc,
        drive_type: row.drive_type,
        badge: row.badge,
        badge_detail: row.badge_detail,
        year_from: row.years.length ? Math.min(...row.years) : null,
        year_to: row.years.length ? Math.max(...row.years) : null,
        cards_count: row.cardsCount,
        current_sources: row.sources,
        priority: row.priority,
        required_evidence: [...row.requiredEvidence],
      }));
      await client.query(
        `insert into public.vehicle_power_review_queue
           (configuration_key, brand, model, fuel_type, engine_cc, drive_type, badge,
            badge_detail, year_from, year_to, cards_count, current_sources, priority,
            required_evidence, last_seen_at)
         select incoming.configuration_key, incoming.brand, incoming.model, incoming.fuel_type,
                incoming.engine_cc, incoming.drive_type, incoming.badge, incoming.badge_detail,
                incoming.year_from, incoming.year_to, incoming.cards_count, incoming.current_sources,
                incoming.priority, incoming.required_evidence, now()
           from jsonb_to_recordset($1::jsonb) as incoming(
             configuration_key text, brand text, model text, fuel_type text, engine_cc integer,
             drive_type text, badge text, badge_detail text, year_from integer, year_to integer,
             cards_count integer, current_sources jsonb, priority integer, required_evidence text[]
           )
         on conflict (configuration_key) do update set
           cards_count = excluded.cards_count,
           current_sources = excluded.current_sources,
           priority = least(vehicle_power_review_queue.priority, excluded.priority),
           required_evidence = excluded.required_evidence,
           last_seen_at = excluded.last_seen_at,
           updated_at = now()`,
        [JSON.stringify(payload)],
      );
      await client.query("commit");
    }
    console.log(JSON.stringify({
      dryRun,
      activeCars: result.rowCount,
      configurations: rows.length,
      policy: "Queue metadata only; no car or price field is changed.",
      top: rows.slice(0, 30).map((row) => ({
        configurationKey: row.configurationKey,
        brand: row.brand,
        model: row.model,
        fuel: row.fuel_type,
        engineCc: row.engine_cc,
        years: row.years.length ? [Math.min(...row.years), Math.max(...row.years)] : [],
        cards: row.cardsCount,
        sources: row.sources,
        priority: row.priority,
      })),
    }, null, 2));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
