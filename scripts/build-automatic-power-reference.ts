import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
const dryRun = process.env.AUTOMATIC_POWER_REFERENCE_DRY_RUN !== "false";
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
  power_hp: number | null;
  power_source: string | null;
};

function normalize(value: string | null) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const result = await client.query<Car>(
      `select brand, model, fuel_type, engine_cc, drive_type, badge, badge_detail,
              year, power_hp, power_source
         from public.cars
        where is_available = true and vehicle_type = 'car' and power_hp is not null`,
    );
    const grouped = new Map<string, {
      configurationKey: string;
      brand: string | null;
      model: string | null;
      fuel_type: string | null;
      engine_cc: number | null;
      drive_type: string | null;
      badge: string | null;
      badge_detail: string | null;
      years: number[];
      powers: number[];
      sources: Record<string, number>;
    }>();
    for (const car of result.rows) {
      const configurationKey = [normalize(car.brand), normalize(car.model), normalize(car.fuel_type), car.engine_cc ?? "unknown", normalize(car.drive_type), normalize(car.badge), normalize(car.badge_detail)].join("|");
      const group = grouped.get(configurationKey) ?? {
        configurationKey,
        brand: car.brand,
        model: car.model,
        fuel_type: car.fuel_type,
        engine_cc: car.engine_cc,
        drive_type: car.drive_type,
        badge: car.badge,
        badge_detail: car.badge_detail,
        years: [],
        powers: [],
        sources: {},
      };
      if (car.year != null) group.years.push(car.year);
      if (car.power_hp != null) group.powers.push(Number(car.power_hp));
      const source = car.power_source ?? "unknown";
      group.sources[source] = (group.sources[source] ?? 0) + 1;
      grouped.set(configurationKey, group);
    }
    const rows = [...grouped.values()].map((group) => {
      const uniquePowers = [...new Set(group.powers.map((power) => Number(power.toFixed(4))))];
      const powerHp = uniquePowers.length === 1 ? uniquePowers[0] : null;
      return {
        configuration_key: group.configurationKey,
        brand: group.brand,
        model: group.model,
        fuel_type: group.fuel_type,
        engine_cc: group.engine_cc,
        drive_type: group.drive_type,
        badge: group.badge,
        badge_detail: group.badge_detail,
        year_from: group.years.length ? Math.min(...group.years) : null,
        year_to: group.years.length ? Math.max(...group.years) : null,
        power_hp: powerHp,
        power_kw: powerHp == null ? null : Number((powerHp / 1.35962).toFixed(4)),
        source: Object.entries(group.sources).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown",
        note: powerHp == null
          ? "Несколько значений мощности в одной конфигурации; требуется ручная проверка."
          : "Предварительное автоматическое сопоставление из текущего каталога; не является подтверждённой спецификацией TKS.",
      };
    });
    const payload = rows.filter((row) => row.power_hp != null);
    if (!dryRun && payload.length) {
      await client.query("begin");
      await client.query(
        `insert into public.vehicle_power_automatic_reference
           (configuration_key, brand, model, fuel_type, engine_cc, drive_type, badge,
            badge_detail, year_from, year_to, power_hp, power_kw, source, note, updated_at)
         select incoming.configuration_key, incoming.brand, incoming.model, incoming.fuel_type,
                incoming.engine_cc, incoming.drive_type, incoming.badge, incoming.badge_detail,
                incoming.year_from, incoming.year_to, incoming.power_hp, incoming.power_kw,
                incoming.source, incoming.note, now()
           from jsonb_to_recordset($1::jsonb) as incoming(
             configuration_key text, brand text, model text, fuel_type text, engine_cc integer,
             drive_type text, badge text, badge_detail text, year_from integer, year_to integer,
             power_hp numeric, power_kw numeric, source text, note text
           )
         on conflict (configuration_key) do update set
           year_from = excluded.year_from, year_to = excluded.year_to,
           power_hp = excluded.power_hp, power_kw = excluded.power_kw,
           source = excluded.source, note = excluded.note, updated_at = now()
          where vehicle_power_automatic_reference.status = 'automatic'`,
        [JSON.stringify(payload)],
      );
      await client.query("commit");
    }
    console.log(JSON.stringify({
      dryRun,
      activeCarsWithPower: result.rowCount,
      configurations: rows.length,
      automaticReferencesWritten: dryRun ? 0 : payload.length,
      policy: "Provisional only; approved TKS evidence remains separate and prices are unchanged.",
      inconsistentConfigurations: rows.filter((row) => row.power_hp == null).length,
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
