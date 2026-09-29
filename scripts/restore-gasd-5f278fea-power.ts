/** Restore source-backed preliminary ICE power for the exact Encar listings in run 5f278fea. */
import { config } from "dotenv";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { resolveAutomaticPowerReference, type AutomaticPowerReferenceRow } from "../src/server/catalog/automatic-power-reference";

config({ path: ".env.local", quiet: true });
const runId = "5f278fea-f4dc-417d-b0fa-c05983854516";
const planPath = "output/tl-auto-gasd-5f278fea-power-plan-after-4refs.json";
const skippedPath = "output/tl-auto-new-encar-preliminary-calculation-dry-run.json";
const write = process.env.RESTORE_GASD_POWER_WRITE === "true";

// Only rows for which a source and the exact trim were recovered. These are
// preliminary catalog powers, never approved customs-document evidence.
const evidence: Record<string, { hp: number; url: string; detail: string }> = {
  "42373173": { hp: 381, url: "https://www.press.bmwgroup.com/korea/article/detail/T0407081KO/bmw-%EC%BD%94%EB%A6%AC%EC%95%84-%ED%95%9C%EC%B8%B5-%EC%A7%84%EB%B3%B4%ED%95%9C-%ED%94%8C%EB%9E%98%EA%B7%B8%EC%8B%AD-sav-%EB%89%B4-x7%E2%80%99-%EA%B5%AD%EB%82%B4-%EA%B3%B5%EC%8B%9D-%EC%B6%9C%EC%8B%9C", detail: "facelift G07 X7 xDrive40i M Sport" },
  "42407238": { hp: 245, url: "https://www.volkswagen.co.kr/ko/promotion_news/news/new-2025/2025-06-09.html", detail: "Korean 2.0 Golf GTI; 2025 Korean version, check 2026 variant before final use" },
  "42473339": { hp: 317, url: "https://www.mini.co.kr/ko_KR/home/range/mini-countryman/driving-experience.html", detail: "John Cooper Works Countryman ALL4" },
  "42437367": { hp: 249, url: "https://www.landrover.com/content/dam/lrdx/pdfs/xi/wltp/Land-Rover-Defender-TD-Insert-1L6632500000XIEN01P.pdf", detail: "L663 Defender 110 D250, 2997 cc" },
  "42401962": { hp: 639, url: "https://media.mercedes-benz.com/article/92826ed7-8db9-4b92-a9ba-ea3de4138304", detail: "AMG GT 63 S 4MATIC+ 4-door" },
  "42417685": { hp: 421, url: "https://media.mercedes-benz.com/article/e4a6838a-6414-46e8-8700-8e43f2c8ae5c", detail: "AMG GLC 43 4MATIC; ICE power only" },
  "42476444": { hp: 421, url: "https://media.mercedes-benz.com/article/e4a6838a-6414-46e8-8700-8e43f2c8ae5c", detail: "AMG GLC 43 4MATIC; ICE power only" },
  "42694752": { hp: 421, url: "https://media.mercedes-benz.com/article/e4a6838a-6414-46e8-8700-8e43f2c8ae5c", detail: "AMG GLC 43 4MATIC Coupe; ICE power only" },
  "42444673": { hp: 340, url: "https://www.drom.ru/catalog/audi/q7/2021/", detail: "Korean Q7 55 TFSI quattro" },
  "42562684": { hp: 367, url: "https://media.mercedes-benz.com/article/ae9b86bc-d5b3-4cf6-a70a-d906e0ec6f63", detail: "CLS 450 4MATIC" },
  "42599613": { hp: 367, url: "https://media.mercedes-benz.com/article/ae9b86bc-d5b3-4cf6-a70a-d906e0ec6f63", detail: "CLS 450 4MATIC Designo" },
  "42778093": { hp: 367, url: "https://media.mercedes-benz.com/article/ae9b86bc-d5b3-4cf6-a70a-d906e0ec6f63", detail: "CLS 450 4MATIC" },
  "42563753": { hp: 503, url: "https://media.mercedes-benz.com/article/ca347c90-5815-4720-a61d-e1961a0315c6", detail: "S 580 L 4MATIC; ICE power only" },
  "42657974": { hp: 550, url: "https://finder.porsche.com/de/de-DE/details/8OELP3", detail: "Cayenne Turbo 4.0, 3996 cc; earlier 2023 version" },
  "42673751": { hp: 194, url: "https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/en_brochure/en_catalog_sorento.pdf", detail: "Korean Sorento 2.2 diesel, 2151 cc" },
  "42542169": { hp: 340, url: "https://www.press.bmwgroup.com/korea/article/detail/T0297769KO/bmw-%ED%94%8C%EB%9E%98%EA%B7%B8%EC%8B%AD-%EB%9F%AD%EC%85%94%EB%A6%AC-%EC%84%B8%EB%8B%A8-%EB%89%B4-7%EC%8B%9C%EB%A6%AC%EC%A6%88-%EA%B5%AD%EB%82%B4-%EC%B6%9C%EC%8B%9C", detail: "G11 740Li xDrive" },
  "42674301": { hp: 503, url: "https://media.mercedes-benz.com/article/953034d5-7230-4bfd-b04c-4c39cd87ac32", detail: "Maybach S 580 4MATIC; ICE power only" },
  "42575936": { hp: 367, url: "https://media.mercedes-benz.com/article/93c20e80-eb1c-4a76-9486-35da7121e88f", detail: "S 450 4MATIC; ICE power only" },
  "42656474": { hp: 390, url: "https://media.mercedes-benz.com/article/a76ba5b6-7cbf-4cf5-8fc6-f610aceaecd1", detail: "AMG C 43 4MATIC Coupe W205" },
  "42710717": { hp: 258, url: "https://www.press.bmwgroup.com/korea/article/detail/T0437677KO/bmw-%EC%BD%94%EB%A6%AC%EC%95%84-%EC%B0%A8%EC%84%B8%EB%8C%80-%ED%94%84%EB%A6%AC%EB%AF%B8%EC%97%84-%EC%84%B8%EB%8B%A8-%E2%80%98%EB%89%B4-5%EC%8B%9C%EB%A6%AC%EC%A6%88%E2%80%99-%EC%A0%84-%EC%84%B8%EA%B3%84-%EC%B5%9C%EC%B4%88%EB%A1%9C-%EA%B5%AD%EB%82%B4-%EC%B6%9C%EC%8B%9C", detail: "G60 530i xDrive" },
  "42760884": { hp: 340, url: "https://www.press.bmwgroup.com/global/article/attachment/T0305409EN/445922", detail: "G06 X6 xDrive40d, ICE 340 PS; electric boost separate" },
  "42669834": { hp: 381, url: "https://media.mercedes-benz.com/press-kit/0eb92a2b-c8bf-44c7-8297-6a5195a8f7ac/article/41ae02c9-5ed4-4990-a2e4-a0371f54434f", detail: "W214 E 450 4MATIC ICE 381 PS" },
  "42680825": { hp: 449, url: "https://media.mercedes-benz.com/article/32cdd73f-bd34-446c-ab21-3d8860b91b7b", detail: "CLE 53 4MATIC+ Cabriolet; Encar normalized model E-Class, exact badge used" },
  "42772070": { hp: 450, url: "https://newsroom.porsche.com/de/produkte/porsche-911-neu-achte-generation-992-timeless-machine-weltpremiere-los-angeles-2018-news-tv-live-16472.html", detail: "992 Carrera 4S 2,981 cc" },
  "42766471": { hp: 387, url: "https://www.press.bmwgroup.com/korea/article/detail/T0354632KO/bmw-%EC%BD%94%EB%A6%AC%EC%95%84-%EB%89%B4-x3-%EB%B0%8F-%EB%89%B4-x4-%EA%B5%AD%EB%82%B4-%EA%B3%B5%EC%8B%9D-%EC%B6%9C%EC%8B%9C", detail: "G01 X3 M40i" },
  "42579069": { hp: 300, url: "https://auto.danawa.com/auto/?Lineup=48601&Model=3799&Tab=spec&Work=model", detail: "XC90 B6; catalog power, provisional" },
  "42399391": { hp: 250, url: "https://www.volvocars.com/files/cs/v3/assets/blt84e01a6904dbd2e8/blt551a9b36f6ca7543/66d67ac927beb592440ec411/s90-specifications.pdf?branch=prod_alias", detail: "S90 B5 Inscription" },
  "42691055": { hp: 250, url: "https://www.volvocars.com/files/cs/v3/assets/blt84e01a6904dbd2e8/blt551a9b36f6ca7543/66d67ac927beb592440ec411/s90-specifications.pdf?branch=prod_alias", detail: "S90 B5 Inscription" },
  "42674999": { hp: 170, url: "https://www.hyundai.com/kr/ko/c/products/bus/solati", detail: "Solati 2.5 diesel" },
  "42767982": { hp: 370, url: "https://www.drom.ru/catalog/kia/k9/2024/", detail: "K9 3.3 T-GDI AWD" },
  "42610397": { hp: 190, url: "https://m.kbchachacha.com/public/web/car/detail.kbc?carSeq=27122073", detail: "GLA 220 H247" },
  "42637374": { hp: 300, url: "https://web.getcha.kr/cars/%EB%9E%9C%EB%93%9C%EB%A1%9C%EB%B2%84/Defender?gradeId=18119&id=908", detail: "Defender 110 P300" },
};

