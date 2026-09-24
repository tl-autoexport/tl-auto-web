/**
 * Attach AI-sourced power to the AI evidence journal.
 *
 * A card whose price came from `ai_web_fallback` must be able to show where that
 * number came from, and the journal is the only place that can carry it. The
 * project rule is that approval is required for a *final* value, not for a
 * preliminary one, so this script links unapproved rows and never sets
 * `approved_at`.
 *
 * Two kinds of attachment exist, and they are labelled differently on purpose:
 *   * a journal row already documents the configuration -> link it;
 *   * no journal row exists (the AI wave that produced this value did not write
 *     one) -> insert a row reconstructed from the stored reference, with
 *     `provider = 'reference_row_backfill'` and an empty `raw_response`, so nobody
 *     can mistake it for a captured provider answer.
 *
 * Read-only by default; the write requires AI_EVIDENCE_LINK_WRITE=true.
 */
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
const write = process.env.AI_EVIDENCE_LINK_WRITE === "true";

type CarRow = {
  id: string; source_id: string; brand: string | null; model: string | null; year: number | null;
  engine_cc: number | null; fuel_type: string | null; drive_type: string | null;
  power_hp: number | null; power_kw: number | null;
};
type JournalRow = {
  id: string; brand: string; model: string; fuel_type: string | null; engine_cc: number | null;
  drive_type: string | null; year_from: number | null; year_to: number | null; power_hp: number | null;
  status: string; provider: string;
};
type ReferenceRow = {
  id: string; configuration_key: string; brand: string | null; model: string | null; fuel_type: string | null;
  engine_cc: number | null; drive_type: string | null; badge: string | null; badge_detail: string | null;
  year_from: number | null; year_to: number | null; power_hp: number | null; power_kw: number | null;
  note: string | null;
};

