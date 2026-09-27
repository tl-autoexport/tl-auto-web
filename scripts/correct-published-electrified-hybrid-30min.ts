/** Correct the published hybrid power inputs for the approved run-scoped 21a687ee cohort. */
import { readFile, writeFile } from "node:fs/promises";
import { config } from "dotenv";
import { Client } from "pg";
import { calculateRuVladivostok, CALC_VERSION } from "../src/server/calc/ru";
import { getCbrCalcRates } from "../src/server/calc/rates";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const RUN_ID = "21a687ee-6717-4610-a9cc-97c64608bbb9";
const POWER_PATH = "data/power/electrified-21a687ee-power-reference.json";
const REPORT_PATH = `output/tl-auto-electrified-${RUN_ID}-hybrid-30min-correction.json`;
const WRITE = process.env.TL_AUTO_HYBRID_30MIN_CORRECTION_WRITE === "true";
const KW_PER_PS = 0.73549875;

type PowerEntry = {
  sourceListingId: string; fuelType: string; powerBasis: string; sourceKind: string; sourceUrl: string;
  sourceNote: string; customsPowerPs: number; calculationPowerKw: number; enginePowerPs: number | null;
  electricMotorPowerPs: number | null; electricMotorPowerKw: number | null;
  electric30MinPs: number | null; electric30MinKw: number | null; electric30MinEvidence?: Record<string, unknown>;
};
type Car = {
  id: string; source_id: string; is_available: boolean; fuel_type: string | null;
  power_hp: number | null; calculation_power_kw: string | number | null; hybrid_dvs_power_hp: string | number | null;
  hybrid_electric_power_kw: string | number | null; hybrid_sequential: boolean | null;
  hybrid_dvs_above_electric_30min: boolean | null; power_basis: string | null; power_finality: string | null;
  power_resolution_source: string | null; power_resolution_note: string | null; power_source: string | null;
  vehicle_specs: Record<string, unknown> | null; price_krw: string | number | null; price_rub: string | number | null;
  engine_cc: number | null; year: number | null; registration_month: number | null; run_id: string | null;
};
type Snapshot = {
  id: string; car_id: string; country_code: string; destination_city: string; importer_type: string;
  calc_version: string; inputs: Record<string, unknown>; rates: Record<string, unknown>;
  result: Record<string, unknown>; car_price_rub: number | null; duty_rub: number | null; fees_rub: number | null;
  util_rub: number | null; freight_rub: number | null; broker_rub: number | null; total_rub: number | null;
};
type Prepared = {
  sourceListingId: string; carId: string; before: Car; oldSnapshot: Snapshot;
  newElectric30MinKw: number; newCalculationPowerKw: number; newPowerHp: number;
  newDvsAboveElectric30Min: boolean; newPriceRub: number; calculation: ReturnType<typeof calculateRuVladivostok>;
  evidence: Record<string, unknown>;
  newSnapshotId?: string;
};

