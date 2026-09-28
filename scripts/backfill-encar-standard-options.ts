/**
 * Restore installed Encar standard options for active cards that have no option
 * rows, using codes already saved in `cars.vehicle_specs`.
 *
 * Dry-run by default. Set ENCAR_OPTIONS_BACKFILL_APPLY=true to insert rows.
 * This script never deletes or replaces existing option data.
 */
import { config } from "dotenv";
import { Client } from "pg";
import { fetchStandardOptionCatalog } from "../src/server/imports/encar";
import { isEncarOptionDisplayable, mapStandardOptions } from "../src/server/imports/encar-options";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
const apply = process.env.ENCAR_OPTIONS_BACKFILL_APPLY === "true";
const limit = Math.max(0, Number(process.env.ENCAR_OPTIONS_BACKFILL_LIMIT ?? 0));

type Candidate = { id: string; source_id: string; codes: Array<string | number> };

async function main() {
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
  if (!Number.isInteger(limit)) throw new Error("ENCAR_OPTIONS_BACKFILL_LIMIT must be an integer");

  const catalog = await fetchStandardOptionCatalog();
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, statement_timeout: 30_000 });
  await db.connect();
  try {
    await db.query("begin read only");
    const candidates = (await db.query<Candidate>(`
      with latest as (
        select distinct on (s.source_id) s.source_id, s.payload
        from public.source_snapshots s
        where s.source = 'encar'
        order by s.source_id, s.fetched_at desc
      )
      select c.id, c.source_id,
             case
               when jsonb_typeof(c.vehicle_specs -> 'encar_standard_option_codes') = 'array'
                 and jsonb_array_length(c.vehicle_specs -> 'encar_standard_option_codes') > 0
               then array(select jsonb_array_elements_text(c.vehicle_specs -> 'encar_standard_option_codes'))
               else array(select jsonb_array_elements_text(l.payload -> 'detail' -> 'options' -> 'standard'))
             end as codes
      from public.cars c
      left join latest l on l.source_id = c.source_id
      where c.is_available = true and c.primary_source = 'encar'
        and (
          (jsonb_typeof(c.vehicle_specs -> 'encar_standard_option_codes') = 'array'
            and jsonb_array_length(c.vehicle_specs -> 'encar_standard_option_codes') > 0)
          or (jsonb_typeof(l.payload -> 'detail' -> 'options' -> 'standard') = 'array'
            and jsonb_array_length(l.payload -> 'detail' -> 'options' -> 'standard') > 0)
        )
        and not exists (select 1 from public.car_options o where o.car_id = c.id)
      order by c.source_id
    `)).rows;
    await db.query("rollback");

    const selected = limit ? candidates.slice(0, limit) : candidates;
    const plans = selected.map((car) => {
      const options = mapStandardOptions(catalog, car.codes).filter((row) =>
        row.is_present === true && isEncarOptionDisplayable(row),
      );
      return { car, options };
    });
    const catalogCodes = new Set<string>();
    for (const option of catalog.options ?? []) {
      if (option.optionCd != null) catalogCodes.add(String(option.optionCd));
      for (const subOption of option.subOptions ?? []) {
        if (subOption.optionCd != null) catalogCodes.add(String(subOption.optionCd));
      }
    }
    const ready = plans.filter((plan) => plan.options.length > 0);
    const report = {
      dryRun: !apply,
      sourceScope: "active Encar cars only; Chestny cards are not modified",
      candidatesInCatalog: candidates.length,
      selected: selected.length,
      carsWithMappedOptions: ready.length,
      carsWithoutDisplayableMapping: plans.length - ready.length,
      optionRowsPlanned: ready.reduce((total, plan) => total + plan.options.length, 0),
      codesOnSelectedCars: selected.reduce((total, car) => total + car.codes.length, 0),
      catalogCodeCount: catalogCodes.size,
      insertedCars: 0,
      insertedRows: 0,
    };

    if (!apply) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    for (const plan of ready) {
      await db.query("begin");
      try {
        const locked = await db.query<{ id: string }>(
          `select id from public.cars where id=$1 and primary_source='encar' and is_available=true for update`,
          [plan.car.id],
        );
        if (!locked.rowCount) {
          await db.query("rollback");
          continue;
        }
        const inserted = await db.query<{ id: string }>(`
          insert into public.car_options(
            car_id, source, category, source_code, name_original, name_ru,
            value_original, value_ru, price_krw, description_original, description_ru,
            is_present, sort_order
          )
          select $1, 'encar', r.category, r.source_code, r.name_original, r.name_ru,
                 r.value_original, r.value_ru, r.price_krw, r.description_original, r.description_ru,
                 true, r.sort_order
          from jsonb_to_recordset($2::jsonb) as r(
            category text, source_code text, name_original text, name_ru text,
            value_original text, value_ru text, price_krw bigint,
            description_original text, description_ru text, sort_order integer
          )
          where not exists (select 1 from public.car_options where car_id=$1)
          returning id
        `, [plan.car.id, JSON.stringify(plan.options)]);
        await db.query("commit");
        if (inserted.rowCount) {
          report.insertedCars++;
          report.insertedRows += inserted.rowCount;
        }
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await db.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
