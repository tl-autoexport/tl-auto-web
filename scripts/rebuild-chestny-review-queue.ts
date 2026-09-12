import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { config } from "dotenv";
import { resolveApprovedPower, type ApprovedPowerCandidate } from "../src/server/power-resolution/resolver";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type RequestedGroup = { manufacturer: string; requestedModel: string };
type QueueItem = {
  configuration_key: string;
  brand: string;
  model: string;
  fuel_type: string | null;
  engine_cc: number | null;
  drive_type: string | null;
  year_from: number;
  year_to: number;
  cards_count: number;
  current_sources: string;
  priority: number;
  required_evidence: string[];
  review_note: string;
  power_hp: number | null;
};

const aliases: Record<string, string> = {
  canival: "Carnival", santafe: "Santa Fe", ray: "Ray", morning: "Morning",
  tiboli: "Tivoli", "x2 (f39)": "X2", "1-series": "1 Series", "2-series": "2 Series",
};
const canonical = (value: string | null) => {
  const raw = (value ?? "").trim();
  return aliases[raw.toLowerCase()] ?? raw;
};
const keyPart = (value: string | null) => canonical(value).toLowerCase().replace(/[\s-]+/g, "");
const fuel = (value: string | null) => {
  const s = (value ?? "").toLowerCase();
  if (s.includes("디젤") || s.includes("diesel")) return "diesel";
  if (s.includes("전기") || s.includes("hybrid")) return "hybrid";
  if (s.includes("가솔린") || s.includes("gas")) return "gasoline";
  return value;
};

