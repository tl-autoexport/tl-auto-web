import { config } from "dotenv";
import { getCbrCalcRates } from "@/server/calc/rates";
import { createSupabaseAdmin } from "@/server/supabase/admin";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

async function main() {
  const dryRun = process.env.RATES_DRY_RUN !== "false";
  const snapshot = await getCbrCalcRates();
  if (!dryRun) {
    const supabase = createSupabaseAdmin();
    const { error } = await supabase.from("calc_rate_snapshots").insert({
      rates: snapshot.rates,
      rate_details: snapshot.rateDetails,
      source: snapshot.source,
      as_of: snapshot.asOf,
      fetched_at: snapshot.rateDetails.fetchedAt,
    });
    if (error) throw error;
  }
  console.log(JSON.stringify({ dryRun, ...snapshot }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
