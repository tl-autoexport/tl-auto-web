import { Client } from "pg";
import { config } from "dotenv";
import { canonicalCandidates, canonicalInput } from "../src/server/power-resolution/canonical";
import { evidenceTier } from "../src/server/power-resolution/evidence-tiers";
import { hpFromKw } from "../src/server/power-resolution/publication-gate";
import { resolveApprovedPower, type ApprovedPowerCandidate } from "../src/server/power-resolution/resolver";

/**
 * Read-only impact report for cards that were already published by the legacy
 * publisher. It quantifies two known defects without changing anything:
 *   1. `power_hp` that disagrees with the approved reference for the same card;
 *   2. a drive axle that was replaced by the old 2WD fallback.
 *
 * No Encar requests, no database writes, public catalog untouched.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const bump = (map: Record<string, number>, key: string) => { map[key] = (map[key] ?? 0) + 1; };
const top = (map: Record<string, number>, limit = 10) =>
  Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, count]) => ({ key, count }));

type CarRow = {
  id: string; source_id: string; brand: string | null; model: string | null; year: number | null;
  engine_cc: number | null; fuel_type: string | null; drive_type: string | null; power_hp: number | null;
  power_source: string | null; power_confidence: string | null; registration_month: number | null;
  registration_date: string | null;
  vehicle_specs: Record<string, unknown> | null;
  staging_generation: string | null; staging_trim: string | null; staging_payload: Record<string, unknown> | null;
};

/** The legacy publisher never wrote registration_month, so derive it from the date. */
function monthFromDate(value: string | null): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  if (year < 1990 || year > new Date().getUTCFullYear() + 1) return null;
  return date.getUTCMonth() + 1;
}

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin read only");
    const readOnly = await db.query<{ ro: string }>("select current_setting('transaction_read_only') as ro");

    const refs = await db.query(`select spec.id spec_id,spec.version spec_version,spec.spec_key,spec.calculation_power_kw,spec.power_basis,spec.source_priority,
        evidence.id evidence_id,evidence.source_kind evidence_kind,evidence.source_uri,evidence.source_title,evidence.evidence_note,evidence.reliability,
        matcher.id match_id,matcher.priority match_priority,matcher.brand,matcher.model,matcher.generation,matcher.trim,matcher.badge_normalized,matcher.model_code,matcher.engine_code,matcher.fuel_type,matcher.drive_type,matcher.production_year_from,matcher.production_year_to,matcher.engine_cc_from,matcher.engine_cc_to
      from public.vehicle_power_specs spec
      join public.vehicle_power_evidence evidence on evidence.id=spec.evidence_id
      join public.vehicle_power_spec_matches matcher on matcher.spec_id=spec.id
      where spec.status='approved' and evidence.verification_status='approved'`);

    const cars = await db.query<CarRow>(`select c.id,c.source_id,c.brand,c.model,c.year,c.engine_cc,c.fuel_type,c.drive_type,c.power_hp,
        c.power_source,c.power_confidence,c.registration_month,c.registration_date,c.vehicle_specs,
        s.generation staging_generation,s.trim staging_trim,s.raw_payload staging_payload
      from public.cars c
      left join public.chestny_catalog_staging s on s.source_listing_id=c.source_id
      where c.primary_source='chestny_prigon' and c.is_available=true`);

    const snapshots = await db.query(`select (cs.inputs->>'month') as month, count(*)::int as count
      from public.calc_snapshots cs join public.cars c on c.id=cs.car_id
      where c.primary_source='chestny_prigon' and c.is_available=true
      group by 1 order by 2 desc`);

    const candidates: ApprovedPowerCandidate[] = canonicalCandidates(refs.rows.map((r) => ({
      specId: r.spec_id, specVersion: Number(r.spec_version), calculationPowerKw: Number(r.calculation_power_kw),
      powerBasis: r.power_basis as ApprovedPowerCandidate["powerBasis"], sourcePriority: Number(r.source_priority),
      evidenceId: r.evidence_id, evidenceKind: r.evidence_kind as ApprovedPowerCandidate["evidenceKind"],
      evidenceVerificationStatus: "approved",
      evidenceReliability: (r.reliability ?? "unreviewed") as ApprovedPowerCandidate["evidenceReliability"],
      match: { id: r.match_id, priority: Number(r.match_priority), brand: String(r.brand ?? ""), model: String(r.model ?? ""),
        generation: r.generation, trim: r.trim, badgeNormalized: r.badge_normalized, modelCode: r.model_code,
        engineCode: r.engine_code, fuelType: r.fuel_type, driveType: r.drive_type,
        productionYearFrom: r.production_year_from, productionYearTo: r.production_year_to,
        engineCcFrom: r.engine_cc_from, engineCcTo: r.engine_cc_to },
    })));
    const tierBySpecId = new Map<string, string>();
    for (const ref of refs.rows) {
      tierBySpecId.set(ref.spec_id, evidenceTier({ specKey: ref.spec_key, sourceKind: ref.evidence_kind,
        sourceTitle: ref.source_title, sourceUri: ref.source_uri, note: ref.evidence_note }));
    }

    const report = {
      scope: { source: "chestny_prigon", activeCars: cars.rowCount ?? 0 },
      readOnlyTransaction: readOnly.rows[0]?.ro === "on",
      encarRequests: 0, databaseWrites: 0, publicCatalogChanged: false,
      drive: {
        fallback2wd: 0, driveUnknown: 0, byBrand: {} as Record<string, number>, byModel: {} as Record<string, number>,
      },
      power: {
        resolved: 0, mismatched: 0, unresolved: 0, bySource: {} as Record<string, number>,
        byConfidence: {} as Record<string, number>, byBrand: {} as Record<string, number>,
        mismatchSamples: [] as Array<Record<string, unknown>>,
      },
      month: { snapshotInputs: snapshots.rows, fixedJuneSnapshots: 0, registrationMonthMissing: 0, juneButDifferentMonth: 0 },
    };

    for (const car of cars.rows) {
      const specs = (car.vehicle_specs ?? {}) as Record<string, unknown>;
      if (specs.drive_resolution === "best_fit_2wd") {
        report.drive.fallback2wd++;
        bump(report.drive.byBrand, String(car.brand ?? "unknown"));
        bump(report.drive.byModel, `${car.brand ?? "?"}/${car.model ?? "?"}`);
      }
      if (car.drive_type == null) report.drive.driveUnknown++;
      if (car.registration_month == null) report.month.registrationMonthMissing++;
      // Size of the set where the fixed June month is provably wrong: the
      // registration date resolves to a different month.
      const derivedMonth = monthFromDate(car.registration_date);
      if (derivedMonth != null && derivedMonth !== 6) report.month.juneButDifferentMonth++;

      bump(report.power.bySource, String(car.power_source ?? "unknown"));
      bump(report.power.byConfidence, String(car.power_confidence ?? "unknown"));

      const payload = (car.staging_payload ?? {}) as Record<string, unknown>;
      const enrichment = (payload.encar_enrichment ?? {}) as Record<string, unknown>;
      const detail = (enrichment.detail ?? {}) as Record<string, unknown>;
      const category = (detail.category ?? {}) as Record<string, unknown>;
      const grade = category.gradeEnglishName ?? category.gradeName ?? car.staging_trim;

      const input = canonicalInput({
        brand: car.brand, model: car.model, generation: car.staging_generation, trim: grade,
        fuelType: car.fuel_type, driveType: car.drive_type, year: car.year, engineCc: car.engine_cc,
      });
      const resolution = resolveApprovedPower(input, candidates);
      if (resolution.status !== "matched") { report.power.unresolved++; continue; }
      report.power.resolved++;

      const referenceHp = hpFromKw(Number(resolution.candidate.calculationPowerKw));
      if (car.power_hp != null && Math.abs(car.power_hp - referenceHp) > 1) {
        report.power.mismatched++;
        bump(report.power.byBrand, String(car.brand ?? "unknown"));
        if (report.power.mismatchSamples.length < 20) {
          report.power.mismatchSamples.push({
            sourceId: car.source_id, brand: car.brand, model: car.model, year: car.year, engineCc: car.engine_cc,
            trim: grade ?? null, storedHp: car.power_hp, referenceHp,
            specKey: refs.rows.find((r) => r.spec_id === resolution.candidate.specId)?.spec_key ?? null,
            tier: tierBySpecId.get(resolution.candidate.specId) ?? null,
          });
        }
      }
    }

    report.month.fixedJuneSnapshots = Number(snapshots.rows.find((row) => row.month === "6")?.count ?? 0);
    await db.query("rollback");
    console.log(JSON.stringify({
      ...report,
      drive: { ...report.drive, byBrand: top(report.drive.byBrand), byModel: top(report.drive.byModel) },
      power: { ...report.power, byBrand: top(report.power.byBrand) },
    }, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