async function main() {
  const inventory = JSON.parse(await readFile("docs/chestny-required-models-audit.json", "utf8")) as { groups: RequestedGroup[] };
  const requested = new Set(inventory.groups.map((x) => `${keyPart(x.manufacturer)}|${keyPart(x.requestedModel)}`));
  const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const [staging, refs] = await Promise.all([
      c.query(`select manufacturer,model,model_year,engine_cc,fuel_type,drive_type,count(*)::int cards
        from public.chestny_catalog_staging group by 1,2,3,4,5,6`),
      c.query(`select spec.id spec_id,spec.version spec_version,spec.calculation_power_kw,spec.power_basis,spec.source_priority,
        evidence.id evidence_id,evidence.source_kind evidence_kind,evidence.verification_status evidence_verification_status,evidence.reliability evidence_reliability,
        matcher.id match_id,matcher.priority match_priority,matcher.brand,matcher.model,matcher.generation,matcher.trim,matcher.badge_normalized,matcher.model_code,matcher.engine_code,
        matcher.fuel_type,matcher.drive_type,matcher.production_year_from,matcher.production_year_to,matcher.engine_cc_from,matcher.engine_cc_to
        from public.vehicle_power_specs spec join public.vehicle_power_evidence evidence on evidence.id=spec.evidence_id
        join public.vehicle_power_spec_matches matcher on matcher.spec_id=spec.id
        where spec.status='approved' and evidence.verification_status='approved'`),
    ]);
    const candidates: ApprovedPowerCandidate[] = refs.rows.map((r) => ({
      specId: r.spec_id, specVersion: r.spec_version, calculationPowerKw: Number(r.calculation_power_kw), powerBasis: r.power_basis,
      sourcePriority: r.source_priority, evidenceId: r.evidence_id, evidenceKind: r.evidence_kind,
      evidenceVerificationStatus: r.evidence_verification_status, evidenceReliability: r.evidence_reliability,
      match: { id: r.match_id, priority: r.match_priority, brand: r.brand, model: r.model, generation: r.generation, trim: r.trim,
        badgeNormalized: r.badge_normalized, modelCode: r.model_code, engineCode: r.engine_code, fuelType: r.fuel_type, driveType: r.drive_type,
        productionYearFrom: r.production_year_from, productionYearTo: r.production_year_to, engineCcFrom: r.engine_cc_from, engineCcTo: r.engine_cc_to },
    }));
    const groups = new Map<string, QueueItem>();
    for (const row of staging.rows) {
      const brand = canonical(row.manufacturer);
      const model = canonical(row.model);
      if (!requested.has(`${keyPart(brand)}|${keyPart(model)}`)) continue;
      const normalizedFuel = fuel(row.fuel_type);
      const configurationKey = [brand, model, row.model_year, row.engine_cc, normalizedFuel, row.drive_type].join("|");
      const match = resolveApprovedPower({ brand, model, year: row.model_year, engineCc: row.engine_cc, fuelType: normalizedFuel, driveType: row.drive_type }, candidates);
      const powerHp = match.status === "matched" ? Math.round(match.candidate.calculationPowerKw * 1.35962 * 10) / 10 : null;
      const item = groups.get(configurationKey) ?? {
        configuration_key: configurationKey, brand, model, fuel_type: normalizedFuel, engine_cc: row.engine_cc,
        drive_type: row.drive_type, year_from: row.model_year, year_to: row.model_year, cards_count: 0,
        current_sources: JSON.stringify({ source: "chestny_catalog_staging", power_hp: powerHp }),
        priority: powerHp != null && powerHp <= 160 ? 10 : powerHp != null ? 30 : 50,
        required_evidence: powerHp == null ? ["manufacturer_document", "configuration_check", "power_reference"] : ["manufacturer_document", "configuration_check"],
        review_note: match.status === "matched" ? `Local power match (${match.confidence}); manual verification required.` : "No approved local power match; manual verification required.",
        power_hp: powerHp,
      };
      item.cards_count += Number(row.cards);
      groups.set(configurationKey, item);
    }
    await c.query("begin");
    try {
      await c.query(`update public.vehicle_power_review_queue set status='ignored', review_note='Superseded by the customer-model diversified queue rebuild.' where status='pending'`);
      const items = [...groups.values()];
      for (let offset = 0; offset < items.length; offset += 100) {
        const chunk = items.slice(offset, offset + 100);
        const values: unknown[] = [];
        const placeholders = chunk.map((item, index) => {
          const base = index * 13;
          values.push(item.configuration_key, item.brand, item.model, item.fuel_type, item.engine_cc, item.drive_type, item.year_from, item.year_to, item.cards_count, item.current_sources, item.priority, item.required_evidence, item.review_note);
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},'pending',$${base + 12},$${base + 13})`;
        }).join(",");
        await c.query(`insert into public.vehicle_power_review_queue(configuration_key,brand,model,fuel_type,engine_cc,drive_type,year_from,year_to,cards_count,current_sources,priority,status,required_evidence,review_note) values ${placeholders}
          on conflict(configuration_key) do update set brand=excluded.brand,model=excluded.model,fuel_type=excluded.fuel_type,engine_cc=excluded.engine_cc,drive_type=excluded.drive_type,
            year_from=excluded.year_from,year_to=excluded.year_to,cards_count=excluded.cards_count,current_sources=excluded.current_sources,priority=excluded.priority,status='pending',required_evidence=excluded.required_evidence,review_note=excluded.review_note,updated_at=now()`, values);
      }
      await c.query("commit");
    } catch (error) {
      await c.query("rollback");
      throw error;
    }
    const summary = { totalStaging: staging.rowCount, requestedGroups: inventory.groups.length, queueGroups: groups.size, queueCards: [...groups.values()].reduce((n, x) => n + x.cards_count, 0), priorityUnder160Groups: [...groups.values()].filter((x) => x.priority === 10).length, priorityUnder160Cards: [...groups.values()].filter((x) => x.priority === 10).reduce((n, x) => n + x.cards_count, 0), over160Groups: [...groups.values()].filter((x) => x.priority === 30).length, over160Cards: [...groups.values()].filter((x) => x.priority === 30).reduce((n, x) => n + x.cards_count, 0), unmatchedGroups: [...groups.values()].filter((x) => x.priority === 50).length, unmatchedCards: [...groups.values()].filter((x) => x.priority === 50).reduce((n, x) => n + x.cards_count, 0), publicCatalogChanged: false, encarRequests: 0 };
    console.log(JSON.stringify(summary, null, 2));
  } finally { await c.end(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
