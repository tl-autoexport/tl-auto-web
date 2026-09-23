import { config } from "dotenv";
import { Client } from "pg";
import { readFile } from "node:fs/promises";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const reportPath = process.env.AI_POWER_REPORT ?? "output/tl-auto-new-encar-ai-research.json";
const write = process.env.AI_PRELIMINARY_REFERENCE_WRITE === "true";
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type AiResult = {
  brand: string;
  model: string;
  year: number;
  engineCc: number;
  fuelType: string;
  estimatedPowerPs: number | null;
  status: string;
  confidence: string;
  exactConfigurationMatch: string;
  listingIds: string[];
};
type Report = { results: AiResult[] };
type Candidate = {
  brand: string; model: string; year: number; engineCc: number; fuelType: string;
  driveType: string; powerPs: number; evidenceNote: string; sourceUrl: string;
};

// Curated allowlist: exact model/year/engine/power tuple, checked against the
// Korean-market listing and a directly accessible manufacturer specification.
const allowlist: Candidate[] = [
  { brand: "Hyundai", model: "Palisade", year: 2025, engineCc: 2497, fuelType: "gasoline", driveType: "2WD", powerPs: 281, evidenceNote: "2025 Korean Palisade gasoline 2.5T, 2,497 cc, 281 PS; Hyundai states 2WD/AWD and 7/9 seats. IDs: 42632515, 42740829, 42747581, 42776166.", sourceUrl: "https://www.hyundai.com/kr/ko/brand/brandstory/heritage/2025-palisade" },
  { brand: "Kia", model: "Morning", year: 2025, engineCc: 998, fuelType: "gasoline", driveType: "2WD", powerPs: 76, evidenceNote: "Kia Korea Morning 1.0 gasoline, 998 cc, 76 PS. Existing listing 42711130 confirms 2025/998 cc/2WD. IDs: 42711130, 42780832, 42783473, 42785695.", sourceUrl: "https://www.kia.com/kr/vehicles/morning/specification" },
  { brand: "Genesis", model: "GV70", year: 2024, engineCc: 3470, fuelType: "gasoline", driveType: "4WD", powerPs: 380, evidenceNote: "Genesis Korea GV70 3.5 T-GDi, 3,470 cc, 380 PS; AWD is an offered drivetrain. IDs: 42633219, 42735751, 42744836.", sourceUrl: "https://www.genesis.com/kr/ko/models/gv70" },
  { brand: "Genesis", model: "GV70", year: 2026, engineCc: 2497, fuelType: "gasoline", driveType: "2WD", powerPs: 304, evidenceNote: "Genesis Korea GV70 2.5 T-GDi, 2,497 cc, 304 PS; 2WD/AWD offered. Scoped to model year 2026. IDs: 42692650, 42725194.", sourceUrl: "https://www.genesis.com/kr/ko/models/gv70" },
  { brand: "BMW", model: "X7", year: 2025, engineCc: 2998, fuelType: "gasoline", driveType: "4WD", powerPs: 381, evidenceNote: "BMW Korea X7 xDrive40i, 2,998 cc gasoline, 381 PS; listing badges identify xDrive40i, 6/7 seats. IDs: 42694611, 42737447.", sourceUrl: "https://www.bmw.co.kr/content/dam/bmw/marketKR/bmw_co_kr/all-models/x-range/x7/THE_NEW_X7_%EC%B9%B4%ED%83%88%EB%A1%9C%EA%B7%B8.pdf.asset.1672739889276.pdf" },
  { brand: "Hyundai", model: "Grandeur", year: 2023, engineCc: 3470, fuelType: "gasoline", driveType: "2WD", powerPs: 300, evidenceNote: "Hyundai Korea GN7 catalogue: 3.5 gasoline, 3,470 cc, 300 PS. Kept separate from the 2021 3.3L listing group. IDs: 42712729, 42721408.", sourceUrl: "https://www.hyundai.com/content/dam/hyundai/kr/ko/data/vehicles/catalog/en/grandeur-catalog-eng.pdf" },
  { brand: "KG_Mobility_Ssangyong", model: "Rexton", year: 2021, engineCc: 2157, fuelType: "diesel", driveType: "4WD", powerPs: 202, evidenceNote: "2021 Rexton 2.2 diesel 4WD, 202 PS; KGM specifications support the 148.6 kW rating and 2021 model sources match the facelift. Provisional pending VIN/type-specific check. IDs: 42706393, 42783353.", sourceUrl: "https://www.kg-mobility.com/attached/contents/display/file/2000001000100120001/20251128102057184_Kcz77H.pdf" },
  { brand: "KG_Mobility_Ssangyong", model: "Tivoli", year: 2024, engineCc: 1497, fuelType: "gasoline", driveType: "2WD", powerPs: 163, evidenceNote: "KGM 2024 Tivoli 1.5 gasoline turbo, 1,497 cc, 163 PS; 2WD offered. IDs: 42652787, 42721489.", sourceUrl: "https://www.kg-mobility.com/attached/contents/display/file/2000001000100070004/20250430145925410_hevHWz.pdf" },
];

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function configKey(candidate: Candidate) {
  return [normalize(candidate.brand), normalize(candidate.model), normalize(candidate.fuelType), candidate.engineCc,
    normalize(candidate.driveType), "", "", `year=${candidate.year}-${candidate.year}`].join("|");
}

