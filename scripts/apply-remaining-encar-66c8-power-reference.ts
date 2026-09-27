/** Provisional power for the 21 remaining listings of Encar run 66c8b38e.
 * Read-only by default. Writes only vehicle_power_automatic_reference when
 * REMAINING_ENCAR_POWER_WRITE=true; never touches cars or prices.
 */
import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import { Client } from "pg";
import { resolveAutomaticPowerReference, type AutomaticPowerReferenceRow } from "../src/server/catalog/automatic-power-reference";
import { canonicalBadge } from "../src/server/power-resolution/canonical";
import { normalizeModel } from "../src/server/normalization/vehicles";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const runId = "66c8b38e-1147-4f23-8735-6ebdd5bec4aa";
const planPath = "output/tl-auto-new-encar-power-plan-66c8b38e.json";
const write = process.env.REMAINING_ENCAR_POWER_WRITE === "true";

// Every ID has been checked against the Encar staging payload. These are
// engine PS, not an engine+48V-motor sum. The two formerly disputed cases are
// Ranger Raptor (not Wildtrak) and CLS 300d (not S-Class).
const evidence: Record<string, { ps: number; url: string; note?: string }> = {};
function add(ids: string[], ps: number, url: string, note?: string) {
  for (const id of ids) {
    if (evidence[id]) throw new Error(`Duplicate listing ID ${id}`);
    evidence[id] = { ps, url, note };
  }
}
const gle = "https://www.mercedes-benz.co.kr/passengercars/brand/news-events/news-story/2023/news-20230828.html";
add(["42397966", "42565533", "42590582", "42752324", "42785221", "42393681"], 367, gle);
add(["42403562", "42410012", "42664201"], 381, gle);
add(["42763978"], 435, gle);
add(["42414260", "42463382", "42747179"], 300,
  "https://www.landrover.com/content/dam/lrdx/pdfs/xi/wltp/Land-Rover-Defender-TD-Insert-1L6632500000XIEN01P.pdf");
add(["42569373"], 367, "https://www.mercedes-benz.co.kr/passengercars/brand/news-events/news-story/2023/news-20231120.html");
add(["42658280"], 550, "https://media.astonmartin.com/aston-martin-unveils-dbx-an-suv-with-the-soul-of-a-sports-car-3/?lang=eng");
add(["42789072"], 387, "https://www.press.bmwgroup.com/korea/article/detail/T0410954KO/bmw-%EC%BD%94%EB%A6%AC%EC%95%84-%ED%95%9C%EC%B8%B5-%EC%A7%84%EB%B3%B4%ED%95%9C-%EC%A0%95%ED%86%B5-%EB%A1%9C%EB%93%9C%EC%8A%A4%ED%84%B0-%EB%89%B4-z4%E2%80%99-%EA%B5%AD%EB%82%B4-%EA%B3%B5%EC%8B%9D-%EC%B6%9C%EC%8B%9C");
add(["42420617"], 405, "https://www.lotuscars.co.kr/EMIRA_discover");
add(["42582976"], 258, "https://www.mercedes-benz.co.kr/passengercars/brand/news-events/news-story/2023/news-20230608.html",
  "Encar reports rounded 2000 cc; manufacturer lists 1999 cc for GLC 300 4MATIC.");
add(["42617042"], 350, "https://www.porsche.com/usa/aboutporsche/pressreleases/pag/?id=385103&pool=international-de");
add(["42573510"], 210, "https://media.ford.com/content/fordmedia/feu/de/de/news/2023/03/24/der-spektakulaere-ranger-raptor-jetzt-auch-mit-154-kw--210-ps--s.html",
  "Encar gradeDetail is Raptor. 210 PS is the 2023 2.0 diesel Raptor, not 205 PS Wildtrak. Market variation remains provisional.");
add(["42753381"], 265, "https://media.mercedes-benz.com/article/ae9b86bc-d5b3-4cf6-a70a-d906e0ec6f63",
  "Encar modelGroup is CLS-Class (C257), not S-Class. Engine output excludes the separate 15 kW ISG boost.");

