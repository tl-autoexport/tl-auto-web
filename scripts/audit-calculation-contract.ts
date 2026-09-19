import { Client } from "pg";
import { config } from "dotenv";

/**
 * Read-only drift report for the calculation/publication contract.
 *
 * The contract lives in `cars` (calculation_power_status, calculation_power_kw,
 * power_basis, power_resolution_source) plus `calc_snapshots`, but several
 * writers bypass it and only set `price_rub` and a free-form
 * `vehicle_specs.calculation_status`. This report measures exactly how many
 * published cards are outside the contract, so the repair has a real scope.
 *
 * No Encar requests, no database writes.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const RESOLVED_STATUSES = ["matched", "approved"];

type CarRow = {
  id: string;   source_id: string; brand: string | null; model: string | null; fuel_type: string | null;
  price_rub: number | null; power_hp: number | null; calculation_power_status: string;
  calculation_power_kw: number | null; power_basis: string | null; power_resolution_source: string | null;
  calculation_power_spec_id: string | null;
  hybrid_dvs_power_hp: number | null; hybrid_electric_power_kw: number | null;
  legacy_status: string | null;
};

const bump = (map: Record<string, number>, key: string) => { map[key] = (map[key] ?? 0) + 1; };

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin read only");

    const { rows } = await db.query<CarRow>(`
      select id, source_id, brand, model, fuel_type, price_rub, power_hp,
             calculation_power_status, calculation_power_kw, power_basis, power_resolution_source,
             calculation_power_spec_id,
             hybrid_dvs_power_hp, hybrid_electric_power_kw,
             vehicle_specs->>'calculation_status' as legacy_status
      from public.cars
      where is_available = true and primary_source in ('encar', 'chestny_prigon')`);

    const snapshots = await db.query<{ car_id: string }>(`
      select distinct car_id from public.calc_snapshots`);
    const withSnapshot = new Set(snapshots.rows.map((row) => row.car_id));

    // The table-level invariants apply to every row, so the report must also
    // cover cards outside the published scope.
    const { rows: outOfScope } = await db.query<{ is_available: boolean; primary_source: string | null; calculation_power_status: string; count: number }>(`
      select is_available, primary_source, calculation_power_status, count(*)::int as count
      from public.cars
      where price_rub is not null and calculation_power_status not in ('matched', 'approved')
      group by 1, 2, 3 order by count desc`);

    const byStatus: Record<string, number> = {};
    const byLegacyStatus: Record<string, number> = {};
    const byBasis: Record<string, number> = {};
    const priced = rows.filter((row) => row.price_rub != null);
    const electricPriced = priced.filter((row) => row.fuel_type === "electric");

    for (const row of rows) {
      bump(byStatus, row.calculation_power_status);
      bump(byLegacyStatus, row.legacy_status ?? "<none>");
      bump(byBasis, row.power_basis ?? "<none>");
    }

    const violations = {
      pricedWithoutResolvedStatus: priced.filter((row) => !RESOLVED_STATUSES.includes(row.calculation_power_status)).length,
      pricedWithoutSnapshot: priced.filter((row) => !withSnapshot.has(row.id)).length,
      pricedWithoutBasis: priced.filter((row) => row.power_basis == null).length,
      pricedWithoutResolutionSource: priced.filter((row) => row.power_resolution_source == null).length,
      pricedWithoutCalculationPowerKw: priced.filter((row) => row.calculation_power_kw == null).length,
      pricedWithoutPowerHp: priced.filter((row) => row.power_hp == null).length,
      electricPricedWithoutElectricBasis: electricPriced.filter((row) => row.power_basis !== "electric_30min").length,
      electricWithIcePowerFields: rows.filter((row) => row.fuel_type === "electric" && (row.hybrid_dvs_power_hp != null || row.hybrid_electric_power_kw != null)).length,
      pricedWithLegacyMarker: priced.filter((row) => row.legacy_status != null).length,
    };

    const missingKw = priced.filter((row) => row.calculation_power_kw == null);
    const kwSourceBreakdown = {
      withApprovedSpec: missingKw.filter((row) => row.calculation_power_spec_id != null).length,
      withoutSpec: missingKw.filter((row) => row.calculation_power_spec_id == null).length,
    };

    const { rows: invariantViolations } = await db.query<{ invariant: string; rows: number }>(`
      select 'price_without_resolved_power' as invariant, count(*)::int as rows from public.cars
        where is_available = true and price_rub is not null and calculation_power_status not in ('matched', 'approved')
      union all
      select 'power_kw_without_basis', count(*)::int from public.cars
        where calculation_power_kw is not null and power_basis is null
      union all
      select 'electric_without_electric_basis', count(*)::int from public.cars
        where fuel_type = 'electric' and power_basis is not null and power_basis <> 'electric_30min'
      union all
      select 'electric_with_ice_power', count(*)::int from public.cars
        where fuel_type = 'electric' and hybrid_dvs_power_hp is not null
      union all
      select 'month_source_without_month', count(*)::int from public.cars
        where calculation_month_source is not null and calculation_month is null`);

    const repairScope = priced.filter((row) =>
      !RESOLVED_STATUSES.includes(row.calculation_power_status) ||
      !withSnapshot.has(row.id) ||
      row.power_basis == null ||
      row.power_resolution_source == null ||
      (row.fuel_type === "electric" && row.power_basis !== "electric_30min"));

    const samples = repairScope.slice(0, 15).map((row) => ({
      sourceId: row.source_id, brand: row.brand, model: row.model, fuel: row.fuel_type,
      priceRub: row.price_rub, powerStatus: row.calculation_power_status, basis: row.power_basis,
      source: row.power_resolution_source, snapshot: withSnapshot.has(row.id), legacyStatus: row.legacy_status,
    }));

    await db.query("rollback");
    console.log(JSON.stringify({
      readOnlyTransaction: true,
      encarRequests: 0,
      databaseWrites: 0,
      totals: { activeCars: rows.length, pricedCars: priced.length, electricPriced: electricPriced.length },
      statusDistribution: byStatus,
      legacyMarkerDistribution: byLegacyStatus,
      powerBasisDistribution: byBasis,
      missingCalculationPowerKwSource: kwSourceBreakdown,
      violations,
      repairScope: repairScope.length,
      invalidPricedRowsOutsidePublishedScope: outOfScope,
      invariantViolationsWholeTable: invariantViolations,
      samples,
    }, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
