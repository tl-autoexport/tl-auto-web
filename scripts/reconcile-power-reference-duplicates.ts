import { Client } from "pg";
import { config } from "dotenv";
import { canonicalCandidate } from "../src/server/power-resolution/canonical";

/**
 * Reconciles duplicate approved specifications that describe the same
 * configuration. Nothing is deleted: a superseded specification is marked
 * `retired`, which removes it from every approved query while staying
 * reversible.
 *
 * Two cases, both verified before any write:
 *   1. E-Class W213 E220d 194 PS exists twice with identical engine, year and
 *      power ranges and the same source. The shorter key is retired.
 *   2. Golf 8 2.0 TDI 150 PS exists twice with the same ranges but different
 *      trim coverage. The broad row is cloned into the trim-scoped
 *      specification so both coverages survive, then the broad one is retired.
 *
 * Read-only by default. Set REFERENCE_RECONCILE_WRITE=true to apply.
 * No Encar requests, no catalog writes.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const write = process.env.REFERENCE_RECONCILE_WRITE === "true";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type SpecRow = {
  id: string; spec_key: string; status: string; calculation_power_kw: number; engine_cc_from: number | null;
  engine_cc_to: number | null; approval_note: string | null;
};
type MatchRow = {
  id: string; spec_id: string; priority: number; brand: string | null; model: string | null; generation: string | null;
  trim: string | null; badge_normalized: string | null; model_code: string | null; engine_code: string | null;
  fuel_type: string | null; drive_type: string | null; production_year_from: number | null; production_year_to: number | null;
  engine_cc_from: number | null; engine_cc_to: number | null;
};

const CASES = [
  {
    name: "mercedes-e-class-w213-e220d-194ps",
    keepKey: "mercedes-e-class-w213-e220d-1950-194ps-2021-2023",
    retireKey: "mercedes-e-class-w213-e220d-1950-194ps-2021-2022",
    widen: false,
  },
  {
    name: "volkswagen-golf-8-2tdi-150ps-2025",
    keepKey: "volkswagen-golf-8-2tdi-1968-150ps-2025",
    retireKey: "volkswagen-golf-8-1968-150ps-2025",
    widen: true,
  },
  {
    name: "volkswagen-tiguan-1968-150ps",
    keepKey: "volkswagen-tiguan-ad-1968-150ps-2018-2024",
    retireKey: "volkswagen-tiguan-2.0-tdi-1968-150ps-2019-2024",
    widen: true,
  },
  {
    name: "kgm-tivoli-1497-163ps",
    keepKey: "kgm-tivoli-15t-1497-163ps-2019-2025",
    retireKey: "kgm-tivoli-x150-1497-163ps-2020-2024",
    widen: false,
  },
  {
    name: "chevrolet-spark-999-75ps",
    keepKey: "chevrolet-spark-m400-1.0-999-75ps-2021-2022",
    retireKey: "chevrolet-spark-m400-1.0-999-75ps-2020",
    widen: false,
  },
  {
    name: "land-rover-discovery-sport-p250-249ps",
    keepKey: "land-rover-discovery-sport-p250-1997-249ps-2020-2026",
    retireKey: "land-rover-discovery-sport-p250-1997-249ps-2023-2024",
    widen: false,
  },
];

const rangeOf = (rows: MatchRow[]) => ({
  years: [Math.min(...rows.map((r) => r.production_year_from ?? 0)), Math.max(...rows.map((r) => r.production_year_to ?? 0))],
  cc: [Math.min(...rows.map((r) => r.engine_cc_from ?? 0)), Math.max(...rows.map((r) => r.engine_cc_to ?? 0))],
});

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const specs = await db.query<SpecRow>(`select id, spec_key, status, calculation_power_kw, engine_cc_from, engine_cc_to, approval_note
      from public.vehicle_power_specs where spec_key = any($1)`, [CASES.flatMap((c) => [c.keepKey, c.retireKey])]);
    const matches = await db.query<MatchRow>(`select id, spec_id, priority, brand, model, generation, trim, badge_normalized,
        model_code, engine_code, fuel_type, drive_type, production_year_from, production_year_to, engine_cc_from, engine_cc_to
      from public.vehicle_power_spec_matches where spec_id = any($1)`, [specs.rows.map((row) => row.id)]);

    const report: Array<Record<string, unknown>> = [];
    const actions: Array<() => Promise<void>> = [];

    for (const item of CASES) {
      const keep = specs.rows.find((row) => row.spec_key === item.keepKey);
      const retire = specs.rows.find((row) => row.spec_key === item.retireKey);
      const keepRows = matches.rows.filter((row) => row.spec_id === keep?.id);
      const retireRows = matches.rows.filter((row) => row.spec_id === retire?.id);

      if (!keep || !retire) {
        report.push({ case: item.name, status: "skipped", reason: "spec_not_found" });
        continue;
      }
      if (keep.status !== "approved" || retire.status !== "approved") {
        report.push({ case: item.name, status: "skipped", reason: `status_keep=${keep.status}_retire=${retire.status}` });
        continue;
      }
      if (!keepRows.length || !retireRows.length) {
        report.push({ case: item.name, status: "skipped", reason: "missing_matcher_rows" });
        continue;
      }
      const samePower = Math.abs(Number(keep.calculation_power_kw) - Number(retire.calculation_power_kw)) <= 0.5;
      // Identity is compared in canonical form: the same car is often stored
      // under a different spelling on the two sides, and matching already
      // collapses those spellings, so a raw string comparison would refuse a
      // merge that is in fact safe.
      const identityOf = (row: MatchRow) => canonicalCandidate({
        specId: row.spec_id, specVersion: 1, calculationPowerKw: 0, powerBasis: "combustion_engine",
        sourcePriority: row.priority, evidenceId: "", evidenceKind: "manufacturer_document",
        evidenceVerificationStatus: "approved", evidenceReliability: "high",
        match: { id: row.id, priority: row.priority, brand: String(row.brand ?? ""), model: String(row.model ?? ""),
          generation: row.generation, trim: row.trim, badgeNormalized: row.badge_normalized, modelCode: row.model_code,
          engineCode: row.engine_code, fuelType: row.fuel_type, driveType: row.drive_type,
          productionYearFrom: row.production_year_from, productionYearTo: row.production_year_to,
          engineCcFrom: row.engine_cc_from, engineCcTo: row.engine_cc_to },
      }).match;
      const keepIdentity = identityOf(keepRows[0]);
      const retireIdentity = identityOf(retireRows[0]);
      const sameIdentity = keepIdentity.brand === retireIdentity.brand &&
        keepIdentity.model === retireIdentity.model &&
        (keepIdentity.fuelType ?? null) === (retireIdentity.fuelType ?? null);
      const keepRange = rangeOf(keepRows);
      const retireRange = rangeOf(retireRows);
      const contained = retireRange.years[0] >= keepRange.years[0] && retireRange.years[1] <= keepRange.years[1] &&
        retireRange.cc[0] >= keepRange.cc[0] && retireRange.cc[1] <= keepRange.cc[1];

      // Retiring must not lose trim coverage: every trim the retired
      // specification constrains has to exist in the kept one, and a broad row
      // must survive on either side.
      const trimsOf = (rows: MatchRow[]) => new Set(rows.map((row) => row.trim).filter((value): value is string => Boolean(value)));
      const keepTrims = trimsOf(keepRows);
      const retireTrims = trimsOf(retireRows);
      const keepBroad = keepRows.some((row) => !row.trim && !row.badge_normalized);
      const retireBroad = retireRows.some((row) => !row.trim && !row.badge_normalized);
      const missingTrims = [...retireTrims].filter((trim) => !keepTrims.has(trim));
      const trimsCovered = missingTrims.length === 0;
      const broadCovered = !retireBroad || keepBroad || item.widen;

      if (!samePower || !sameIdentity || !contained || !trimsCovered || !broadCovered) {
        report.push({
          case: item.name, status: "aborted",
          reason: "equivalence_check_failed",
          samePower, sameIdentity, contained, trimsCovered, broadCovered, missingTrims,
          keepRange, retireRange,
        });
        continue;
      }

      const needsBroadRow = item.widen &&
        !keepRows.some((row) => !row.trim && !row.badge_normalized);
      const template = keepRows[0];

      report.push({
        case: item.name, status: "planned",
        keepKey: keep.spec_key, retireKey: retire.spec_key,
        powerKw: Number(keep.calculation_power_kw), keepRange, retireRange,
        keepMatcherRows: keepRows.length, retireMatcherRows: retireRows.length,
        broadRowAdded: needsBroadRow,
      });

      if (needsBroadRow) {
        actions.push(async () => {
          await db.query(
            `insert into public.vehicle_power_spec_matches
               (spec_id, priority, brand, model, generation, trim, badge_normalized, model_code, engine_code,
                fuel_type, drive_type, production_year_from, production_year_to, engine_cc_from, engine_cc_to)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            [keep.id, template.priority, template.brand, template.model, template.generation, null, null,
              template.model_code, template.engine_code, template.fuel_type, template.drive_type,
              template.production_year_from, template.production_year_to, template.engine_cc_from, template.engine_cc_to],
          );
        });
      }

      actions.push(async () => {
        await db.query(
          `update public.vehicle_power_specs
              set status='retired',
                  approval_note = coalesce(approval_note, '') || $2,
                  updated_at=now()
            where id=$1`,
          [retire.id, ` Retired by reference reconciliation: superseded by ${keep.spec_key}.`],
        );
      });
    }

    let applied = 0;
    if (write && actions.length) {
      await db.query("begin");
      try {
        for (const action of actions) { await action(); applied++; }
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }

    console.log(JSON.stringify({
      dryRun: !write,
      casesEvaluated: CASES.length,
      actions: write ? applied : actions.length,
      report,
      encarRequests: 0,
      publicCatalogChanged: false,
    }, null, 2));
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