const norm = (value: string | null | undefined) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const hostOf = (note: string | null) => note?.match(/https?:\/\/([^/\s]+)/)?.[1] ?? null;
const urlOf = (note: string | null) => note?.match(/https?:\/\/\S+/)?.[0] ?? null;

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  let committed = false;
  try {
    const cars = (await db.query<CarRow>(`
      select id, source_id, brand, model, year, engine_cc, fuel_type, drive_type,
             power_hp::float8 as power_hp, calculation_power_kw::float8 as power_kw
      from public.cars
      where is_available = true and power_finality = 'provisional'
        and power_resolution_source = 'ai_web_fallback'
      order by brand, model, source_id`)).rows;
    const journal = (await db.query<JournalRow>(`
      select id, brand, model, fuel_type, engine_cc, drive_type, year_from, year_to,
             power_hp::float8 as power_hp, status, provider
      from public.vehicle_power_ai_evidence`)).rows;
    const references = (await db.query<ReferenceRow>(`
      select id, configuration_key, brand, model, fuel_type, engine_cc, drive_type, badge, badge_detail,
             year_from, year_to, power_hp::float8 as power_hp, power_kw::float8 as power_kw, note
      from public.vehicle_power_automatic_reference where source = 'ai_web_fallback'`)).rows;

    const existingLink = new Map<string, string>();
    const plannedInsert: Array<{ car: CarRow; reference: ReferenceRow; sourceName: string | null; sourceUrl: string | null; key: string }> = [];
    const unmatched: CarRow[] = [];

    for (const car of cars) {
      const candidate = journal.find((row) =>
        norm(row.brand) === norm(car.brand) && norm(row.model) === norm(car.model)
        && (row.fuel_type == null || car.fuel_type == null || norm(row.fuel_type) === norm(car.fuel_type))
        && (row.engine_cc == null || car.engine_cc == null || row.engine_cc === car.engine_cc)
        && (row.drive_type == null || car.drive_type == null || norm(row.drive_type) === norm(car.drive_type))
        && (car.year == null || (row.year_from == null && row.year_to == null) || (car.year >= (row.year_from ?? 0) && car.year <= (row.year_to ?? 9999))));
      if (candidate) { existingLink.set(car.id, candidate.id); continue; }
      const reference = references.find((row) =>
        norm(row.brand) === norm(car.brand) && norm(row.model) === norm(car.model)
        && (row.fuel_type == null || car.fuel_type == null || norm(row.fuel_type) === norm(car.fuel_type))
        && (row.engine_cc == null || car.engine_cc == null || row.engine_cc === car.engine_cc));
      if (!reference) { unmatched.push(car); continue; }
      const key = [norm(car.brand), norm(car.model), reference.badge_detail ?? reference.badge ?? "?",
        car.year ?? reference.year_from ?? "?", car.engine_cc ?? "?", norm(car.fuel_type),
        norm(car.drive_type), "ai_provider=reference_backfill"].join("|");
      plannedInsert.push({ car, reference, sourceName: hostOf(reference.note), sourceUrl: urlOf(reference.note), key });
    }

    const summary = {
      write,
      provisionalAiCards: cars.length,
      alreadyDocumentedLinkable: existingLink.size,
      needsReconstructedJournalRow: plannedInsert.length,
      noReferenceToReconstructFrom: unmatched.length,
      policy: "An AI-backed value stays provisional; the journal records its provenance and no row is approved here.",
      reconstructedSample: plannedInsert.slice(0, 10).map(({ car, reference, sourceName, sourceUrl }) => ({
        sourceId: car.source_id, car: `${car.brand ?? ""} ${car.model ?? ""}`.trim(), year: car.year,
        powerHp: car.power_hp, provider: "reference_backfill", sourceName, sourceUrl,
        referenceKey: reference.configuration_key, status: "reconstructed",
      })),
      unmatchedSample: unmatched.slice(0, 10).map((car) => ({
        sourceId: car.source_id, car: `${car.brand ?? ""} ${car.model ?? ""}`.trim(), year: car.year, engineCc: car.engine_cc,
      })),
    };

    if (!write || (!existingLink.size && !plannedInsert.length)) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    await db.query("begin");
    const insertedByKey = new Map<string, string>();
    for (const item of plannedInsert) {
      const existing = insertedByKey.get(item.key)
        ?? (await db.query<{ id: string }>(`select id from public.vehicle_power_ai_evidence where configuration_key = $1`, [item.key])).rows[0]?.id;
      let evidenceId = existing ?? null;
      if (!evidenceId) {
        const inserted = await db.query<{ id: string }>(`
          insert into public.vehicle_power_ai_evidence
            (configuration_key, brand, model, fuel_type, engine_cc, drive_type, badge, badge_detail,
             year_from, year_to, power_hp, power_kw, status, confidence, provider, source_name, source_url,
             raw_response, updated_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'reconstructed','approximate','reference_row_backfill',$13,$14,'{}'::jsonb,now())
          on conflict (configuration_key) do update set updated_at = now()
          returning id`,
          [item.key, item.car.brand, item.car.model, item.car.fuel_type, item.car.engine_cc, item.car.drive_type,
            item.reference.badge, item.reference.badge_detail, item.car.year ?? item.reference.year_from,
            item.car.year ?? item.reference.year_to, item.car.power_hp, item.car.power_kw, item.sourceName, item.sourceUrl]);
        evidenceId = inserted.rows[0].id;
      }
      insertedByKey.set(item.key, evidenceId);
      await db.query(`update public.cars set power_ai_evidence_id = $2 where id = $1`, [item.car.id, evidenceId]);
    }
    for (const [carId, evidenceId] of existingLink) {
      await db.query(`update public.cars set power_ai_evidence_id = $2 where id = $1`, [carId, evidenceId]);
    }
    await db.query("commit");
    committed = true;
    console.log(JSON.stringify({ ...summary, linkedFromJournal: existingLink.size, linkedFromReconstructed: plannedInsert.length }, null, 2));
  } catch (error) {
    if (!committed) await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
