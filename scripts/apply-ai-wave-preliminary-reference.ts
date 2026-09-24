/**
 * Promote reviewed AI/web research to provisional, year-scoped power references.
 *
 * This script never updates cars, calculations, prices, or publication. It only
 * writes `automatic` references, which stay preliminary until stronger evidence
 * replaces them. Existing confirmed references are treated as protected.
 */
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { Client } from "pg";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

type AiResult = {
  brand: string | null;
  model: string | null;
  year: number | null;
  engineCc: number | null;
  fuelType: string | null;
  driveType: string | null;
  listingIds: string[];
  status: string;
  confidence: string;
  exactConfigurationMatch: string;
  estimatedPowerPs: number | null;
  sources: Array<{ title?: string; url?: string; source_date?: string | null }>;
};

type Reference = {
  configuration_key: string;
  brand: string;
  model: string;
  fuel_type: string;
  engine_cc: number;
  drive_type: string | null;
  year_from: number;
  year_to: number;
  power_hp: number;
  power_kw: number;
  source: "ai_web_fallback";
  status: "automatic";
  note: string;
};

const reportPath = process.env.AI_WAVE_REPORT ?? "output/tl-auto-new-encar-ai-wave1-results.json";
const write = process.env.AI_WAVE_PRELIMINARY_WRITE === "true";
const dbUrl = process.env.SUPABASE_DB_URL;

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function referenceKey(result: AiResult) {
  return [
    normalize(result.brand), normalize(result.model), normalize(result.fuelType), result.engineCc,
    normalize(result.driveType), "", "", `year=${result.year}-${result.year}`,
  ].join("|");
}

function toReference(result: AiResult): Reference | null {
  const source = result.sources.find((item) => typeof item.url === "string" && /^https?:\/\//i.test(item.url));
  if (
    !result.brand || !result.model || !result.year || !result.engineCc || !result.fuelType ||
    result.estimatedPowerPs == null || !source?.url
  ) return null;
  const sourceLabel = [source.title?.trim(), source.url].filter(Boolean).join(" — ");
  return {
    configuration_key: referenceKey(result),
    brand: result.brand,
    model: result.model,
    fuel_type: result.fuelType,
    engine_cc: result.engineCc,
    drive_type: result.driveType,
    year_from: result.year,
    year_to: result.year,
    power_hp: result.estimatedPowerPs,
    power_kw: Number((result.estimatedPowerPs * 0.73549875).toFixed(4)),
    source: "ai_web_fallback",
    status: "automatic",
    note: `AI/web preliminary result; confidence=${result.confidence}; configuration_match=${result.exactConfigurationMatch}; listings=${result.listingIds.join(",")}; source=${sourceLabel}. Not approved TKS evidence; preliminary only.`,
  };
}

async function main() {
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
  const report = JSON.parse(await readFile(reportPath, "utf8")) as { results?: AiResult[] };
  const eligible = (report.results ?? []).filter((result) =>
    result.status === "preliminary_candidate" &&
    (result.exactConfigurationMatch === "exact" || result.exactConfigurationMatch === "close"),
  );
  const invalid = eligible.filter((result) => toReference(result) == null);
  if (invalid.length) throw new Error(`Refusing ${invalid.length} eligible result(s) without complete configuration or source URL`);
  const references = eligible.map(toReference) as Reference[];

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const keys = references.map((reference) => reference.configuration_key);
    const existing = await client.query<{ configuration_key: string; status: string }>(
      "select configuration_key,status from public.vehicle_power_automatic_reference where configuration_key=any($1::text[])",
      [keys],
    );
    const protectedKeys = existing.rows.filter((row) => row.status !== "automatic").map((row) => row.configuration_key);
    if (protectedKeys.length) throw new Error(`Refusing to overwrite protected references: ${protectedKeys.join(", ")}`);
    const existingAutomatic = new Set(existing.rows.map((row) => row.configuration_key));
    const inserts = references.filter((reference) => !existingAutomatic.has(reference.configuration_key));
    const listingCount = eligible.reduce((sum, result) => sum + result.listingIds.length, 0);
    console.log(JSON.stringify({
      write, reportPath, candidateConfigurations: references.length, candidateListings: listingCount,
      inserts: inserts.length, alreadyAutomatic: existingAutomatic.size, protected: protectedKeys.length,
      carsChanged: 0, pricesRecalculated: 0, publicationChanged: false,
    }, null, 2));
    if (!write || !inserts.length) return;

    await client.query("begin");
    await client.query(
      `insert into public.vehicle_power_automatic_reference
        (configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,year_from,year_to,power_hp,power_kw,source,status,note,updated_at)
       select x.configuration_key,x.brand,x.model,x.fuel_type,x.engine_cc,x.drive_type,null,null,
              x.year_from,x.year_to,x.power_hp,x.power_kw,x.source,x.status,x.note,now()
       from jsonb_to_recordset($1::jsonb) as x(
         configuration_key text,brand text,model text,fuel_type text,engine_cc integer,drive_type text,
         year_from integer,year_to integer,power_hp numeric,power_kw numeric,source text,status text,note text)`,
      [JSON.stringify(inserts)],
    );
    await client.query("commit");
    console.log(JSON.stringify({ applied: inserts.length, referenceOnly: true, carsChanged: 0, pricesRecalculated: 0, published: 0 }));
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
