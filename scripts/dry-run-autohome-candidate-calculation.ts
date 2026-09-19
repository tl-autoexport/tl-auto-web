import { Client } from "pg";
import { config } from "dotenv";
import { calculateRuVladivostok } from "../src/server/calc/ru";
import { getCbrCalcRates } from "../src/server/calc/rates";

config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const rates = await getCbrCalcRates();
    const { rows } = await db.query(`
      select s.source_listing_id,s.manufacturer,s.model,s.model_year,s.first_registration_date,
             s.price_krw,s.engine_cc,s.fuel_type,s.mileage_km,
             (s.raw_payload->'autohome_power_candidate'->>'power_hp')::numeric as candidate_power_hp,
             c.price_rub as current_price_rub
        from public.chestny_catalog_staging s
        left join public.cars c on c.source_id=s.source_listing_id and c.primary_source='chestny_prigon'
       where s.source_status='active' and s.promotion_status='auto_candidate'
         and s.raw_payload->'autohome_power_candidate'->>'review_status'='draft'
       order by s.source_listing_id`);
    let planned = 0, skipped = 0, raised = 0, lowered = 0;
    let before = 0, after = 0;
    const samples: unknown[] = [];
    for (const row of rows) {
      if (!row.price_krw || !row.model_year || !row.engine_cc || !row.candidate_power_hp) { skipped++; continue; }
      const date = row.first_registration_date ? new Date(row.first_registration_date) : null;
      const month = date && !Number.isNaN(date.getTime()) ? date.getUTCMonth() + 1 : 6;
      const calc = calculateRuVladivostok({
        priceKrw: Number(row.price_krw), year: Number(row.model_year), month,
        engineCc: Number(row.engine_cc), powerHp: Number(row.candidate_power_hp), fuelType: row.fuel_type ?? undefined,
        rates: rates.rates, customsRates: rates.customsRates, ratesAsOf: rates.asOf,
        ratesSource: rates.source, rateDetails: rates.rateDetails,
      });
      const next = Math.round(calc.totalRub);
      const current = Math.round(Number(row.current_price_rub ?? 0));
      planned++; before += current; after += next;
      if (next > current) raised++; else if (next < current) lowered++;
      if (samples.length < 10) samples.push({ id: row.source_listing_id, model: row.model, powerHp: Number(row.candidate_power_hp), currentRub: current, calculatedRub: next, deltaRub: next - current });
    }
    console.log(JSON.stringify({ dryRun: true, candidateRows: rows.length, planned, skipped, raised, lowered, currentTotalRub: before, calculatedTotalRub: after, deltaTotalRub: after - before, ratesAsOf: rates.asOf, ratesSource: rates.source, samples, encarRequests: 0, databaseWrites: 0, publicCatalogChanged: false }, null, 2));
  } finally { await db.end(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
