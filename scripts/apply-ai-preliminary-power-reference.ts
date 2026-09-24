import { config } from "dotenv";
import { Client } from "pg";
import { readFile } from "node:fs/promises";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const reportPath = process.env.AI_POWER_REPORT ?? "output/tl-auto-new-encar-ai-research.json";
const reportPaths = (process.env.AI_POWER_REPORTS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
// Dataset-specific exceptions needing configuration review: do not turn the AI's
// tentative number into a fallback while the source/model identity is disputed.
const manualReviewListingIds = new Set(["42665681", "42636870", "42636891"]);
const excludedListingIds = new Set([
  ...manualReviewListingIds,
  ...(process.env.AI_POWER_REPORT_EXCLUDE_LISTING_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
]);
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
  generation?: string | null;
  driveType?: string | null;
  badgeExamples?: string[];
  geminiCandidatePowerPs?: number | null;
  deepSeekCandidatePowerPs?: number | null;
  rationale?: string;
  conflicts?: string[];
  sources?: Array<{ url: string; title?: string; finding?: string; source_type?: string }>;
};
type Report = { results: AiResult[] };
type Candidate = {
  brand: string; model: string; year: number; engineCc: number; fuelType: string;
  driveType?: string | null; badge?: string | null; badgeDetail?: string | null;
  powerPs: number; expectedAiPowerPs?: number; evidenceNote: string; sourceUrl: string;
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
  { brand: "Volkswagen", model: "Golf", year: 2025, engineCc: 1984, fuelType: "gasoline", badge: "2.0 gti", powerPs: 245, evidenceNote: "2025 Korean-market Golf GTI, 1,984 cc, 245 PS. Volkswagen Korea press release and price/spec PDF explicitly state 245 PS. Preliminary AI fallback reference; listing IDs: 42739878, 42770930.", sourceUrl: "https://www.volkswagen.co.kr/ko/promotion_news/news/new-2025/2025-06-09.html" },
  { brand: "Jeep", model: "Compass", year: 2022, engineCc: 2360, fuelType: "gasoline", driveType: "4WD", badge: "2.4 limitied awd", powerPs: 175, evidenceNote: "Preliminary estimate for 2022 Compass 2.4 Limited AWD. Jeep Korea documents specify 175 PS for the Korean 2.4L/2,360 cc gasoline engine; the detailed power table is from an earlier Korean model-year document, so retain as preliminary, not confirmed year-specific evidence. Listing ID: 42633201.", sourceUrl: "https://www.jeep.co.kr/jeep_life/news_media/posts/post_180717.html" },
  { brand: "Jeep", model: "Renegade", year: 2021, engineCc: 2360, fuelType: "gasoline", badge: "2.4 limited", powerPs: 175, expectedAiPowerPs: 182, evidenceNote: "Use Korean-market 175 PS specification for the 2.4L/2,360 cc Renegade, not AI's 182 PS conversion from a global 180 SAE hp figure. Korean-market specification is model-year-adjacent, so this remains preliminary. Listing ID: 42670901.", sourceUrl: "https://www.jeep.co.kr/jeep_life/news_media1/posts/post_190826.html" },
  { brand: "Kia", model: "K9", year: 2022, engineCc: 3778, fuelType: "gasoline", driveType: "4WD", badge: "3.8 gdi awd", powerPs: 315, evidenceNote: "Kia Korea 2022 K9 3.8 gasoline, 3,778 cc, 315 PS; official catalogue gives this output. AWD configuration is present in the listing; retained as preliminary AI-fallback reference. Listing ID: 42761176.", sourceUrl: "https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/catalog/catalog_the_new_k9.pdf" },
  { brand: "Kia", model: "Sorento", year: 2025, engineCc: 2151, fuelType: "diesel", driveType: "2WD", badge: "diesel 2.2 2wd", powerPs: 194, evidenceNote: "Kia Korea Sorento 2.2 diesel, 2,151 cc, 194 PS; official catalogue specifies 194 PS and availability of 2WD. Listing ID: 42725909. Preliminary reference pending exact VIN/trim verification.", sourceUrl: "https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/catalog/catalog_sorento.pdf" },
  { brand: "Lincoln", model: "Corsair", year: 2021, engineCc: 1999, fuelType: "gasoline", driveType: "4WD", badge: "2.0 reserve awd", powerPs: 253, expectedAiPowerPs: 252.89, evidenceNote: "2021 Corsair 2.0L Reserve AWD preliminary estimate. Lincoln technical specifications report 250 SAE hp; converted approximately to 253 metric PS. This is not Korean-market homologation evidence, so keep preliminary. Listing ID: 42644936.", sourceUrl: "https://media.lincoln.com/content/dam/lincolnmedia/lna/us/product/2021/corsair/21MY_Corsair_Tech_Specs.pdf" },
  { brand: "Mercedes-Benz", model: "E-Class", year: 2023, engineCc: 1999, fuelType: "gasoline", driveType: "4WD", badge: "e350 4matic amg line", powerPs: 299, evidenceNote: "Preliminary estimate for Korean-market 2023 E350 4MATIC, 1,999 cc. AI web review returned 299 PS/exact identity, but available sources are secondary pages rather than an official configuration-specific Mercedes document; do not present as confirmed. Listing ID: 42703593.", sourceUrl: "https://semocha.co.kr/entry/2023%EB%85%84-%EB%B2%A4%EC%B8%A0-E%ED%81%B4%EB%9E%98%EC%8A%A4-E350-4MATIC-%EC%A0%95%EB%B3%B4-%EB%B0%8F-%EC%9E%A5%EB%8B%A8%EC%A0%90" },
  { brand: "Volvo", model: "XC90", year: 2021, engineCc: 1969, fuelType: "gasoline", badge: "b5 momentum", powerPs: 250, evidenceNote: "Volvo Korea Support 2021 engine table lists B5 AWD B420T2 at 184 kW/250 hp and B420T10 at 183 kW/249 hp. Listing badge B5 Momentum does not identify engine code/drivetrain, so 250 PS is a preliminary estimate with a one-PS variant uncertainty. Listing ID: 42751796.", sourceUrl: "https://www.volvocars.com/kr/support/car/xc90/21w46/article/b0804d54c7fc096bc0a81f6f065ad63e_8899be1dc7fc78b1c0a81f6f5a01b4ab_9421c969d4d00565c0a801517cea224d/" },
];

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function configKey(candidate: Candidate) {
  return [normalize(candidate.brand), normalize(candidate.model), normalize(candidate.fuelType), candidate.engineCc,
    normalize(candidate.driveType), normalize(candidate.badge), normalize(candidate.badgeDetail), `year=${candidate.year}-${candidate.year}`].join("|");
}

async function main() {
  const report = JSON.parse(await readFile(reportPath, "utf8")) as Report;
  const selected = allowlist.flatMap((candidate) => {
    const result = report.results.find((row) => row.status === "preliminary_candidate" &&
      row.brand === candidate.brand && row.model.toLowerCase() === candidate.model.toLowerCase() &&
      row.year === candidate.year && row.engineCc === candidate.engineCc && row.fuelType === candidate.fuelType &&
      row.estimatedPowerPs === (candidate.expectedAiPowerPs ?? candidate.powerPs));
    return result ? [{ candidate, result }] : [];
  });
  const reportSelected: Array<{ candidate: Candidate; result: AiResult }> = [];
  for (const path of reportPaths) {
    const researchReport = JSON.parse(await readFile(path, "utf8")) as Report;
    for (const result of researchReport.results) {
      if (result.status !== "preliminary_candidate" || !result.estimatedPowerPs ||
          !["high", "medium"].includes(result.confidence) ||
          !["exact", "close"].includes(result.exactConfigurationMatch) ||
          !result.brand || !result.model || !result.year || !result.engineCc || !result.fuelType ||
          !Array.isArray(result.listingIds) || !result.listingIds.length ||
          result.listingIds.some((id) => excludedListingIds.has(id))) continue;
      // Both providers must agree on the number before it can become even a preliminary reference.
      if (result.geminiCandidatePowerPs !== result.estimatedPowerPs ||
          result.deepSeekCandidatePowerPs !== result.estimatedPowerPs) continue;
      const source = result.sources?.find((item) => /^https?:\/\//i.test(item.url));
      if (!source) continue;
      const badges = [...new Set((result.badgeExamples ?? []).map((badge) => badge.trim()).filter(Boolean))];
      const candidateBadges: Array<string | null> = badges.length ? badges : [null];
      for (const badge of candidateBadges) {
        reportSelected.push({
          candidate: {
            brand: result.brand, model: result.model, year: result.year, engineCc: result.engineCc,
            fuelType: result.fuelType, driveType: result.driveType, badge, powerPs: result.estimatedPowerPs,
            evidenceNote: `AI/web fallback preliminary estimate. Confidence=${result.confidence}; match=${result.exactConfigurationMatch}. ` +
              `Gemini=${result.geminiCandidatePowerPs} PS; DeepSeek=${result.deepSeekCandidatePowerPs} PS. ` +
              `Rationale: ${result.rationale ?? "not supplied"} ` +
              `Conflicts: ${(result.conflicts ?? []).join(" | ") || "none reported"}. Listings: ${result.listingIds.join(", ")}.`,
            sourceUrl: source.url,
          },
          result,
        });
      }
    }
  }
  const selectedAll = [...selected, ...reportSelected];
  if (!selectedAll.length) throw new Error("No matching allowlisted or validated report-based preliminary candidates");
  const skippedAllowlistCandidates = allowlist.length - selected.length;

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const keys = selectedAll.map(({ candidate }) => configKey(candidate));
    const existing = await client.query<{ configuration_key: string; status: string }>(
      `select configuration_key,status from public.vehicle_power_automatic_reference where configuration_key=any($1::text[])`, [keys],
    );
    const protectedRows = existing.rows.filter((row) => row.status !== "automatic");
    if (protectedRows.length) throw new Error(`Refusing to alter protected references: ${protectedRows.map((row) => row.configuration_key).join(", ")}`);

    const rows = selectedAll.map(({ candidate, result }) => ({
      configuration_key: configKey(candidate), brand: candidate.brand, model: candidate.model,
      fuel_type: candidate.fuelType, engine_cc: candidate.engineCc, drive_type: candidate.driveType ?? null,
      badge: candidate.badge ?? null, badge_detail: candidate.badgeDetail ?? null, year_from: candidate.year, year_to: candidate.year,
      power_hp: candidate.powerPs, power_kw: Number((candidate.powerPs * 0.73549875).toFixed(4)),
      source: "ai_web_fallback", status: "automatic",
      note: `${candidate.evidenceNote} Reference: ${candidate.sourceUrl} AI confidence=${result.confidence}; configuration_match=${result.exactConfigurationMatch}. AI supporting URLs: ${(result.sources ?? []).map((source) => source.url).join(" ; ")}. Not approved TKS evidence; preliminary only.`,
    }));

    const listingCount = new Set(selectedAll.flatMap((item) => item.result.listingIds)).size;
    console.log(JSON.stringify({ write, reportPath, reportPaths, skippedAllowlistCandidates,
      excludedListingIds: [...excludedListingIds], candidateConfigurations: rows.map((row) => ({
        configuration_key: row.configuration_key, power_hp: row.power_hp, status: row.status,
        brand: row.brand, model: row.model, year_from: row.year_from, engine_cc: row.engine_cc,
        drive_type: row.drive_type, badge: row.badge,
      })),
      listingCount, duplicateConfigurationKeys: keys.length - new Set(keys).size,
      existingExactKeys: existing.rows.length, carsChanged: 0, pricesRecalculated: 0, publicationChanged: false }, null, 2));
    if (keys.length !== new Set(keys).size) throw new Error("Duplicate configuration keys in candidate batch; refusing write");
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
