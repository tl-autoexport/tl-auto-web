import { Client } from "pg";
import { config } from "dotenv";
import { normalizeBrand, normalizeDrive, normalizeFuel, normalizeModel } from "../src/server/normalization/vehicles";
import { resolveApprovedPower, type ApprovedPowerCandidate } from "../src/server/power-resolution/resolver";

config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
const runId = process.env.ENCAR_SUCCESS_RUN_ID ?? "98b17628-1dab-460d-972b-f7f092fbcc42";

const modelAliases: Record<string, string> = {
  avante: "Elantra",
  canival: "Carnival",
  "1-series": "1 Series",
  "2-series": "2 Series",
};
const canonicalModel = (value: unknown) => {
  const normalized = normalizeModel(value);
  return modelAliases[String(normalized ?? "").trim().toLowerCase()] ?? normalized;
};

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const [rows, refs] = await Promise.all([
      db.query(`select s.source_listing_id,s.manufacturer,s.model,s.generation,s.trim,s.model_year,s.engine_cc,s.fuel_type,s.drive_type
        from public.chestny_catalog_staging s join public.catalog_enrichment_queue q
          on q.source_listing_id=s.source_listing_id and q.run_id=$1 where q.status='succeeded'`, [runId]),
      db.query(`select spec.id spec_id,spec.version spec_version,spec.calculation_power_kw,spec.power_basis,spec.source_priority,
        evidence.id evidence_id,evidence.source_kind evidence_kind,evidence.verification_status evidence_verification_status,evidence.reliability evidence_reliability,
        matcher.id match_id,matcher.priority match_priority,matcher.brand,matcher.model,matcher.generation,matcher.trim,matcher.badge_normalized,
        matcher.model_code,matcher.engine_code,matcher.fuel_type,matcher.drive_type,matcher.production_year_from,matcher.production_year_to,matcher.engine_cc_from,matcher.engine_cc_to
        from public.vehicle_power_specs spec join public.vehicle_power_evidence evidence on evidence.id=spec.evidence_id
        join public.vehicle_power_spec_matches matcher on matcher.spec_id=spec.id
        where spec.status='approved' and evidence.verification_status='approved'`),
    ]);
    const candidates: ApprovedPowerCandidate[] = refs.rows.map((r) => ({
      specId: r.spec_id, specVersion: r.spec_version, calculationPowerKw: Number(r.calculation_power_kw), powerBasis: r.power_basis,
      sourcePriority: r.source_priority, evidenceId: r.evidence_id, evidenceKind: r.evidence_kind,
      evidenceVerificationStatus: r.evidence_verification_status, evidenceReliability: r.evidence_reliability,
      match: { id: r.match_id, priority: r.match_priority, brand: r.brand, model: r.model, generation: r.generation, trim: r.trim,
        badgeNormalized: r.badge_normalized, modelCode: r.model_code, engineCode: r.engine_code, fuelType: r.fuel_type, driveType: r.drive_type,
        productionYearFrom: r.production_year_from, productionYearTo: r.production_year_to, engineCcFrom: r.engine_cc_from, engineCcTo: r.engine_cc_to },
    }));
    const report = { runId, total: rows.rowCount, matched: 0, official: 0, high: 0, reviewRequired: 0, cardsByPowerBand: { upTo160: 0, over160: 0 }, sampleReview: [] as unknown[] };
    for (const row of rows.rows) {
      // Generation and trim are decisive for variants which share an engine
      // displacement (for example X1 xDrive20i vs X1 M35i).  Passing them
      // prevents a broad rule from being used where the source stores a
      // more precise configuration.
      const result = resolveApprovedPower({ brand: normalizeBrand(row.manufacturer), model: canonicalModel(row.model),
        generation: row.generation, trim: row.trim, badge: row.trim, year: row.model_year,
        engineCc: row.engine_cc, fuelType: normalizeFuel(row.fuel_type), driveType: normalizeDrive(row.drive_type) }, candidates);
      if (result.status !== "matched") {
        report.reviewRequired++;
        if (report.sampleReview.length < 20) report.sampleReview.push({ id: row.source_listing_id, brand: row.manufacturer, model: row.model, year: row.model_year, engineCc: row.engine_cc, fuel: row.fuel_type, drive: row.drive_type, reason: result.reason });
        continue;
      }
      report.matched++;
      const confidence = result.confidence as keyof Pick<typeof report, "official" | "high" | "reviewRequired">;
      report[confidence]++;
      const hp = result.candidate.calculationPowerKw * 1.359621617;
      report.cardsByPowerBand[hp <= 160 ? "upTo160" : "over160"]++;
    }
    console.log(JSON.stringify({ ...report, encarRequests: 0, databaseWrites: 0 }, null, 2));
  } finally { await db.end(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
