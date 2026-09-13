import { Client } from "pg";
import { config } from "dotenv";
import { normalizeDrive } from "../src/server/normalization/vehicles";
import { resolveApprovedPower, type ApprovedPowerCandidate } from "../src/server/power-resolution/resolver";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type Row = { source_listing_id: string; manufacturer: string | null; model: string | null; model_year: number | null; engine_cc: number | null; fuel_type: string | null; drive_type: string | null; trim: string | null; generation: string | null; raw_payload: Record<string, unknown> | null };
const fuel = (value: string | null) => { const text = (value ?? "").toLowerCase(); if (text.includes("디젤") || text.includes("diesel")) return "diesel"; if (text.includes("가솔린") || text.includes("gas")) return "gasoline"; if (text.includes("하이브리드") || text.includes("hybrid")) return "hybrid"; return value; };

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const [rows, refs] = await Promise.all([
      client.query<Row>(`
      select source_listing_id,manufacturer,model,model_year,engine_cc,fuel_type,drive_type,trim,generation,raw_payload
      from public.chestny_catalog_staging
      where source_status='active'
        and promotion_status='auto_candidate'
        and raw_payload ? 'encar_enrichment'
    `),
      client.query(`select spec.id spec_id,spec.version spec_version,spec.calculation_power_kw,spec.power_basis,spec.source_priority,evidence.id evidence_id,evidence.source_kind evidence_kind,evidence.verification_status evidence_verification_status,evidence.reliability evidence_reliability,matcher.id match_id,matcher.priority match_priority,matcher.brand,matcher.model,matcher.generation,matcher.trim,matcher.badge_normalized,matcher.model_code,matcher.engine_code,matcher.fuel_type,matcher.drive_type,matcher.production_year_from,matcher.production_year_to,matcher.engine_cc_from,matcher.engine_cc_to from public.vehicle_power_specs spec join public.vehicle_power_evidence evidence on evidence.id=spec.evidence_id join public.vehicle_power_spec_matches matcher on matcher.spec_id=spec.id where spec.status='approved' and evidence.verification_status='approved'`),
    ]);
    const candidates: ApprovedPowerCandidate[] = refs.rows.map((r) => ({ specId:r.spec_id,specVersion:r.spec_version,calculationPowerKw:Number(r.calculation_power_kw),powerBasis:r.power_basis,sourcePriority:r.source_priority,evidenceId:r.evidence_id,evidenceKind:r.evidence_kind,evidenceVerificationStatus:r.evidence_verification_status,evidenceReliability:r.evidence_reliability,match:{id:r.match_id,priority:r.match_priority,brand:r.brand,model:r.model,generation:r.generation,trim:r.trim,badgeNormalized:r.badge_normalized,modelCode:r.model_code,engineCode:r.engine_code,fuelType:r.fuel_type,driveType:r.drive_type,productionYearFrom:r.production_year_from,productionYearTo:r.production_year_to,engineCcFrom:r.engine_cc_from,engineCcTo:r.engine_cc_to} }));
    let fromExplicitText = 0; let fromApprovedConfiguration = 0;
    const updates = rows.rows.flatMap((row) => {
      const sourceText = [row.drive_type, row.trim, row.generation].filter(Boolean).join(" ");
      let drive = normalizeDrive(sourceText); let source = "existing_explicit_text";
      if (drive) fromExplicitText++;
      if (!drive) {
        const resolution = resolveApprovedPower({ brand:row.manufacturer, model:row.model, generation:row.generation, trim:row.trim, fuelType:fuel(row.fuel_type), year:row.model_year, engineCc:row.engine_cc }, candidates);
        const configured = resolution.status === "matched" ? normalizeDrive(resolution.candidate.match.driveType) : null;
        if (configured) { drive = configured; source = "approved_configuration"; fromApprovedConfiguration++; }
      }
      if (!drive) return [];
      return [{ sourceId: row.source_listing_id, drive, payload: { ...(row.raw_payload ?? {}), drive_enrichment: { value: drive, source, source_text: sourceText || null, resolved_at: new Date().toISOString() } } }];
    });
    for (let offset = 0; offset < updates.length; offset += 250) {
      const batch = updates.slice(offset, offset + 250);
      await client.query(`
        update public.chestny_catalog_staging as s
        set drive_type=v.drive_type, raw_payload=v.raw_payload, updated_at=now()
        from jsonb_to_recordset($1::jsonb) as v(source_listing_id text,drive_type text,raw_payload jsonb)
        where s.source_listing_id=v.source_listing_id
          and (s.drive_type is null or btrim(s.drive_type)='' or s.drive_type<>v.drive_type)
      `, [JSON.stringify(batch.map((item) => ({ source_listing_id: item.sourceId, drive_type: item.drive, raw_payload: item.payload })))]);
    }
    console.log(JSON.stringify({ encarRequests: 0, enrichedStagingRows: rows.rowCount, driveResolved: updates.length, fromExplicitText, fromApprovedConfiguration, unresolved: (rows.rowCount ?? 0) - updates.length, publicCatalogChanged: false }, null, 2));
  } finally { await client.end(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
