import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { writeFile } from "node:fs/promises";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("TL Auto Supabase admin variables are required");

const groups: Record<string, string[]> = {
  Hyundai: ["Avante", "Sonata", "Venue", "Casper", "Veloster", "Tucson", "Kona", "Staria"],
  Kia: ["Seltos", "K5", "K3", "Niro", "Morning", "Ray", "Sportage", "Sorento", "Mohave", "Carnival"],
  Chevrolet: ["Trailblazer", "Malibu", "Equinox", "Trax", "Spark"],
  "Mercedes-Benz": ["GLB-Class", "C-Class", "A-Class"],
  Volkswagen: ["Jetta", "Tiguan", "Golf"],
  BMW: ["X1", "X2", "1-Series", "2-Series"],
  Audi: ["Q2", "Q3", "A4", "A3"],
  MINI: ["Cooper", "Clubman", "Countryman"],
  "Land Rover": ["Discovery", "Range Rover Evoque", "Discovery Sport"],
  KGM: ["KORANDO", "TIBOLI"],
  "Renault Korea": ["SM6", "QM6", "XM3", "Captur"],
};

const aliases: Record<string, string> = {
  canival: "Carnival", santafe: "Santa Fe", ray: "Ray", morning: "Morning",
  tiboli: "Tivoli", "x2 (f39)": "X2", "range rover evoque": "Range Rover Evoque",
  "discovery sport": "Discovery Sport", "1-series": "1 Series", "2-series": "2 Series",
};
const normalize = (value: string | null) => (value ?? "").toLowerCase().replace(/[\s_-]+/g, "");

async function main() {
  const db = createClient(url!, key!, { auth: { persistSession: false } });
  const rows: Array<{ manufacturer: string | null; model: string | null; model_year: number | null; engine_cc: number | null; fuel_type: string | null; drive_type: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("chestny_catalog_staging").select("manufacturer,model,model_year,engine_cc,fuel_type,drive_type").range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const report = Object.entries(groups).flatMap(([manufacturer, models]) => models.map((requestedModel) => {
    const matches = rows.filter((row) => {
      if (row.manufacturer !== manufacturer) return false;
      const model = normalize(row.model);
      const wanted = normalize(requestedModel);
      return model === wanted || aliases[model] === requestedModel || model.includes(wanted) || wanted.includes(model);
    });
    const configurations = new Map<string, number>();
    for (const row of matches) {
      const key = [row.model, row.model_year, row.engine_cc, row.fuel_type, row.drive_type].join(" | ");
      configurations.set(key, (configurations.get(key) ?? 0) + 1);
    }
    return { manufacturer, requestedModel, sourceCount: matches.length, configurations: [...configurations.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([configuration, count]) => ({ configuration, count })) };
  }));
  const output = { generatedAt: new Date().toISOString(), stagingRows: rows.length, groups: report, note: "Inventory only. Power and <=160 hp eligibility are resolved separately and no rows are published by this audit." };
  await writeFile("docs/chestny-required-models-audit.json", JSON.stringify(output, null, 2) + "\n");
  console.log(JSON.stringify({ stagingRows: rows.length, requestedGroups: report.length, foundGroups: report.filter((r) => r.sourceCount > 0).length, missingGroups: report.filter((r) => r.sourceCount === 0).map((r) => `${r.manufacturer} ${r.requestedModel}`), output: "docs/chestny-required-models-audit.json" }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
