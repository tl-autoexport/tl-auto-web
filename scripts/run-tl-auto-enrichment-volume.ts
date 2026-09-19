import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env", quiet: true });
const exec = promisify(execFile);
const target = Number(process.env.TL_AUTO_VOLUME_TARGET ?? 1000);
const wave = Number(process.env.TL_AUTO_VOLUME_WAVE ?? 150);
const fuels = (process.env.TL_AUTO_VOLUME_FUELS ?? "gasoline,diesel").split(",").map((x) => x.trim()).filter(Boolean);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)?.trim();
if (!url || !key) throw new Error("Supabase credentials are required");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function publishedCount() {
  const { count, error } = await db.from("cars").select("id", { count: "exact", head: true }).eq("is_available", true).not("published_at", "is", null).in("fuel_type", fuels);
  if (error) throw error;
  return count ?? 0;
}

async function publishWave(fuel: string, since: string) {
  const { data, error } = await db.from("cars").select("id").eq("primary_source", "encar").eq("is_available", true).eq("fuel_type", fuel).is("published_at", null).gte("created_at", since);
  if (error) throw error;
  const ids = (data ?? []).map((row) => row.id);
  if (!ids.length) return 0;
  const { error: updateError } = await db.from("cars").update({ published_at: new Date().toISOString() }).in("id", ids);
  if (updateError) throw updateError;
  return ids.length;
}

async function main() {
  const baseline = await publishedCount();
  let completed = 0;
  let waveNumber = 0;
  while (completed < target) {
    const fuel = fuels[waveNumber % fuels.length];
    const since = new Date().toISOString();
    waveNumber += 1;
    const env = { ...process.env, ENCAR_TARGET: String(wave), ENCAR_MAX_PAGES: "4", ENCAR_FUEL_ONLY: fuel, ENCAR_ONLY_NEW: "true", ENCAR_DRY_RUN: "false", ENCAR_FAST_MODE: "true" };
    const result = await exec("npm", ["run", "import:encar"], { env, maxBuffer: 20 * 1024 * 1024 });
    process.stdout.write(result.stdout);
    const published = await publishWave(fuel, since);
    completed += published;
    console.log(JSON.stringify({ wave: waveNumber, fuel, published, completed, baseline, catalogPublished: baseline + completed, target }));
    if (published === 0) throw new Error(`Wave ${waveNumber} produced no publishable candidates`);
  }
  console.log(JSON.stringify({ status: "complete", completed, baseline, catalogPublished: baseline + completed, target, waves: waveNumber }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