const n = (value: unknown): number | null => {
  const result = value == null ? null : Number(value);
  return Number.isFinite(result) ? result : null;
};
const round4 = (value: number) => Number(value.toFixed(4));
const same = (a: unknown, b: unknown, epsilon = 0.0002) => {
  const x = n(a), y = n(b);
  return x != null && y != null && Math.abs(x - y) <= epsilon;
};

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
  const powerText = await readFile(POWER_PATH, "utf8");
  const power = JSON.parse(powerText) as { runId: string; entries: PowerEntry[] };
  if (power.runId !== RUN_ID) throw new Error("Power manifest belongs to a different run");
  const entries = power.entries.filter((entry) => entry.fuelType === "hybrid" &&
    entry.electric30MinEvidence?.status === "audit_reported_preliminary");
  if (entries.length !== 45 || new Set(entries.map((entry) => entry.sourceListingId)).size !== 45 ||
      entries.some((entry) => entry.powerBasis !== "parallel_sum" || entry.electric30MinKw == null ||
        entry.electric30MinPs == null || entry.enginePowerPs == null || entry.electricMotorPowerKw == null ||
        entry.electricMotorPowerPs == null || !entry.electric30MinEvidence))
    throw new Error(`Expected exactly 45 complete, run-scoped hybrid audit entries; found ${entries.length}`);

  const ids = entries.map((entry) => entry.sourceListingId);
  const rates = WRITE ? null : await getCbrCalcRates();
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  await db.connect();
  try {
    if (WRITE) {
      const previewText = await readFile(REPORT_PATH, "utf8");
      const preview = JSON.parse(previewText) as {
        runId: string; mode: string; manifestSha256: string; prepared: Prepared[]; ids: string[];
        rateSnapshot: Awaited<ReturnType<typeof getCbrCalcRates>>;
      };
      const { createHash } = await import("node:crypto");
      const digest = createHash("sha256").update(powerText).digest("hex");
      if (preview.runId !== RUN_ID || preview.mode !== "preview" || preview.manifestSha256 !== digest ||
          preview.ids.length !== 45 || preview.prepared.length !== 45 ||
          [...preview.ids].sort().join(",") !== [...ids].sort().join(","))
        throw new Error("Correction preview is missing, stale, or does not match exactly these 45 manifest entries");

      await db.query("begin isolation level serializable");
      try {
        await db.query("select pg_advisory_xact_lock(hashtext($1))", [`tl-auto-hybrid-30min-correction:${RUN_ID}`]);
        const locked = await db.query<Car>(`select id,source_id,is_available,fuel_type,power_hp,calculation_power_kw,
            hybrid_dvs_power_hp,hybrid_electric_power_kw,hybrid_sequential,hybrid_dvs_above_electric_30min,
            power_basis,power_finality,power_resolution_source,power_resolution_note,power_source,vehicle_specs,
            price_krw,price_rub,engine_cc,year,registration_month,vehicle_specs->>'enrichment_run_id' run_id
          from public.cars where primary_source='encar' and source_id=any($1::text[]) for update`, [ids]);
        if (locked.rows.length !== 45) throw new Error(`Locked cars changed: ${locked.rows.length}/45`);
        const lockedById = new Map(locked.rows.map((car) => [car.source_id, car]));
        const snapshots = await db.query<Snapshot>(`select s.* from public.calc_snapshots s join public.cars c on c.id=s.car_id
          where c.primary_source='encar' and c.source_id=any($1::text[]) order by s.car_id,s.calculated_at desc for update of s`, [ids]);
        if (snapshots.rows.length !== 45) throw new Error(`Expected exactly 45 existing calculation snapshots; found ${snapshots.rows.length}`);
        const snapshotByCar = new Map(snapshots.rows.map((snapshot) => [snapshot.car_id, snapshot]));

        for (const item of preview.prepared) {
          const car = lockedById.get(item.sourceListingId);
          if (!car || car.id !== item.carId) throw new Error(`Car identity changed for ${item.sourceListingId}`);
          const old = item.before;
          for (const field of ["price_rub", "price_krw", "power_hp", "calculation_power_kw", "hybrid_dvs_power_hp", "hybrid_electric_power_kw"] as const) {
            if (String(car[field] ?? "") !== String(old[field] ?? "")) throw new Error(`Live ${field} changed since preview for ${item.sourceListingId}`);
          }
          if (!car.is_available || car.fuel_type !== "hybrid" || car.run_id !== RUN_ID || car.power_finality !== "provisional" ||
              car.hybrid_sequential !== false || car.power_basis !== "parallel_sum")
            throw new Error(`Live car no longer satisfies run/published/provisional hybrid safeguards: ${item.sourceListingId}`);
          const oldSnapshot = snapshotByCar.get(car.id);
          if (!oldSnapshot || oldSnapshot.id !== item.oldSnapshot.id) throw new Error(`Calculation snapshot changed for ${item.sourceListingId}`);
          if (!same(oldSnapshot.total_rub, item.oldSnapshot.total_rub, 0.01)) throw new Error(`Snapshot amount changed for ${item.sourceListingId}`);
        }

        for (const item of preview.prepared) {
          const inserted = await db.query<{ id: string }>(`insert into public.calc_snapshots
            (car_id,country_code,destination_city,importer_type,calc_version,inputs,rates,result,
             car_price_rub,duty_rub,fees_rub,util_rub,freight_rub,broker_rub,total_rub)
            values ($1,'RU','Владивосток','individual',$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,$12)
            returning id`, [item.carId, item.calculation.calcVersion,
            JSON.stringify({ ...item.before, power_hp: item.newPowerHp, price_rub: item.newPriceRub,
              calculation_power_kw: item.newCalculationPowerKw,
              hybrid_electric_power_kw: item.newElectric30MinKw, hybrid_dvs_above_electric_30min: item.newDvsAboveElectric30Min,
              power_finality: "provisional", power_evidence: item.evidence,
              power_resolution_note: `Предварительная мощность гибрида пересчитана по 30-минутной мощности электромотора; run ${RUN_ID}. Значение перенесено из аудита, карточка остаётся preliminary.`,
              runId: RUN_ID }),
            JSON.stringify({ ...item.calculation.rates, customsRates: item.calculation.customsRates,
              rateDetails: item.calculation.rateDetails, asOf: item.calculation.ratesAsOf, source: item.calculation.ratesSource }),
            JSON.stringify(item.calculation), Math.round(item.calculation.carPriceRub), Math.round(item.calculation.dutyRub),
            Math.round(item.calculation.feesRub), Math.round(item.calculation.utilRub), Math.round(item.calculation.freightRub),
            Math.round(item.calculation.brokerRub), Math.round(item.calculation.totalRub)]);
          const newSnapshotId = inserted.rows[0]?.id;
          if (!newSnapshotId) throw new Error(`New calc snapshot id missing for ${item.sourceListingId}`);
          const oldSnapshotId = item.oldSnapshot.id;
          await db.query("update public.leads set calc_snapshot_id=$1 where calc_snapshot_id=$2", [newSnapshotId, oldSnapshotId]);
          const current = lockedById.get(item.sourceListingId)!;
          const specs = {
            ...(current.vehicle_specs ?? {}),
            electrified_power_evidence: {
              ...((current.vehicle_specs?.electrified_power_evidence as Record<string, unknown> | undefined) ?? {}),
              electric30MinEvidence: item.evidence,
              correctedCalculationPowerKw: item.newCalculationPowerKw,
              correctionRunId: RUN_ID,
              correctionStatus: "preliminary_audit_reported",
            },
          };
          const updated = await db.query(`update public.cars set
              power_hp=$1, calculation_power_kw=$2, hybrid_electric_power_kw=$3,
              hybrid_dvs_above_electric_30min=$4, price_rub=$5, vehicle_specs=$6::jsonb,
              power_resolution_note=$7
            where id=$8 and source_id=$9 and is_available=true and power_finality='provisional'
              and vehicle_specs->>'enrichment_run_id'=$10`, [item.newPowerHp, item.newCalculationPowerKw,
            item.newElectric30MinKw, item.newDvsAboveElectric30Min, item.newPriceRub, JSON.stringify(specs),
            `Предварительная мощность гибрида пересчитана по 30-минутной мощности электромотора; run ${RUN_ID}. Значение перенесено из аудита, карточка остаётся preliminary.`,
            item.carId, item.sourceListingId, RUN_ID]);
          if (updated.rowCount !== 1) throw new Error(`Conditional car update failed for ${item.sourceListingId}`);
          const deleted = await db.query("delete from public.calc_snapshots where id=$1 and car_id=$2", [oldSnapshotId, item.carId]);
          if (deleted.rowCount !== 1) throw new Error(`Old snapshot cleanup failed for ${item.sourceListingId}`);
          item.newSnapshotId = newSnapshotId;
        }

        const verify = await db.query<{ total: number; corrected: number; provisional: number; snapshots: number; mismatched: number }>(`
          select count(*)::int total,
            count(*) filter (where c.hybrid_electric_power_kw=e.electric30_min_kw and c.calculation_power_kw=e.calculation_power_kw)::int corrected,
            count(*) filter (where c.power_finality='provisional' and c.is_available)::int provisional,
            (select count(distinct s.car_id)::int from public.calc_snapshots s join public.cars x on x.id=s.car_id
              where x.primary_source='encar' and x.source_id=any($1::text[])) snapshots,
            count(*) filter (where round(s.total_rub)::bigint<>c.price_rub)::int mismatched
          from public.cars c join unnest($1::text[],$2::numeric[],$3::numeric[]) e(source_id,electric30_min_kw,calculation_power_kw)
            on e.source_id=c.source_id
          join public.calc_snapshots s on s.car_id=c.id
          where c.primary_source='encar'`, [ids, preview.prepared.map((x) => x.newElectric30MinKw), preview.prepared.map((x) => x.newCalculationPowerKw)]);
        const check = verify.rows[0];
        if (check.total !== 45 || check.corrected !== 45 || check.provisional !== 45 || check.snapshots !== 45 || check.mismatched !== 0)
          throw new Error(`Post-write verification failed; transaction will roll back: ${JSON.stringify(check)}`);
        await db.query("commit");
        const final = { ...preview, mode: "applied", databaseWrites: 45, completedAt: new Date().toISOString() };
        await writeFile(REPORT_PATH, `${JSON.stringify(final, null, 2)}\n`);
        console.log(JSON.stringify({ mode: "applied", runId: RUN_ID, correctedListings: 45,
          provisionalListings: 45, snapshotsReplaced: 45, recalculated: 45, totalPriceDeltaRub:
            preview.prepared.reduce((sum, item) => sum + item.newPriceRub - Number(item.before.price_rub), 0),
          ratesAsOf: preview.rateSnapshot.asOf, report: REPORT_PATH }, null, 2));
      } catch (error) {
        await db.query("rollback").catch(() => undefined);
        throw error;
      }
      return;
    }

    await db.query("begin read only");
    const cars = await db.query<Car>(`select id,source_id,is_available,fuel_type,power_hp,calculation_power_kw,
        hybrid_dvs_power_hp,hybrid_electric_power_kw,hybrid_sequential,hybrid_dvs_above_electric_30min,
        power_basis,power_finality,power_resolution_source,power_resolution_note,power_source,vehicle_specs,
        price_krw,price_rub,engine_cc,year,registration_month,vehicle_specs->>'enrichment_run_id' run_id
      from public.cars where primary_source='encar' and source_id=any($1::text[]) order by source_id`, [ids]);
    const snapshots = await db.query<Snapshot>(`select s.* from public.calc_snapshots s join public.cars c on c.id=s.car_id
      where c.primary_source='encar' and c.source_id=any($1::text[]) order by s.car_id,s.calculated_at desc`, [ids]);
    await db.query("rollback");
    if (cars.rows.length !== 45 || snapshots.rows.length !== 45) throw new Error(`Expected 45 live cars/snapshots; found ${cars.rows.length}/${snapshots.rows.length}`);
    const carById = new Map(cars.rows.map((car) => [car.source_id, car]));
    const snapshotByCar = new Map(snapshots.rows.map((snapshot) => [snapshot.car_id, snapshot]));
    const prepared: Prepared[] = [];
    for (const entry of entries) {
      const car = carById.get(entry.sourceListingId);
      if (!car || !car.is_available || car.fuel_type !== "hybrid" || car.run_id !== RUN_ID || car.power_finality !== "provisional" ||
          car.power_basis !== "parallel_sum" || car.hybrid_sequential !== false)
        throw new Error(`Live car failed identity/publication/finality checks: ${entry.sourceListingId}`);
      if (!car.price_krw || !car.engine_cc || !car.year || !same(car.hybrid_dvs_power_hp, entry.enginePowerPs) ||
          !same(car.hybrid_electric_power_kw, entry.electricMotorPowerKw) ||
          !same(car.calculation_power_kw, Number((entry.enginePowerPs! * KW_PER_PS + entry.electricMotorPowerKw!).toFixed(4)), 0.002) ||
          car.power_hp !== Math.round(entry.enginePowerPs! + entry.electricMotorPowerPs!))
        throw new Error(`Live values no longer match original run's peak-power calculation for ${entry.sourceListingId}`);
      const oldSnapshot = snapshotByCar.get(car.id);
      if (!oldSnapshot || oldSnapshot.calc_version !== CALC_VERSION ||
          !same(oldSnapshot.inputs.hybrid_electric_power_kw, entry.electricMotorPowerKw) ||
          !same(oldSnapshot.inputs.calculation_power_kw, car.calculation_power_kw) ||
          !same(oldSnapshot.total_rub, car.price_rub, 1.01))
        throw new Error(`Current calculation snapshot is missing or does not reflect the old peak-power calculation for ${entry.sourceListingId}`);
      const electricKw = entry.electric30MinKw!;
      const calculationPowerKw = round4((entry.enginePowerPs! / 1.3596216173) + electricKw);
      if (!same(entry.calculationPowerKw, calculationPowerKw, 0.002))
        throw new Error(`Manifest TKS power sum mismatch for ${entry.sourceListingId}`);
      const evidence = entry.electric30MinEvidence!;
      const calculation = calculateRuVladivostok({
        priceKrw: Number(car.price_krw), year: car.year, month: car.registration_month ?? 6, engineCc: car.engine_cc,
        hybridDvsPowerHp: entry.enginePowerPs!, hybridDvsPowerKw: entry.enginePowerPs! / 1.3596216173,
        hybridElectricPowerKw: electricKw, hybridDvsAboveElectric30Min: entry.enginePowerPs! > entry.electric30MinPs!,
        hybridSequential: false, fuelType: "hybrid", destinationCity: "Владивосток",
        rates: rates!.rates, customsRates: rates!.customsRates, ratesAsOf: rates!.asOf,
        ratesSource: rates!.source, rateDetails: rates!.rateDetails,
      });
      prepared.push({ sourceListingId: entry.sourceListingId, carId: car.id, before: car, oldSnapshot,
        newElectric30MinKw: electricKw, newCalculationPowerKw: calculationPowerKw,
        newPowerHp: Math.round(entry.customsPowerPs), newDvsAboveElectric30Min: entry.enginePowerPs! > entry.electric30MinPs!,
        newPriceRub: Math.round(calculation.totalRub), calculation, evidence });
    }
    const { createHash } = await import("node:crypto");
    const report = { mode: "preview", runId: RUN_ID, generatedAt: new Date().toISOString(), manifestSha256:
      createHash("sha256").update(powerText).digest("hex"), ids, rateSnapshot: rates,
      summary: { exactTargets: 45, recalculated: 45, databaseWrites: 0,
        oldPriceRub: prepared.reduce((sum, item) => sum + Number(item.before.price_rub), 0),
        newPriceRub: prepared.reduce((sum, item) => sum + item.newPriceRub, 0),
        priceDeltaRub: prepared.reduce((sum, item) => sum + item.newPriceRub - Number(item.before.price_rub), 0),
        unchangedProvisionalFinality: true, externalEncarRequests: 0 },
      prepared };
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ mode: "preview", ...report.summary, runId: RUN_ID,
      priceDeltaRubByFuel: Object.entries(prepared.reduce((groups, item) => {
        const group = String(item.before.vehicle_specs?.fuel_type ?? "hybrid");
        groups[group] ??= { listings: 0, oldRub: 0, newRub: 0 };
        groups[group].listings++; groups[group].oldRub += Number(item.before.price_rub); groups[group].newRub += item.newPriceRub;
        return groups;
      }, {} as Record<string, { listings: number; oldRub: number; newRub: number }>)).map(([fuel, x]) => ({ fuel, ...x, deltaRub: x.newRub - x.oldRub })),
      report: REPORT_PATH }, null, 2));
  } finally { await db.end(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