type Candidate = { sourceListingId: string; status: string; configuration: Record<string, unknown> };
type Ref = AutomaticPowerReferenceRow & { note: string };
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
  const plan = JSON.parse(await readFile(planPath, "utf8")) as { runId: string; candidates: Candidate[] };
  if (plan.runId !== runId || Object.keys(evidence).length !== 21) throw new Error("Unexpected plan or evidence count");
  const selected = plan.candidates.filter((c) => evidence[c.sourceListingId]);
  if (selected.length !== 21 || selected.some((c) => c.status !== "unmatched")) throw new Error("Plan changed; refusing write");
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin");
    const staged = await db.query<{ source_listing_id: string; raw_payload: Record<string, unknown> }>(
      `select source_listing_id,raw_payload from public.encar_enrichment_staging
       where run_id=$1 and source_listing_id=any($2::text[])`, [runId, Object.keys(evidence)]);
    if (staged.rows.length !== 21) throw new Error(`Expected 21 staged rows, got ${staged.rows.length}`);
    const byId = new Map(staged.rows.map((r) => [r.source_listing_id, r]));
    const rowsByKey = new Map<string, Ref & { listingIds: string[] }>();
    for (const candidate of selected) {
      const id = candidate.sourceListingId;
      const detail = (byId.get(id)?.raw_payload?.detail ?? {}) as Record<string, unknown>;
      const category = (detail.category ?? {}) as Record<string, unknown>;
      const spec = (detail.spec ?? {}) as Record<string, unknown>;
      const conf = candidate.configuration;
      const sourceModel = normalizeModel(category.modelGroupEnglishName);
      const planModel = String(conf.model ?? "");
      if (id !== "42753381" && sourceModel !== planModel) throw new Error(`Model mismatch for ${id}`);
      if (id === "42753381" && (sourceModel !== "CLS" || planModel !== "S-Class")) throw new Error("CLS correction no longer applicable");
      const model = id === "42753381" ? "CLS" : planModel;
      const year = Number(conf.year);
      const cc = Number(conf.engineCc);
      if (Number(category.formYear) !== year || Number(spec.displacement) !== cc ||
          canonicalBadge(category.gradeEnglishName) !== canonicalBadge(conf.badge) ||
          (id === "42573510" && norm(category.gradeDetailEnglishName) !== "raptor")) {
        throw new Error(`Source snapshot differs for ${id}`);
      }
      const brand = String(conf.brand);
      const fuel = String(conf.fuelType);
      const drive = conf.driveType == null ? null : String(conf.driveType);
      const badge = conf.badge == null ? null : String(conf.badge);
      const badgeDetail = conf.trim == null ? null : String(conf.trim);
      const key = [norm(brand), norm(model), norm(fuel), cc, norm(drive), norm(badge), norm(badgeDetail), `year=${year}-${year}`].join("|");
      const item = evidence[id];
      const prior = rowsByKey.get(key);
      if (prior) {
        if (prior.power_hp !== item.ps || !prior.note.includes(item.url)) throw new Error(`Conflicting evidence for ${key}`);
        prior.listingIds.push(id);
        continue;
      }
      rowsByKey.set(key, {
        configuration_key: key, brand, model, fuel_type: fuel, engine_cc: cc, drive_type: drive,
        badge, badge_detail: badgeDetail, year_from: year, year_to: year,
        power_hp: item.ps, power_kw: Number((item.ps * 0.73549875).toFixed(4)),
        source: "manufacturer_preliminary", status: "automatic",
        note: `Предварительная мощность по сопоставленной версии; не утверждённая спецификация TKS. ${item.note ?? ""} Источник: ${item.url}`,
        listingIds: [id],
      });
    }
    const rows = [...rowsByKey.values()];
    const ids = rows.flatMap((r) => r.listingIds);
    if (ids.length !== 21 || new Set(ids).size !== 21) throw new Error("Coverage is not exactly 21 listings");
    const existing = await db.query<Ref>(
      `select configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,
        year_from,year_to,power_hp,power_kw,source,status,note
       from public.vehicle_power_automatic_reference where configuration_key=any($1::text[])`,
      [rows.map((r) => r.configuration_key)]);
    const present = new Map(existing.rows.map((r) => [r.configuration_key, r]));
    for (const row of rows) {
      const previous = present.get(row.configuration_key);
      if (previous && (previous.status !== "automatic" || Number(previous.power_hp) !== row.power_hp)) {
        throw new Error(`Protected or conflicting existing reference: ${row.configuration_key}`);
      }
    }
    // Resolve against the complete live catalogue of automatic rules, not just
    // these 16 keys: a broader old rule could otherwise tie or shadow one.
    const allRefs = await db.query<Ref>(
      `select configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,
        year_from,year_to,power_hp,power_kw,source,status,note
       from public.vehicle_power_automatic_reference where status='automatic'`);
    const combined = [...allRefs.rows, ...rows.filter((r) => !present.has(r.configuration_key))];
    for (const candidate of selected) {
      const conf = candidate.configuration;
      const match = resolveAutomaticPowerReference({
        brand: String(conf.brand), model: candidate.sourceListingId === "42753381" ? "CLS" : String(conf.model),
        fuel_type: String(conf.fuelType), engine_cc: Number(conf.engineCc),
        drive_type: conf.driveType == null ? null : String(conf.driveType),
        badge: conf.badge == null ? null : String(conf.badge),
        badge_detail: conf.trim == null ? null : String(conf.trim), year: Number(conf.year),
      }, combined);
      if (Number(match?.power_hp) !== evidence[candidate.sourceListingId].ps) {
        throw new Error(`Resolver failed for ${candidate.sourceListingId}`);
      }
    }
    console.log(JSON.stringify({ write, runId, listings: ids.length, configurations: rows.length,
      newReferences: rows.length - present.size, existingSamePower: present.size,
      corrections: { rangerRaptorPs: 210, clsModel: "CLS", clsPs: 265 },
      effects: { cars: 0, prices: 0, publications: 0 } }));
    if (write) {
      await db.query(
        `insert into public.vehicle_power_automatic_reference
         (configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,
          year_from,year_to,power_hp,power_kw,source,status,note,updated_at)
         select x.configuration_key,x.brand,x.model,x.fuel_type,x.engine_cc,x.drive_type,x.badge,x.badge_detail,
                x.year_from,x.year_to,x.power_hp,x.power_kw,x.source,x.status,x.note,now()
         from jsonb_to_recordset($1::jsonb) as x(
           configuration_key text,brand text,model text,fuel_type text,engine_cc integer,drive_type text,
           badge text,badge_detail text,year_from integer,year_to integer,power_hp numeric,power_kw numeric,
           source text,status text,note text)
         on conflict (configuration_key) do nothing`, [JSON.stringify(rows)]);
      const verify = await db.query<{ count: string }>(
        `select count(*)::text as count from public.vehicle_power_automatic_reference
         where configuration_key=any($1::text[]) and status='automatic'`, [rows.map((r) => r.configuration_key)]);
      if (Number(verify.rows[0]?.count) !== rows.length) throw new Error("Post-write reference verification failed");
      await db.query("commit");
      console.log(JSON.stringify({ applied: rows.length - present.size, verifiedReferences: rows.length, coveredListings: 21 }));
    } else await db.query("rollback");
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally { await db.end(); }
}

main().catch((error) => { console.error(error); process.exit(1); });
