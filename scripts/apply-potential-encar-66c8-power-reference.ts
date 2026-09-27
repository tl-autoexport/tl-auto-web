/** Resolve the 14 near-matches in Encar run 66c8 as preliminary references.
 * Writes only vehicle_power_automatic_reference and a derived local power-plan
 * file; never changes cars, calculations, prices, or publication state.
 */
import { readFile, writeFile } from "node:fs/promises";
import { config } from "dotenv";
import { Client } from "pg";
import { resolveAutomaticPowerReference, type AutomaticPowerReferenceRow } from "../src/server/catalog/automatic-power-reference";
import { canonicalBadge } from "../src/server/power-resolution/canonical";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const runId = "66c8b38e-1147-4f23-8735-6ebdd5bec4aa";
const sourcePlanPath = "output/tl-auto-new-encar-power-plan-66c8b38e.json";
const derivedPlanPath = "output/tl-auto-new-encar-power-plan-66c8b38e-potential-preliminary.json";
const write = process.env.POTENTIAL_ENCAR_POWER_WRITE === "true";

type Candidate = { sourceListingId: string; status: string; configuration: Record<string, unknown>; potentialMatch?: { specIds?: string[] } };
type Plan = { runId: string; candidates: Candidate[] };
type Ref = AutomaticPowerReferenceRow & { note: string };

