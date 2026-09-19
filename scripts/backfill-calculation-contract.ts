import { Client } from "pg";
import { config } from "dotenv";

/**
 * Brings published cards onto the calculation contract.
 *
 * For every active, priced car it fills the fields the contract expects:
 *   - power_basis       electric -> electric_30min, hybrid -> parallel_sum,
 *                       otherwise combustion_engine;
 *   - calculation_power_kw  the approved specification value when the card has
 *                       one, otherwise the exact kW implied by the stored power
 *                       that the price was actually calculated from, recorded
 *                       explicitly in the resolution note;
 *   - calculation_month + source  from the registration date, with the June
 *                       fallback labelled as such instead of silent;
 *   - legacy_calculation_status   the historic free-form marker, preserved as
 *                       provenance only.
 *
 * Read-only by default; set CONTRACT_WRITE=true to apply. Constraints added by
 * the migration are validated afterwards.
 *
 * No Encar requests. The calculator itself is untouched.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const write = process.env.CONTRACT_WRITE === "true";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const KW_PER_PS = 0.73549875;
const DERIVED_NOTE = "calculation_power_kw derived from the stored power used by the price (no approved specification).";
const CONSTRAINTS = [
  "cars_price_requires_resolved_power",
  "cars_power_kw_requires_basis",
  "cars_electric_uses_electric_basis",
  "cars_electric_has_no_ice_power",
  "cars_month_source_requires_month",
];

type Row = {
  id: string; source_id: string; fuel_type: string | null; price_rub: number | null; power_hp: number | null;
  calculation_power_kw: number | null; power_basis: string | null; calculation_power_spec_id: string | null;
  registration_date: string | null; calculation_month: number | null; calculation_month_source: string | null;
  legacy_calculation_status: string | null; power_resolution_note: string | null; legacy_marker: string | null;
  spec_kw: number | null;
};

function basisFor(fuel: string | null): string {
  if (fuel === "electric") return "electric_30min";
  if (fuel === "hybrid" || fuel === "petrol_electric" || fuel === "diesel_electric") return "parallel_sum";
  return "combustion_engine";
}

function monthFor(registrationDate: string | null): { month: number; source: string } {
  if (registrationDate) {
    const date = new Date(registrationDate);
    if (!Number.isNaN(date.getTime())) {
      const year = date.getUTCFullYear();
      if (year >= 1990 && year <= new Date().getUTCFullYear() + 1) {
        return { month: date.getUTCMonth() + 1, source: "registration_date" };
      }
    }
  }
  // Labelled fallback: the June default is stored with its source, never hidden.
  return { month: 6, source: "fallback" };
}

const chunk = <T,>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const { rows } = await db.query<Row>(`
      select c.id, c.source_id, c.fuel_type, c.price_rub, c.power_hp,
             c.calculation_power_kw, c.power_basis, c.calculation_power_spec_id,
             c.registration_date, c.calculation_month, c.calculation_month_source,
             c.legacy_calculation_status, c.power_resolution_note,
             c.vehicle_specs->>'calculation_status' as legacy_marker,
             s.calculation_power_kw as spec_kw
      from public.cars c
      left join public.vehicle_power_specs s on s.id = c.calculation_power_spec_id
      where c.is_available = true and c.price_rub is not null`);

    const basisOnly = await db.query<{ id: string; fuel_type: string | null }>(`
      select id, fuel_type from public.cars where power_basis is null`);

    const basisUpdates = new Map<string, string>();
    const kwUpdates: Array<[string, number]> = [];
    const noteUpdates: Array<[string, string]> = [];
    const monthUpdates: Array<[string, number, string]> = [];
    const legacyUpdates: Array<[string, string]> = [];
    let kwFromSpec = 0;
    let kwDerived = 0;
    let kwAlreadySet = 0;
    let monthFromDate = 0;
    let monthFallback = 0;

    for (const row of rows) {
      const basis = basisFor(row.fuel_type);
      if (row.power_basis !== basis) basisUpdates.set(row.id, basis);

      if (row.calculation_power_kw != null) {
        kwAlreadySet++;
      } else if (row.spec_kw != null) {
        kwUpdates.push([row.id, Number(row.spec_kw)]);
        kwFromSpec++;
      } else if (row.power_hp != null) {
        kwUpdates.push([row.id, Number((Number(row.power_hp) * KW_PER_PS).toFixed(4))]);
        if (!(row.power_resolution_note ?? "").includes(DERIVED_NOTE)) {
          const note = row.power_resolution_note ? `${row.power_resolution_note} ${DERIVED_NOTE}` : DERIVED_NOTE;
          noteUpdates.push([row.id, note]);
        }
        kwDerived++;
      }

      const months = monthFor(row.registration_date);
      if (row.calculation_month !== months.month || row.calculation_month_source !== months.source) {
        monthUpdates.push([row.id, months.month, months.source]);
      }
      if (months.source === "registration_date") monthFromDate++; else monthFallback++;

      if (row.legacy_marker && row.legacy_calculation_status !== row.legacy_marker) {
        legacyUpdates.push([row.id, row.legacy_marker]);
      }
    }

    // Rows outside the published scope can still carry an exact kW from an older
    // resolution while their basis stayed empty. The basis is deterministic from
    // the fuel type, so it is filled for them too.
    for (const row of basisOnly.rows) {
      if (!basisUpdates.has(row.id)) basisUpdates.set(row.id, basisFor(row.fuel_type));
    }

    let written = 0;
    const validated: string[] = [];
    let legacyKeysRemoved = 0;
    if (write) {
      await db.query("begin");
      try {
        for (const part of chunk([...basisUpdates.entries()], 500)) {
          const result = await db.query(
            `update public.cars as c set power_basis = v.basis, updated_at = now()
               from unnest($1::uuid[], $2::text[]) as v(id, basis) where c.id = v.id`,
            [part.map(([id]) => id), part.map(([, basis]) => basis)],
          );
          written += result.rowCount ?? 0;
        }
        for (const part of chunk(kwUpdates, 500)) {
          const result = await db.query(
            `update public.cars as c set calculation_power_kw = v.kw, updated_at = now()
               from unnest($1::uuid[], $2::numeric[]) as v(id, kw) where c.id = v.id`,
            [part.map(([id]) => id), part.map(([, kw]) => kw)],
          );
          written += result.rowCount ?? 0;
        }
        for (const part of chunk(noteUpdates, 500)) {
          const result = await db.query(
            `update public.cars as c set power_resolution_note = v.note, updated_at = now()
               from unnest($1::uuid[], $2::text[]) as v(id, note) where c.id = v.id`,
            [part.map(([id]) => id), part.map(([, note]) => note)],
          );
          written += result.rowCount ?? 0;
        }
        for (const part of chunk(monthUpdates, 500)) {
          const result = await db.query(
            `update public.cars as c set calculation_month = v.month, calculation_month_source = v.source, updated_at = now()
               from unnest($1::uuid[], $2::smallint[], $3::text[]) as v(id, month, source) where c.id = v.id`,
            [part.map(([id]) => id), part.map(([, month]) => month), part.map(([, , source]) => source)],
          );
          written += result.rowCount ?? 0;
        }
        for (const part of chunk(legacyUpdates, 500)) {
          const result = await db.query(
            `update public.cars as c set legacy_calculation_status = v.marker, updated_at = now()
               from unnest($1::uuid[], $2::text[]) as v(id, marker) where c.id = v.id`,
            [part.map(([id]) => id), part.map(([, marker]) => marker)],
          );
          written += result.rowCount ?? 0;
        }
        // The free-form marker is history now: the value lives in
        // legacy_calculation_status and nothing should read the old key.
        const removed = await db.query(
          `update public.cars
              set vehicle_specs = vehicle_specs - 'calculation_status', updated_at = now()
            where vehicle_specs ? 'calculation_status' and legacy_calculation_status is not null`,
        );
        legacyKeysRemoved = removed.rowCount ?? 0;

        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }

      for (const constraint of CONSTRAINTS) {
        await db.query(`alter table public.cars validate constraint ${constraint}`);
        validated.push(constraint);
      }
    }

    console.log(JSON.stringify({
      dryRun: !write,
      pricedCars: rows.length,
      planned: {
        powerBasis: basisUpdates.size,
        powerBasisByValue: rows.reduce<Record<string, number>>((map, row) => {
          const basis = basisFor(row.fuel_type);
          map[basis] = (map[basis] ?? 0) + 1;
          return map;
        }, {}),
        calculationPowerKw: kwUpdates.length,
        kwFromSpec,
        kwDerived,
        kwAlreadySet,
        notesUpdated: noteUpdates.length,
        month: monthUpdates.length,
        monthFromDate,
        monthFallback,
        legacyMarkerPreserved: legacyUpdates.length,
      },
      written,
      legacyKeysRemoved,
      validatedConstraints: validated,
      encarRequests: 0,
    }, null, 2));
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
