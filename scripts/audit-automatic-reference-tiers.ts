import { Client } from "pg";
import { config } from "dotenv";

/**
 * Read-only classification of `vehicle_power_automatic_reference`.
 *
 * These rows are the source of the preliminary `automatic` prices, so before any
 * of them is re-resolved the evidence behind each row has to be known. The table
 * carries its own provenance in `source`, `status` and `note`, and this audit
 * reads it instead of assuming:
 *
 *   T1  an official manufacturer document with a locatable reference;
 *   T2  official manufacturer communication, or an accepted aggregator (Drom);
 *   T3  self-described verified data without a source reference — needs T1/T2
 *       corroboration before it may drive a final value;
 *   T4  preliminary by its own declaration: displacement fallbacks, model-level
 *       maps and anything whose note states it is not a confirmed specification.
 *
 * It also reports how many rows are corroborated by an already approved
 * specification, and how many published cards rest on each source, because that
 * is what decides the order of the re-resolution.
 *
 * No writes, no Encar requests.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type Row = {
  id: string;
  brand: string | null;
  model: string | null;
  fuel_type: string | null;
  engine_cc: number | null;
  drive_type: string | null;
  badge: string | null;
  year_from: number | null;
  year_to: number | null;
  power_hp: number | null;
  source: string | null;
  status: string | null;
  note: string | null;
  corroborated: boolean;
};

const TIER_ORDER = ["T1", "T2", "T3", "T4"] as const;
type Tier = (typeof TIER_ORDER)[number];

/** Official manufacturer sources we have already accepted elsewhere. */
const OFFICIAL_DOMAINS = [
  "hyundai.com", "kia.com", "genesis.com", "kg-mobility.com",
  "renault.co.kr", "renaultkoream.com", "chevrolet.co.kr",
  "bmw.com", "bmw.co.kr", "mercedes-benz.com", "mercedes-benz.co.kr",
  "audi.com", "audi.co.kr", "volkswagen.com", "volkswagen.co.kr",
  "landrover.com", "landrover.co.kr", "jaguar.com", "jaguar.co.kr",
  "mini.com",
];
/** Aggregators the project owner accepted as a source of truth. */
const ACCEPTED_AGGREGATORS = ["drom.ru"];

const MODEL_LEVEL_MAPS = new Set(["tma_power_map_model", "verified_power_map_model"]);
const DISPLACEMENT_FALLBACKS = new Set(["engine_fallback"]);