const choices: Record<string, { ps: number; source: string; specId?: string; note: string }> = {
  "42408253": { ps: 184, source: "https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/catalog/catalog_sportageql.pdf", specId: "ae72aadb-8cfb-4073-bd6c-cd383da0b1c8", note: "Sportage 2.0 diesel 4WD Prestige; closest approved TKS spec match." },
  "42734792": { ps: 184, source: "https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/catalog/catalog_sportageql.pdf", specId: "ae72aadb-8cfb-4073-bd6c-cd383da0b1c8", note: "Sportage 2.0 diesel 4WD Prestige; closest approved TKS spec match." },
  "42411518": { ps: 194, source: "https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/catalog/catalog_sorento.pdf", specId: "5bfd3651-5d06-4291-bbe5-2e97019bb10a", note: "Sorento 2.2 diesel 4WD Signature; closest approved TKS spec match." },
  "42519316": { ps: 245, source: "https://www.volkswagen.co.kr/ko/promotion_news/news/new-2024/2024-01-15.html", specId: "8d59c1c1-d544-4595-8ef4-02e26100bc00", note: "Golf 8 GTI, 2.0 TSI." },
  "42521660": { ps: 136, source: "https://www.autohome.com.cn/web-main/car/series/getspeclistresponse?seriesid=750&tagid=2020&tagname=2020%E6%AC%BE&cityid=110100", specId: "1b921779-8e20-4209-8b4f-2c854b6d76fd", note: "Countryman 1.5 gasoline, 2nd generation; closest approved TKS spec match." },
  "42522568": { ps: 192, source: "https://www.press.bmwgroup.com/global/article/detail/T0265095EN/driving-fun-for-every-occasion%3A-the-new-mini-countryman", specId: "8315a557-e80b-4299-9274-9105003a2762", note: "Countryman Cooper S 2.0 ALL4; rated 192 PS. Power is shared across 2WD/ALL4 versions." },
  "42629781": { ps: 192, source: "https://www.press.bmwgroup.com/global/article/detail/T0265095EN/driving-fun-for-every-occasion%3A-the-new-mini-countryman", specId: "8315a557-e80b-4299-9274-9105003a2762", note: "Countryman Cooper S 2.0 ALL4; rated 192 PS. Power is shared across 2WD/ALL4 versions." },
  "42541274": { ps: 192, source: "https://www.press.bmwgroup.com/global/article/detail/T0265095EN/driving-fun-for-every-occasion%3A-the-new-mini-countryman", specId: "e54cd919-3ff9-4928-b223-b89937477754", note: "Encar model name identifies Cooper S Convertible; 1,998 cc third-generation Cooper S, best-fit output 192 PS." },
  "42639198": { ps: 192, source: "https://www.press.bmwgroup.com/global/article/detail/T0265095EN/driving-fun-for-every-occasion%3A-the-new-mini-countryman", specId: "e54cd919-3ff9-4928-b223-b89937477754", note: "Cooper S 5-door, third generation, 1,998 cc; best-fit output 192 PS." },
  "42720525": { ps: 306, source: "https://www.press.bmwgroup.com/japan/article/detail/T0301395JA/%E6%96%B0%E5%9E%8Bmini-john-cooper-works-clubman-/-crossover%E3%82%92%E7%99%BA%E8%A1%A8", note: "Grade JCW identifies John Cooper Works Clubman; use its 306 PS rating, not the 192 PS Cooper S Clubman candidate." },
  "42725665": { ps: 136, source: "https://www.autohome.com.cn/web-main/car/series/getspeclistresponse?seriesid=750&tagid=2020&tagname=2020%E6%AC%BE&cityid=110100", specId: "1b921779-8e20-4209-8b4f-2c854b6d76fd", note: "Countryman 1.5 gasoline, 2nd generation; closest approved TKS spec match." },
  "42751956": { ps: 136, source: "https://www.autohome.com.cn/web-main/car/series/getspeclistresponse?seriesid=750&tagid=2020&tagname=2020%E6%AC%BE&cityid=110100", specId: "1b921779-8e20-4209-8b4f-2c854b6d76fd", note: "Countryman 1.5 gasoline, 2nd generation; closest approved TKS spec match." },
  "42760875": { ps: 150, source: "https://www.press.bmwgroup.com/slovak/article/attachment/T0223554SK/316571", specId: "99487996-aaad-4006-a12e-517fd2626f3c", note: "Encar says Cooper D Clubman, 1,995 cc diesel; manufacturer data gives 150 PS. The generic 192 PS Cooper SD candidate does not fit the D badge." },
  "42788384": { ps: 204, source: "https://www.autohome.com.cn/web-main/car/series/getspeclistresponse?seriesid=209&tagid=2025&tagname=2025%E6%AC%BE&cityid=110100", specId: "afa41d3d-d082-4f5b-90aa-e2132f56aab6", note: "Preliminary best fit from 1,998 cc gasoline engine and matching 2025 MINI Cooper reference (204 PS). Encar model label says Cooper C while displacement points to the 2.0-litre variant; retain this data conflict in the note." },
};

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const pos = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
  const plan = JSON.parse(await readFile(sourcePlanPath, "utf8")) as Plan;
  if (plan.runId !== runId || Object.keys(choices).length !== 14) throw new Error("Wrong run or expected choice count changed");
  const targets = plan.candidates.filter((c) => choices[c.sourceListingId]);
  if (targets.length !== 14 || targets.some((c) => c.status !== "potential_match_needs_configuration")) throw new Error("Potential-match cohort drift; refusing write");
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin");
    const ids = targets.map((c) => c.sourceListingId);
    const staging = await db.query<{ source_listing_id: string; raw_payload: Record<string, unknown> }>(
      `select source_listing_id,raw_payload from public.encar_enrichment_staging
       where run_id=$1 and source_listing_id=any($2::text[])`, [runId, ids]);
    if (staging.rows.length !== 14) throw new Error(`Expected 14 staging rows, got ${staging.rows.length}`);
    const stagingById = new Map(staging.rows.map((r) => [r.source_listing_id, r]));
    const rowsByKey = new Map<string, Ref & { ids: string[] }>();
    const derived: Plan = structuredClone(plan);
    for (const target of targets) {
      const id = target.sourceListingId;
      const picked = choices[id];
      const source = stagingById.get(id)?.raw_payload;
      const detail = source?.detail as Record<string, unknown> | undefined;
      const category = detail?.category as Record<string, unknown> | undefined;
      const spec = detail?.spec as Record<string, unknown> | undefined;
      const config = target.configuration;
      if (!category || !spec || Number(spec.displacement) !== Number(config.engineCc) ||
          canonicalBadge(category.gradeEnglishName) !== canonicalBadge(config.badge)) {
        throw new Error(`Encar source identity mismatch for ${id}`);
      }
      // Some reviewed choices deliberately override the generic potential hit
      // when Encar's exact grade/engine badge identifies a different variant
      // (e.g. JCW Clubman). Keep that exception explicit in the note above.
      if (picked.specId && !(target.potentialMatch?.specIds ?? []).includes(picked.specId)) {
        throw new Error(`Chosen evidence candidate is not the audited potential candidate for ${id}`);
      }
      const brand = String(config.brand), model = String(config.model), fuel = String(config.fuelType);
      const cc = Number(config.engineCc), year = Number(config.year);
      const drive = config.driveType == null ? null : String(config.driveType);
      const badge = config.badge == null ? null : String(config.badge);
      const badgeDetail = config.trim == null ? null : String(config.trim);
      const key = [norm(brand), norm(model), norm(fuel), cc, norm(drive), norm(badge), norm(badgeDetail), `year=${year}-${year}`].join("|");
      const note = `Предварительная мощность для Encar run ${runId}. ${picked.note} ${picked.specId ? `TKS approved spec candidate: ${picked.specId}. ` : ""}Источник: ${picked.source}`;
      const existing = rowsByKey.get(key);
      if (existing) {
        if (existing.power_hp !== picked.ps || existing.note !== note) throw new Error(`Conflicting selection for ${key}`);
        existing.ids.push(id);
      } else {
        rowsByKey.set(key, {
          configuration_key: key, brand, model, fuel_type: fuel, engine_cc: cc, drive_type: drive,
          badge, badge_detail: badgeDetail, year_from: year, year_to: year,
          power_hp: picked.ps, power_kw: Number((picked.ps * 0.73549875).toFixed(4)),
          source: "tks_preliminary_best_fit", status: "automatic", note, ids: [id],
        });
      }
      const derivedRow = derived.candidates.find((c) => c.sourceListingId === id)!;
      derivedRow.status = "unmatched";
      // Preserve the reviewed best-fit value in the local derived plan.
      (derivedRow as Candidate & { power?: unknown }).power = { preliminary: true, powerPs: picked.ps, source: picked.source };
    }
    const rows = [...rowsByKey.values()];
    const existing = await db.query<Ref>(
      `select configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,
        year_from,year_to,power_hp,power_kw,source,status,note
       from public.vehicle_power_automatic_reference where configuration_key=any($1::text[])`, [rows.map((r) => r.configuration_key)]);
    const existingByKey = new Map(existing.rows.map((r) => [r.configuration_key, r]));
    for (const row of rows) {
      const prev = existingByKey.get(row.configuration_key);
      if (prev && (prev.status !== "automatic" || Number(prev.power_hp) !== row.power_hp)) throw new Error(`Existing protected/different reference: ${row.configuration_key}`);
    }
    const liveRefs = await db.query<Ref>(`select configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,year_from,year_to,power_hp,power_kw,source,status,note from public.vehicle_power_automatic_reference where status='automatic'`);
    const combined = [...liveRefs.rows, ...rows.filter((r) => !existingByKey.has(r.configuration_key))];
    for (const target of targets) {
      const c = target.configuration;
      const match = resolveAutomaticPowerReference({ brand: String(c.brand), model: String(c.model), fuel_type: String(c.fuelType),
        engine_cc: Number(c.engineCc), drive_type: c.driveType == null ? null : String(c.driveType), badge: c.badge == null ? null : String(c.badge),
        badge_detail: c.trim == null ? null : String(c.trim), year: Number(c.year) }, combined);
      if (Number(match?.power_hp) !== choices[target.sourceListingId].ps) throw new Error(`Reference does not resolve uniquely for ${target.sourceListingId}`);
    }
    console.log(JSON.stringify({ write, runId, listings: 14, references: rows.length,
      existingSamePower: existing.rows.length, newReferences: rows.length - existing.rows.length,
      selected: targets.map((c) => ({ id: c.sourceListingId, vehicle: `${c.configuration.brand} ${c.configuration.model}`, ps: choices[c.sourceListingId].ps, source: choices[c.sourceListingId].source })),
      skippedFromRun: { failedOrRetryOrUnmatchedNotSelected: 61 }, effects: { cars: 0, calculations: 0, prices: 0, published: 0 } }));
    if (write) {
      await db.query(
        `insert into public.vehicle_power_automatic_reference
         (configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,year_from,year_to,power_hp,power_kw,source,status,note,updated_at)
         select x.configuration_key,x.brand,x.model,x.fuel_type,x.engine_cc,x.drive_type,x.badge,x.badge_detail,x.year_from,x.year_to,x.power_hp,x.power_kw,x.source,x.status,x.note,now()
         from jsonb_to_recordset($1::jsonb) as x(configuration_key text,brand text,model text,fuel_type text,engine_cc integer,drive_type text,badge text,badge_detail text,year_from integer,year_to integer,power_hp numeric,power_kw numeric,source text,status text,note text)
         on conflict (configuration_key) do nothing`, [JSON.stringify(rows)]);
      const verify = await db.query<{ count: string }>(
        `select count(*)::text as count from public.vehicle_power_automatic_reference where configuration_key=any($1::text[]) and status='automatic'`, [rows.map((r) => r.configuration_key)]);
      if (Number(verify.rows[0]?.count) !== rows.length) throw new Error("Reference write verification failed");
      await writeFile(derivedPlanPath, `${JSON.stringify(derived, null, 2)}\n`);
      await db.query("commit");
      console.log(JSON.stringify({ applied: rows.length - existing.rows.length, verifiedReferences: rows.length, derivedPlan: derivedPlanPath }));
    } else await db.query("rollback");
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally { await db.end(); }
}

main().catch((error) => { console.error(error); process.exit(1); });