async function main() {
  const report = JSON.parse(await readFile(reportPath, "utf8")) as Report;
  const selected = allowlist.map((candidate) => {
    const result = report.results.find((row) => row.status === "preliminary_candidate" &&
      row.brand === candidate.brand && row.model.toLowerCase() === candidate.model.toLowerCase() &&
      row.year === candidate.year && row.engineCc === candidate.engineCc && row.fuelType === candidate.fuelType &&
      row.estimatedPowerPs === candidate.powerPs);
    if (!result) throw new Error(`AI report lacks allowlisted candidate: ${candidate.brand} ${candidate.model} ${candidate.year}`);
    return { candidate, result };
  });

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const keys = selected.map(({ candidate }) => configKey(candidate));
    const existing = await client.query<{ configuration_key: string; status: string }>(
      `select configuration_key,status from public.vehicle_power_automatic_reference where configuration_key=any($1::text[])`, [keys],
    );
    const protectedRows = existing.rows.filter((row) => row.status !== "automatic");
    if (protectedRows.length) throw new Error(`Refusing to alter protected references: ${protectedRows.map((row) => row.configuration_key).join(", ")}`);

    const rows = selected.map(({ candidate, result }) => ({
      configuration_key: configKey(candidate), brand: candidate.brand, model: candidate.model,
      fuel_type: candidate.fuelType, engine_cc: candidate.engineCc, drive_type: candidate.driveType,
      badge: null, badge_detail: null, year_from: candidate.year, year_to: candidate.year,
      power_hp: candidate.powerPs, power_kw: Number((candidate.powerPs * 0.73549875).toFixed(4)),
      source: "ai_web_fallback", status: "automatic",
      note: `${candidate.evidenceNote} Source: ${candidate.sourceUrl} AI confidence=${result.confidence}; configuration_match=${result.exactConfigurationMatch}. Not approved TKS evidence; preliminary only.`,
    }));

    console.log(JSON.stringify({ write, reportPath, candidateConfigurations: rows,
      listingCount: selected.reduce((sum, item) => sum + item.result.listingIds.length, 0),
      existingExactKeys: existing.rows.length, carsChanged: 0, pricesRecalculated: 0, publicationChanged: false }, null, 2));
    if (!write) return;

    await client.query("begin");
    await client.query(
      `insert into public.vehicle_power_automatic_reference
        (configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,year_from,year_to,power_hp,power_kw,source,status,note,updated_at)
       select x.configuration_key,x.brand,x.model,x.fuel_type,x.engine_cc,x.drive_type,x.badge,x.badge_detail,
              x.year_from,x.year_to,x.power_hp,x.power_kw,x.source,x.status,x.note,now()
         from jsonb_to_recordset($1::jsonb) as x(
           configuration_key text,brand text,model text,fuel_type text,engine_cc integer,drive_type text,
           badge text,badge_detail text,year_from integer,year_to integer,power_hp numeric,power_kw numeric,
           source text,status text,note text)
       on conflict (configuration_key) do update set year_from=excluded.year_from,year_to=excluded.year_to,
         power_hp=excluded.power_hp,power_kw=excluded.power_kw,source=excluded.source,note=excluded.note,updated_at=now()
       where vehicle_power_automatic_reference.status='automatic'`, [JSON.stringify(rows)],
    );
    await client.query("commit");
    console.log(JSON.stringify({ applied: rows.length, referenceOnly: true, carsChanged: 0, pricesRecalculated: 0, published: 0 }));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
