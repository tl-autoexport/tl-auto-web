/**
 * Read-only review of the displacement-derived automatic references.
 *
 * The daily recalculation would adopt `engine_fallback` values, which are derived from
 * engine displacement only: 37 rows share one blanket 150 hp answer across different
 * models and would replace a stored power with a wrong one.
 *
 * This produces the review list the retirement decision needs, and nothing else:
 *   * every affected reference row (key, model, fuel, cc, drive, badge, hp);
 *   * the cards that would take that value, with their stored power next to it;
 *   * a per-reference verdict hint based on independent approved power for the same
 *     model, because 150 hp is legitimate for some cars and wrong for others.
 *
 * No writes to any database.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type RecalcRow = {
  sourceId: string; car: string; changePct: number; powerChanged: boolean; powerSource: string;
  selectedPower?: { storedCalculationKw?: number | null; resolvedKw?: number | null; referenceKey?: string | null };
};

async function main() {
  const recalcPath = process.env.RECALC_PLAN_PATH ?? "/tmp/recalc-dry.json";
  const text = readFileSync(recalcPath, "utf8");
  const start = text.indexOf("{");
  const parsed = JSON.parse(text.slice(start)) as { rows?: RecalcRow[] };
  const rows = parsed.rows ?? [];
  const changed = rows.filter((row) => row.powerChanged && String(row.powerSource).startsWith("automatic-reference"));

  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const refs = (await db.query(`
      select id, configuration_key, brand, model, fuel_type, engine_cc, drive_type, badge,
             power_hp::float8 as power_hp, source, status
      from public.vehicle_power_automatic_reference
      where source = 'engine_fallback' and status <> 'retired'
        and round(power_kw::numeric, 4) = round(110.3249::numeric, 4)
      order by brand, model`)).rows;

    // Independent approved power for the same model, used only as a plausibility hint.
    const approved = (await db.query(`
      select lower(m.brand) as brand, lower(m.model) as model, round(avg(sp.calculation_power_kw)::numeric, 1) as avg_kw,
             count(*)::int as specs
      from public.vehicle_power_spec_matches m
      join public.vehicle_power_specs sp on sp.id = m.spec_id
      join public.vehicle_power_evidence e on e.id = sp.evidence_id
      where sp.status = 'approved' and e.verification_status = 'approved' and e.evidence_tier in ('T1','T2')
      group by 1,2`)).rows;
    const approvedByModel = new Map(approved.map((row) => [`${row.brand}|${row.model}`, row]));

    const affectedCards = changed.map((row) => ({
      sourceId: row.sourceId, car: row.car, referenceKey: row.selectedPower?.referenceKey ?? null,
      storedKw: row.selectedPower?.storedCalculationKw ?? null, resolvedKw: row.selectedPower?.resolvedKw ?? null,
      changePct: Number(row.changePct.toFixed(2)),
    }));
    // The recalculation appends a `|year=...` suffix to the key, so match on the prefix.
    const keyOf = (value: string | null | undefined) => String(value ?? "").split("|year=")[0];

    const review = refs.map((ref) => {
      const key = String(ref.configuration_key);
      const cards = affectedCards.filter((card) => keyOf(card.referenceKey) === key);
      const approvedRow = approvedByModel.get(`${String(ref.brand).toLowerCase()}|${String(ref.model).toLowerCase()}`);
      const refKw = Number(ref.power_hp) / 1.35962;
      const approvedKw = approvedRow ? Number(approvedRow.avg_kw) : null;
      const plausible = approvedKw != null ? Math.abs(approvedKw - refKw) <= 12 : null;
      return {
        configurationKey: key, model: `${ref.brand} ${ref.model}`.trim(), fuel: ref.fuel_type,
        engineCc: ref.engine_cc, drive: ref.drive_type, badge: ref.badge, powerHp: Number(ref.power_hp),
        source: ref.source, cardsAffected: cards.length,
        cardsStoredKw: [...new Set(cards.map((card) => card.storedKw))],
        approvedKwForModel: approvedKw, referencePlausibleForModel: plausible,
        verdictHint: plausible === true ? "reference may be right; review the card instead of retiring" : plausible === false ? "reference conflicts with approved power for this model; retire" : "no approved power to compare; needs manual review",
      };
    });

    const artifact = { readOnly: true, generatedAt: new Date().toISOString(), recalcPlan: recalcPath, referencesReviewed: review.length, affectedCards: affectedCards.length, review, affectedCardsDetail: affectedCards };
    mkdirSync("data/power", { recursive: true });
    writeFileSync("data/power/engine-fallback-review.json", JSON.stringify(artifact, null, 2));

    const byVerdict: Record<string, number> = {};
    for (const item of review) byVerdict[item.verdictHint] = (byVerdict[item.verdictHint] ?? 0) + 1;
    console.log(JSON.stringify({
      referencesReviewed: review.length,
      affectedCards: affectedCards.length,
      byVerdict,
      sample: review.slice(0, 8).map((item) => ({ model: item.model, hp: item.powerHp, approvedKw: item.approvedKwForModel, storedKw: item.cardsStoredKw, cards: item.cardsAffected, verdict: item.verdictHint })),
      artifact: "data/power/engine-fallback-review.json",
    }, null, 2));
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
