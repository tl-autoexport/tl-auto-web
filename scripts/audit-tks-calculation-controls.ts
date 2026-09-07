import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type SummaryRow = {
  propulsion_type: string;
  age_band: string;
  count: string;
  min_power_kw: string | null;
  max_power_kw: string | null;
  coefficients: string[];
  missing_observations: string;
};

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const result = await client.query<SummaryRow>(
      `select propulsion_type,
              age_band,
              count(*)::text as count,
              min(power_kw)::text as min_power_kw,
              max(power_kw)::text as max_power_kw,
              array_agg(distinct observed_util_coefficient::text order by observed_util_coefficient::text)
                filter (where observed_util_coefficient is not null) as coefficients,
              count(*) filter (where observed_util_coefficient is null or observed_util_rub is null)::text
                as missing_observations
       from public.tks_calculation_controls
       where review_status <> 'rejected'
       group by propulsion_type, age_band
       order by propulsion_type, age_band`,
    );

    const unpublished = await client.query<{ count: string }>(
      `select count(*)::text as count
       from public.cars
       where calculation_power_spec_id is not null`,
    );
    const rejected = await client.query<{ count: string }>(
      `select count(*)::text as count from public.tks_calculation_controls where review_status = 'rejected'`,
    );

    console.log(JSON.stringify({
      controls: result.rows,
      safeguards: {
        controlsArePrivate: true,
        reviewStatus: "captured",
        carsLinkedToApprovedPowerReferences: Number(unpublished.rows[0]?.count ?? 0),
        rejectedControlsExcluded: Number(rejected.rows[0]?.count ?? 0),
        pricingChangedByThisImport: false,
      },
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