type Candidate = { sourceListingId: string; configuration: { brand: string; model: string; fuelType: string; engineCc: number; driveType: string | null; badge: string | null; trim: string | null; year: number } };
function input(c: Candidate): Parameters<typeof resolveAutomaticPowerReference>[0] {
  const x = c.configuration;
  return { brand: x.brand, model: x.model, fuel_type: x.fuelType, engine_cc: x.engineCc, drive_type: x.driveType,
    badge: x.badge, badge_detail: x.trim, year: x.year };
}
function key(c: Candidate) {
  const x = c.configuration;
  const norm = (v: string | null) => (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return [norm(x.brand), norm(x.model), norm(x.fuelType), x.engineCc, norm(x.driveType), norm(x.badge), norm(x.trim), `year=${x.year}-${x.year}`, `encar=${c.sourceListingId}`].join("|");
}

async function main() {
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  const old = JSON.parse(await readFile(skippedPath, "utf8"));
  if (plan.runId !== runId || old.runId !== runId || old.skipped.length !== 64) throw new Error("Cohort mismatch");
  const skipped = new Set(old.skipped.map((x: { sourceListingId: string }) => String(x.sourceListingId)));
  const candidates = (plan.candidates as Candidate[]).filter((x) => skipped.has(String(x.sourceListingId)));
  if (candidates.length !== 64 || Object.keys(evidence).some((id) => !skipped.has(id))) throw new Error("Candidate IDs mismatch");
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error("SUPABASE_DB_URL required");
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin");
    const loaded = await db.query<AutomaticPowerReferenceRow>(`select configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,year_from,year_to,power_hp::double precision as power_hp,power_kw::double precision as power_kw,source,status from public.vehicle_power_automatic_reference where status <> 'retired'`);
    const existing = loaded.rows;
    const proposals = candidates.filter((c) => evidence[c.sourceListingId]).map((c) => {
      const x = c.configuration, e = evidence[c.sourceListingId];
      return { configuration_key: key(c), brand: x.brand, model: x.model, fuel_type: x.fuelType, engine_cc: x.engineCc,
        drive_type: x.driveType, badge: x.badge, badge_detail: x.trim, year_from: x.year, year_to: x.year,
        power_hp: e.hp, power_kw: Number((e.hp * 0.73549875).toFixed(4)), source: "manual_web_research", status: "automatic" as const,
        note: `Предварительная мощность, не подтверждение ТКС/ОТТС. Run ${runId}; Encar ${c.sourceListingId}; ${e.detail}; ${e.url}` };
    });
    const conflicts = proposals.filter((r) => existing.some((v) => v.configuration_key === r.configuration_key && Number(v.power_hp) !== r.power_hp));
    if (conflicts.length) throw new Error(`Existing key conflict: ${JSON.stringify(conflicts.map((x) => x.configuration_key))}`);
    const pending = proposals.filter((r) => !existing.some((v) => v.configuration_key === r.configuration_key));
    const combined = [...existing, ...pending];
    const bad = proposals.filter((r) => {
      const candidate = candidates.find((c) => key(c) === r.configuration_key)!;
      return resolveAutomaticPowerReference(input(candidate), combined)?.power_hp !== r.power_hp;
    });
    if (bad.length) throw new Error(`Resolver conflicts: ${JSON.stringify(bad.map((x) => x.configuration_key))}`);
    const before = candidates.filter((c) => resolveAutomaticPowerReference(input(c), existing) != null);
    const after = candidates.filter((c) => resolveAutomaticPowerReference(input(c), combined) != null);
    const summary = { write, oldSkipped: 64, alreadyResolved: before.length, evidenceRows: proposals.length,
      newReferences: pending.length, resolvedAfter: after.length, stillUnresolved: 64 - after.length,
      remainingIds: candidates.filter((c) => !after.includes(c)).map((c) => c.sourceListingId) };
    console.log(JSON.stringify(summary, null, 2));
    if (write && pending.length) {
      await db.query(`insert into public.vehicle_power_automatic_reference
        (configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,year_from,year_to,power_hp,power_kw,source,status,note)
        select x.configuration_key,x.brand,x.model,x.fuel_type,x.engine_cc,x.drive_type,x.badge,x.badge_detail,x.year_from,x.year_to,x.power_hp,x.power_kw,x.source,x.status,x.note
        from jsonb_to_recordset($1::jsonb) as x(configuration_key text,brand text,model text,fuel_type text,engine_cc integer,drive_type text,badge text,badge_detail text,year_from integer,year_to integer,power_hp numeric,power_kw numeric,source text,status text,note text)`, [JSON.stringify(pending)]);
      const verify = await db.query(`select configuration_key,power_hp::double precision as power_hp from public.vehicle_power_automatic_reference where configuration_key=any($1::text[])`, [pending.map((x) => x.configuration_key)]);
      if (verify.rows.length !== pending.length || verify.rows.some((v) => pending.find((p) => p.configuration_key === v.configuration_key)?.power_hp !== v.power_hp)) throw new Error("Post-write verification failed");
      await db.query("commit");
    } else await db.query("rollback");
  } catch (error) { await db.query("rollback"); throw error; }
  finally { await db.end(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
