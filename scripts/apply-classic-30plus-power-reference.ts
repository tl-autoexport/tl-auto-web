/**
 * Add the reviewed 34-listing classic-30plus power cohort to the provisional
 * automatic power reference. No cars, calculations, prices, TKS approvals, or
 * publication rows are changed. Defaults to a DB-verified dry run.
 */
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const manifestPath = process.env.CLASSIC_POWER_REFERENCE_MANIFEST ??
  "data/power/classic-30plus-7921c86f-preliminary-v1.json";
const write = process.env.CLASSIC_POWER_REFERENCE_WRITE === "true";
const dbUrl = process.env.SUPABASE_DB_URL;
const runId = "7921c86f-1ced-484d-a1d5-22b9a8a8220d";
const psToKw = 0.73549875;

type Manifest = {
  version: string;
  runId: string;
  excludedListingIds: string[];
  records: Array<{
    brand: string; model: string; year: number; engineCc: number; fuelType: string;
    powerPs: number; listingIds: string[]; sourceUrl: string; note: string;
  }>;
};
type RefRow = {
  configuration_key: string; brand: string; model: string; fuel_type: string;
  engine_cc: number; drive_type: string | null; badge: string | null;
  badge_detail: string | null; year_from: number; year_to: number;
  power_hp: number; power_kw: number; source: string; status: "automatic";
  note: string;
};

const normalize = (value: string | null | undefined) => (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const referenceKey = (r: Manifest["records"][number]) =>
  [normalize(r.brand), normalize(r.model), normalize(r.fuelType), r.engineCc, "", "", "", `year=${r.year}-${r.year}`].join("|");

async function main() {
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  if (manifest.runId !== runId || manifest.version !== "classic-30plus-7921c86f-preliminary-v1")
    throw new Error("Classic cohort manifest/version/run ID mismatch");
  const rows: RefRow[] = manifest.records.map((r) => ({
    configuration_key: referenceKey(r), brand: r.brand, model: r.model, fuel_type: r.fuelType,
    engine_cc: r.engineCc, drive_type: null, badge: null, badge_detail: null,
    year_from: r.year, year_to: r.year, power_hp: r.powerPs,
    power_kw: Number((r.powerPs * psToKw).toFixed(4)),
    source: "classic_30plus_manual_web", status: "automatic",
    note: `Preliminary only; not approved TKS evidence. Run ${runId}; listing IDs ${r.listingIds.join(", ")}. ${r.note} Source: ${r.sourceUrl}`,
  }));
  const listingIds = manifest.records.flatMap((r) => r.listingIds);
  if (manifest.records.length !== 29 || listingIds.length !== 34 || new Set(listingIds).size !== 34 ||
      listingIds.some((id) => manifest.excludedListingIds.includes(id)) ||
      !manifest.excludedListingIds.includes("35765946") ||
      new Set(rows.map((r) => r.configuration_key)).size !== rows.length)
    throw new Error(`Manifest integrity failed: configurations=${rows.length}, listings=${listingIds.length}`);
  if (rows.some((r) => !r.source || !r.note.includes("https://") || !Number.isFinite(r.power_kw)))
    throw new Error("A candidate lacks a source, note, or valid PS-to-kW conversion");

  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin read only");
    const staging = await db.query<{ source_listing_id: string; status: string }>(
      `select source_listing_id,status from public.encar_enrichment_staging
       where run_id=$1 and source_listing_id=any($2::text[])`, [runId, listingIds],
    );
    if (staging.rows.length !== listingIds.length || staging.rows.some((r) => r.status !== "succeeded"))
      throw new Error(`Run staging mismatch: expected ${listingIds.length} succeeded rows, got ${staging.rows.length}`);
    const existing = await db.query<{
      configuration_key: string; status: string; power_hp: string | null; source: string;
    }>(`select configuration_key,status,power_hp::text,source from public.vehicle_power_automatic_reference
        where configuration_key=any($1::text[])`, [rows.map((r) => r.configuration_key)]);
    await db.query("rollback");

    const existingByKey = new Map(existing.rows.map((r) => [r.configuration_key, r]));
    const protectedRows = rows.filter((r) => {
      const old = existingByKey.get(r.configuration_key);
      return old && (old.status !== "automatic" || Number(old.power_hp) !== r.power_hp);
    });
    if (protectedRows.length) throw new Error(`Existing non-automatic or conflicting references; no writes: ${JSON.stringify(protectedRows.map((r) => ({ key: r.configuration_key, proposed: r.power_hp, existing: existingByKey.get(r.configuration_key) })))}`);
    const insertRows = rows.filter((r) => !existingByKey.has(r.configuration_key));
    console.log(JSON.stringify({
      write, runId, preliminaryConfigurations: rows.length, listingCount: listingIds.length,
      skippedListingIds: manifest.excludedListingIds,
      newReferences: insertRows.length,
      alreadyPresentSameAutomaticReferences: existing.rows.length - protectedRows.length,
      effects: { carsChanged: 0, tksSpecsApproved: 0, calculationsChanged: 0, pricesChanged: 0, publicationChanged: 0 },
      proposed: rows.map(({ configuration_key, brand, model, year_from, engine_cc, power_hp, note }) => ({ configuration_key, brand, model, year: year_from, engineCc: engine_cc, powerPs: power_hp, note })),
    }, null, 2));
    if (!write || !insertRows.length) return;

    await db.query("begin");
    await db.query(
      `insert into public.vehicle_power_automatic_reference
       (configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,
        year_from,year_to,power_hp,power_kw,source,status,note,updated_at)
       select x.configuration_key,x.brand,x.model,x.fuel_type,x.engine_cc,x.drive_type,x.badge,x.badge_detail,
              x.year_from,x.year_to,x.power_hp,x.power_kw,x.source,x.status,x.note,now()
       from jsonb_to_recordset($1::jsonb) as x(
        configuration_key text,brand text,model text,fuel_type text,engine_cc integer,drive_type text,
        badge text,badge_detail text,year_from integer,year_to integer,power_hp numeric,power_kw numeric,
        source text,status text,note text)` , [JSON.stringify(insertRows)],
    );
    const verify = await db.query<{ count: string }>(
      `select count(*)::text as count from public.vehicle_power_automatic_reference
       where configuration_key=any($1::text[]) and source='classic_30plus_manual_web' and status='automatic'`,
      [insertRows.map((r) => r.configuration_key)],
    );
    if (Number(verify.rows[0]?.count) !== insertRows.length)
      throw new Error(`Post-write verification failed: expected ${insertRows.length}, got ${verify.rows[0]?.count}`);
    await db.query("commit");
    console.log(JSON.stringify({ appliedReferences: insertRows.length, listingCount: 34, referenceOnly: true,
      carsChanged: 0, calculationsChanged: 0, pricesChanged: 0, published: 0 }, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
