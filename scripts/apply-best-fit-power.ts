import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

// Conservative local fallback for configurations lacking a unique approved rule.
// Values are explicitly labelled best_fit_local and never alter public cars/prices.
const values: Record<string, number> = {
  "Mercedes-Benz|A-Class|2020|1991|gasoline|": 190,
  "Mercedes-Benz|A-Class|2026|1991|gasoline|4WD": 224,
  "Audi|A4|2018|1968|diesel|": 150,
  "Hyundai|AVANTE|2021|1998|gasoline|": 149,
  "Hyundai|AVANTE|2023|1998|gasoline|": 149,
  "Mercedes-Benz|C-Class|2018|2996|gasoline|4WD": 333,
  "Mercedes-Benz|C-Class|2025|1999|gasoline|": 204,
  "Hyundai|Casper|2021|998|gasoline|": 76,
  "Hyundai|Casper|2022|998|gasoline|": 76,
  "Hyundai|Casper|2023|998|gasoline|": 76,
  "Hyundai|Casper|2024|998|gasoline|": 76,
  "Volkswagen|Golf|2024|1984|gasoline|": 245,
  "Volkswagen|Jetta|2023|1495|gasoline|": 150,
  "Volkswagen|Jetta|2024|1495|gasoline|": 150,
  "Kia|K3|2024|1591|gasoline|": 123,
  "Kia|K5|2019|1999|gasoline|": 160,
  "Kia|K5|2020|1999|gasoline|": 160,
  "Hyundai|Kona|2025|1598|gasoline|2WD": 198,
  "Kia|Seltos|2023|1598|gasoline|4WD": 198,
  "Kia|Seltos|2024|1598|gasoline|4WD": 198,
  "Kia|Seltos|2026|1580|gasoline|2WD": 193,
  "Hyundai|Staria|2022|3470|lpg|": 240,
  "Hyundai|Staria|2026|3470|lpg|": 240,
  "Volkswagen|Tiguan|2022|1984|gasoline|": 190,
  "Volkswagen|Tiguan|2023|1984|gasoline|": 190,
  "Hyundai|Tucson|2023|1998|diesel|2WD": 186,
  "Hyundai|Tucson|2026|1598|hybrid|2WD": 180,
  "Hyundai|Veloster|2019|1998|gasoline|": 149,
  "BMW|X1|2023|1998|gasoline|": 204,
  "Renault Korea|XM3|2020|1332|gasoline|": 152,
  "Renault Korea|XM3|2020|1598|gasoline|": 123,
};

const sql = `update vehicle_power_review_queue
  set current_sources = jsonb_build_object('source','chestny_catalog_staging','power_hp',$2::numeric,'power_resolution','best_fit_local'),
      priority = case when $2::numeric <= 160 then 20 else 30 end,
      review_note = 'Локально подобранное best-fit значение по модели/году/объёму/топливу; требуется последующая верификация.',
      updated_at = now()
  where configuration_key = $1 and current_sources->>'power_hp' is null`;

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
async function main() {
  await client.connect();
  try {
    await client.query("begin");
    let updated = 0;
    for (const [key, hp] of Object.entries(values)) {
      const result = await client.query(sql, [key, hp]);
      updated += result.rowCount ?? 0;
    }
    await client.query("commit");
    console.log(JSON.stringify({ updated, configured: Object.keys(values).length, source: "best_fit_local", encarRequests: 0, publicCatalogChanged: false }, null, 2));
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
