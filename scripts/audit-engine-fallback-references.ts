/**
 * Read-only review of the automatic power references and the remaining discrepancies.
 *
 * Two questions, one artifact:
 *   1. which references carry the blanket displacement-derived answer, and exactly which
 *      cards each one would have driven (a correct reference -> card linkage this time,
 *      matching on the key with the recalculation's `|year=` suffix handled);
 *   2. how the still-diverging cards group by model and configuration, in both directions,
 *      so they can be classified instead of mass-edited.
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

const keyOf = (value: string | null | undefined) => String(value ?? "").split("|year=")[0];

async function main() {
  const recalcPath = process.env.RECALC_PLAN_PATH ?? "/tmp/recalc-dry.json";
  const text = readFileSync(recalcPath, "utf8");
  const rows = (JSON.parse(text.slice(text.indexOf("{"))) as { rows?: RecalcRow[] }).rows ?? [];

  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    // 1. Reference rows that share one blanket answer across unrelated models.
    const blanket = (await db.query(`
      select id, configuration_key, brand, model, fuel_type, engine_cc, drive_type, badge,
             power_hp::float8 as power_hp, source, status
      from public.vehicle_power_automatic_reference
      where round(power_kw::numeric, 4) = round(110.3249::numeric, 4)
      order by status, source, brand, model`)).rows;

    // Every recalculation row that used an automatic reference, regardless of the switch.
    const referenced = rows.filter((row) => String(row.powerSource) === "automatic_reference");
    const cardsByKey = new Map<string, RecalcRow[]>();
    for (const row of referenced) {
      const key = keyOf(row.selectedPower?.referenceKey);
      cardsByKey.set(key, [...(cardsByKey.get(key) ?? []), row]);
    }

    const approved = (await db.query(`
      select lower(m.brand) as brand, lower(m.model) as model, round(avg(sp.calculation_power_kw)::numeric, 1) as avg_kw
      from public.vehicle_power_spec_matches m
      join public.vehicle_power_specs sp on sp.id = m.spec_id
      join public.vehicle_power_evidence e on e.id = sp.evidence_id
      where sp.status = 'approved' and e.verification_status = 'approved' and e.evidence_tier in ('T1','T2')
      group by 1,2`)).rows;
    const approvedByModel = new Map(approved.map((row) => [`${row.brand}|${row.model}`, Number(row.avg_kw)]));

    const blanketReview = blanket.map((ref) => {
      const key = String(ref.configuration_key);
      const cards = cardsByKey.get(key) ?? [];
      const refKw = Number(ref.power_hp) / 1.3596216173;
      const approvedKw = approvedByModel.get(`${String(ref.brand).toLowerCase()}|${String(ref.model).toLowerCase()}`) ?? null;
      const conflicts = approvedKw != null ? Math.abs(approvedKw - refKw) > 12 : null;
      return {
        configurationKey: key, model: `${ref.brand} ${ref.model}`.trim(), fuel: ref.fuel_type,
        engineCc: ref.engine_cc, drive: ref.drive_type, badge: ref.badge, referenceHp: Number(ref.power_hp),
        source: ref.source, status: ref.status, cardsDriven: cards.length,
        storedKw: [...new Set(cards.map((card) => card.selectedPower?.storedCalculationKw ?? null))].filter((value) => value != null),
        resolvedKw: [...new Set(cards.map((card) => card.selectedPower?.resolvedKw ?? null))].filter((value) => value != null),
        approvedKwForModel: approvedKw,
        verdict: conflicts === true ? "reference conflicts with approved power for this model"
          : conflicts === false ? "reference is close to approved power; review the card instead"
          : "no approved power to compare; manual review",
      };
    });

    // 2. Remaining divergence, grouped by model and configuration, with direction.
    const diverging = rows.filter((row) => row.powerChanged);
    const groups = new Map<string, { model: string; referenceKey: string; cards: number; up: number; down: number; minPct: number; maxPct: number }>();
    for (const row of diverging) {
      const key = String(row.selectedPower?.referenceKey ?? "<none>");
      const stored = Number(row.selectedPower?.storedCalculationKw ?? 0);
      const resolved = Number(row.selectedPower?.resolvedKw ?? 0);
      const entry = groups.get(key) ?? { model: row.car, referenceKey: key, cards: 0, up: 0, down: 0, minPct: 999, maxPct: -999 };
      entry.cards++;
      if (resolved > stored) entry.up++; else entry.down++;
      entry.minPct = Math.min(entry.minPct, Number(row.changePct));
      entry.maxPct = Math.max(entry.maxPct, Number(row.changePct));
      groups.set(key, entry);
    }
    const remaining = [...groups.values()].sort((a, b) => b.cards - a.cards);

    const artifact = {
      readOnly: true, generatedAt: new Date().toISOString(), recalcPlan: recalcPath,
      blankekRows: blanketReview.length,
      blanketReview,
      divergentCards: diverging.length,
      divergentGroups: remaining,
    };
    const outPath = process.env.REVIEW_OUT_PATH ?? "data/power/reference-review.json";
    mkdirSync("data/power", { recursive: true });
    writeFileSync(outPath, JSON.stringify(artifact, null, 2));

    const byVerdict: Record<string, number> = {};
    for (const item of blanketReview) byVerdict[item.verdict] = (byVerdict[item.verdict] ?? 0) + 1;
    const inactive = blanketReview.filter((item) => item.status === "retired");
    const active = blanketReview.filter((item) => item.status !== "retired");
    console.log(JSON.stringify({
      blanketReferences: { total: blanketReview.length, retired: inactive.length, stillActive: active.length },
      retiredWithCardsDriven: inactive.filter((item) => item.cardsDriven > 0).map((item) => ({ key: item.configurationKey, cards: item.cardsDriven, model: item.model })),
      activeReferencesNeedingReview: active.map((item) => ({ key: item.configurationKey, model: item.model, source: item.source, cards: item.cardsDriven, verdict: item.verdict })),
      byVerdict,
      divergent: { cards: diverging.length, groups: remaining.length, top: remaining.slice(0, 6) },
      artifact: outPath,
    }, null, 2).slice(0, 4200));
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