function classify(row: Row): { tier: Tier; reason: string } {
  const note = row.note ?? "";
  const urlText = note.match(/https?:\/\/[^\s)]+/)?.[0] ?? null;
  let host: string | null = null;
  try {
    host = urlText ? new URL(urlText).hostname.toLowerCase() : null;
  } catch {
    // An unparsable URL remains unrecognised evidence below.
  }
  const lowerNote = note.toLowerCase();

  // The row says of itself that it is not a confirmed specification.
  if (/не является подтверждённой спецификацией|предварительное автоматическое/i.test(note)) {
    if (DISPLACEMENT_FALLBACKS.has(String(row.source))) return { tier: "T4", reason: "displacement_fallback" };
    if (MODEL_LEVEL_MAPS.has(String(row.source))) return { tier: "T4", reason: "model_level_map" };
    return { tier: "T4", reason: "declared_preliminary_in_note" };
  }
  if (DISPLACEMENT_FALLBACKS.has(String(row.source))) return { tier: "T4", reason: "power_derived_from_displacement" };
  if (MODEL_LEVEL_MAPS.has(String(row.source))) return { tier: "T4", reason: "model_level_map_is_not_a_configuration" };

  if (host) {
    if (ACCEPTED_AGGREGATORS.some((domain) => host === domain || host.endsWith(`.${domain}`))) return { tier: "T2", reason: `accepted_aggregator_url:${urlText}` };
    if (OFFICIAL_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) return { tier: "T1", reason: `official_document_url:${urlText}` };
    return { tier: "T3", reason: `unrecognised_source_url:${urlText}` };
  }
  if (/official\s+(renault|kia|hyundai|genesis|kgm|kg\s?mobility|chevrolet)/i.test(lowerNote)) {
    return { tier: "T2", reason: "official_document_without_url" };
  }
  if (String(row.status) === "confirmed") return { tier: "T3", reason: "marked_confirmed_without_source_url" };
  return { tier: "T3", reason: "no_source_reference" };
}

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin read only");
    const { rows } = await db.query<Row>(`
      select a.id, a.brand, a.model, a.fuel_type, a.engine_cc, a.drive_type, a.badge,
             a.year_from, a.year_to, a.power_hp, a.source, a.status, a.note,
             exists (
               select 1 from public.vehicle_power_specs s
               join public.vehicle_power_evidence e on e.id = s.evidence_id
               join public.vehicle_power_spec_matches m on m.spec_id = s.id
               where s.status = 'approved' and e.verification_status = 'approved'
                 and e.evidence_tier in ('T1', 'T2')
                 and lower(coalesce(m.brand,'')) = lower(coalesce(a.brand,''))
                 and lower(coalesce(m.model,'')) = lower(coalesce(a.model,''))
                 and (m.fuel_type is null or a.fuel_type is null or lower(m.fuel_type) = lower(a.fuel_type))
                 and (m.engine_cc_from is null or a.engine_cc is null or a.engine_cc >= m.engine_cc_from)
                 and (m.engine_cc_to is null or a.engine_cc is null or a.engine_cc <= m.engine_cc_to)
                 and (m.production_year_from is null or a.year_from is null or a.year_from >= m.production_year_from)
                 and (m.production_year_to is null or a.year_to is null or a.year_to <= m.production_year_to)
             ) as corroborated
      from public.vehicle_power_automatic_reference a`);

    const byTier: Record<string, number> = {};
    const byTierCorroborated: Record<string, number> = {};
    const bySource: Record<string, { rows: number; tier: Tier; corroborated: number; withUrl: number }> = {};
    const samples: Array<Record<string, unknown>> = [];

    for (const row of rows) {
      const { tier, reason } = classify(row);
      byTier[tier] = (byTier[tier] ?? 0) + 1;
      if (row.corroborated) byTierCorroborated[tier] = (byTierCorroborated[tier] ?? 0) + 1;
      const source = String(row.source ?? "<null>");
      const entry = bySource[source] ?? { rows: 0, tier, corroborated: 0, withUrl: 0 };
      entry.rows++;
      if (row.corroborated) entry.corroborated++;
      if (/https?:\/\//.test(row.note ?? "")) entry.withUrl++;
      bySource[source] = entry;
      if (samples.length < 12 && tier !== "T4") {
        samples.push({ brand: row.brand, model: row.model, engineCc: row.engine_cc, year: [row.year_from, row.year_to],
          powerHp: row.power_hp, source: row.source, status: row.status, tier, reason, corroborated: row.corroborated });
      }
    }

    // Published impact: how many live cards rest on each source.
    const publishedImpact = await db.query<{ source: string | null; cars: number; powerConfidence: string }>(`
      select a.source, count(distinct c.id)::int as cars, c.power_confidence
      from public.cars c
      join public.vehicle_power_automatic_reference a
        on lower(coalesce(a.brand,'')) = lower(coalesce(c.brand,''))
       and lower(coalesce(a.model,'')) = lower(coalesce(c.model,''))
       and (a.engine_cc is null or c.engine_cc is null or a.engine_cc = c.engine_cc)
       and (a.year_from is null or c.year is null or c.year >= a.year_from)
       and (a.year_to is null or c.year is null or c.year <= a.year_to)
       and a.power_hp = c.power_hp
      where c.is_available and c.power_confidence in ('automatic', 'approximate')
      group by 1, 3 order by 2 desc limit 20`);

    await db.query("rollback");
    console.log(JSON.stringify({
      readOnly: true,
      encarRequests: 0,
      databaseWrites: 0,
      rowsTotal: rows.length,
      byTier,
      byTierCorroboratedByApprovedSpec: byTierCorroborated,
      bySource,
      publishedImpactBySource: publishedImpact.rows,
      samples: samples,
      verdict:
        "Only rows with a locatable source reference may drive a final value. Everything whose own note declares it preliminary stays preliminary, and rows without a source reference need T1/T2 corroboration before re-resolution.",
    }, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
