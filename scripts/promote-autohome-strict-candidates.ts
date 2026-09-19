/**
 * Promotes only AutoHome groups with one exact configuration and one output.
 *
 * The owner explicitly approved AutoHome for this narrow publication batch.
 * We keep the URL, source specification name and the exact match dimensions
 * in the power reference.  No Encar request is made here.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", override: true, quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
const write = process.env.AUTOHOME_STRICT_PROMOTE_WRITE === "true";
const input = process.env.AUTOHOME_MATCH_INPUT ?? "/tmp/tl-auto-autohome-ice-matches.json";
const promotionScope = process.env.AUTOHOME_PROMOTION_SCOPE ?? "strict";
const runId = process.env.ENCAR_SUCCESS_RUN_ID ?? "98b17628-1dab-460d-972b-f7f092fbcc42";
const sourceBase = "https://www.autohome.com.cn/web-main/car/series/getspeclistresponse";
const PS_PER_KW = 1.359621617;

type MatchRow = {
  manufacturer: string; model: string; generation: string | null; trim: string | null;
  model_year: number; engine_cc: number; fuel_type: string; drive_type: string | null;
  cards: number; status: string; powers: number[]; seriesId: number;
  candidates: Array<{ name: string; year: number; powerHp: number; drive: string | null; specId: number }>;
};

type StageRow = {
  source_listing_id: string; manufacturer: string; model: string; generation: string | null; trim: string | null;
  model_year: number; engine_cc: number; fuel_type: string; drive_type: string | null;
  raw_payload: Record<string, unknown> | null;
};

const same = (column: string, value: unknown, params: unknown[]) => {
  if (value == null) return `${column} is null`;
  params.push(value);
  return `${column} = $${params.length}`;
};

const sourceDriveToTl = (value: string | null) => {
  const normalized = String(value ?? "").replaceAll(" ", "");
  if (normalized.includes("四驱")) return "4WD";
  if (normalized.includes("前驱") || normalized.includes("后驱")) return "2WD";
  return null;
};

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "vehicle";
const groupKey = (row: MatchRow) => [row.manufacturer, row.model, row.generation, row.trim, row.model_year, row.engine_cc, row.fuel_type, row.drive_type].map((value) => value ?? "<null>").join("|");

async function main() {
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
  const report = JSON.parse(await readFile(input, "utf8")) as { rows?: MatchRow[]; accepted?: Array<MatchRow & { selectedPowerHp: number; decision: string }> };
  let groups: MatchRow[];
  if (promotionScope === "approved_alternatives") {
    const strictReport = JSON.parse(await readFile("/tmp/tl-auto-autohome-ice-matches.json", "utf8")) as { rows: MatchRow[] };
    const strictKeys = new Set(strictReport.rows.filter((row) => row.status === "high_confidence").map(groupKey));
    groups = (report.accepted ?? [])
      .filter((row) => !strictKeys.has(groupKey(row)))
      .map((row) => ({ ...row, status: "owner_approved_alternative", powers: [Number(row.selectedPowerHp)] }));
  } else {
    groups = (report.rows ?? []).filter((row) => row.status === "high_confidence");
  }
  const strictCardsExpected = groups.reduce((total, row) => total + row.cards, 0);
  const batchHash = createHash("sha256").update(JSON.stringify(groups)).digest("hex");
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const selected: Array<{ group: MatchRow; sourceDrive: string; hp: number; sourceSpec: MatchRow["candidates"][number]; rows: StageRow[] }> = [];
    const blocked: Array<{ key: string; reason: string }> = [];

    for (const group of groups) {
      const params: unknown[] = [runId];
      const predicates = [
        same("s.manufacturer", group.manufacturer, params), same("s.model", group.model, params),
        same("s.generation", group.generation, params), same("s.trim", group.trim, params),
        same("s.model_year", group.model_year, params), same("s.engine_cc", group.engine_cc, params),
        same("s.fuel_type", group.fuel_type, params), same("s.drive_type", group.drive_type, params),
      ];
      const cards = await db.query<StageRow>(`
        select s.source_listing_id,s.manufacturer,s.model,s.generation,s.trim,s.model_year,s.engine_cc,s.fuel_type,s.drive_type,s.raw_payload
        from public.chestny_catalog_staging s
        join public.catalog_enrichment_queue q on q.source_listing_id=s.source_listing_id and q.run_id=$1 and q.status='succeeded'
        where s.source_status='active' and s.promotion_status='auto_candidate' and ${predicates.join(" and ")}
        order by s.source_listing_id`, params);
      const hp = group.powers.length === 1 ? Number(group.powers[0]) : NaN;
      const sourceSpec = group.candidates.find((candidate) => Number(candidate.powerHp) === hp);
      const sourceDrive = sourceDriveToTl(sourceSpec?.drive ?? null);
      const key = groupKey(group);
      if (!cards.rows.length) { blocked.push({ key, reason: "no_active_cards" }); continue; }
      if (cards.rows.length !== group.cards) { blocked.push({ key, reason: `card_count_changed:${cards.rows.length}/${group.cards}` }); continue; }
      if (!Number.isFinite(hp) || hp <= 0 || !sourceSpec || !sourceDrive) { blocked.push({ key, reason: "invalid_source_power_or_drive" }); continue; }
      if (cards.rows.some((row) => row.drive_type != null && row.drive_type !== sourceDrive)) {
        blocked.push({ key, reason: "staging_drive_conflict" }); continue;
      }
      selected.push({ group, sourceDrive, hp, sourceSpec, rows: cards.rows });
    }

    const summary = {
      dryRun: !write, runId, input, promotionScope, strictGroups: groups.length, strictCardsExpected,
      eligibleGroups: selected.length, eligibleCards: selected.reduce((total, item) => total + item.rows.length, 0),
      blockedGroups: blocked.length, blocked, encarRequests: 0, publicCatalogChanged: false,
    };
    if (!write) { console.log(JSON.stringify(summary, null, 2)); return; }

    await db.query("begin");
    try {
      const batch = await db.query<{ id: string }>(`
        insert into public.vehicle_power_source_batches
          (source_kind,source_name,source_uri,source_sha256,source_version,imported_by,metadata)
        values ('manual','AutoHome strict configuration power',$1,$2,'autohome-strict-v1','promote-autohome-strict-candidates-v1',$3::jsonb)
        on conflict (source_kind,source_sha256) do update set metadata=excluded.metadata
        returning id`, [sourceBase, batchHash, JSON.stringify({ actualSourceKind: "autohome", ownerApproval: "explicit", strictCardsExpected, input })]);
      const batchId = batch.rows[0]?.id;
      if (!batchId) throw new Error("Unable to create AutoHome source batch");

      let sourceRows = 0, evidenceCreated = 0, specsCreated = 0, stagingWritten = 0;
      for (const [index, item] of selected.entries()) {
        const { group, sourceDrive, hp, sourceSpec } = item;
        const sourceUri = `${sourceBase}?seriesid=${group.seriesId}&tagid=${sourceSpec.year}&tagname=${encodeURIComponent(`${sourceSpec.year}款`)}&cityid=110100`;
        const raw = { group, sourceSpec, sourceDrive, powerHp: hp, match: "exact_single_autohome_output" };
        const sourceRow = await db.query<{ id: string }>(`
          insert into public.vehicle_power_source_rows
            (batch_id,source_sheet,source_row_number,raw_record,raw_vehicle_name,raw_power_text,parse_status,review_classification,classification_rule_version,classified_at)
          values ($1,'autohome-strict',$2,$3::jsonb,$4,$5,'parsed','range_or_ambiguous','autohome-strict-v1',now())
          on conflict (batch_id,source_sheet,source_row_number) do update set raw_record=excluded.raw_record,raw_power_text=excluded.raw_power_text,classified_at=now()
          returning id`, [batchId, index + 1, JSON.stringify(raw), `${group.manufacturer} ${group.model}`, `${hp} PS`]);
        const sourceRowId = sourceRow.rows[0]?.id;
        if (!sourceRowId) throw new Error("Unable to create AutoHome source row");
        sourceRows++;

        const existingEvidence = await db.query<{ id: string }>(`select id from public.vehicle_power_evidence where source_row_id=$1 limit 1`, [sourceRowId]);
        let evidenceId = existingEvidence.rows[0]?.id;
        if (!evidenceId) {
          const evidence = await db.query<{ id: string }>(`
            insert into public.vehicle_power_evidence
              (batch_id,source_row_id,source_kind,source_uri,document_reference,captured_at,vehicle_category,brand,model,generation,trim,fuel_type,production_year_from,production_year_to,propulsion_type,dvs_power_kw,source_units,reliability,review_status,reviewed_by,reviewed_at,source_title,source_retrieved_at,confidence_score,evidence_note,verification_status,review_note,evidence_tier,evidence_tier_source,evidence_tier_reviewed_at)
            values ($1,$2,'manual',$3,$4,current_date,'M1',$5,$6,$7,$8,$9,$10,$10,'ice',$11,'PS','high','verified','owner-approved-autohome-strict',now(),'AutoHome strict configuration specification',now(),95,$12,'approved','Explicit project-owner approval; exact configuration, one AutoHome output and known drive.','T2','owner-approved-accepted-aggregator',now())
            returning id`, [batchId, sourceRowId, sourceUri, sourceSpec.name, group.manufacturer, group.model, group.generation, group.trim, group.fuel_type, group.model_year, hp / PS_PER_KW, `AutoHome spec ${sourceSpec.specId}; ${sourceSpec.name}`]);
          evidenceId = evidence.rows[0]?.id;
          evidenceCreated++;
        }
        if (!evidenceId) throw new Error("Unable to create AutoHome evidence");

        const configHash = createHash("sha256").update(groupKey(group)).digest("hex").slice(0, 10);
        const specKey = `autohome-${slug(group.manufacturer)}-${slug(group.model)}-${group.model_year}-${group.engine_cc}-${hp}ps-${sourceDrive.toLowerCase()}-${configHash}`;
        const existingSpec = await db.query<{ id: string }>(`select id from public.vehicle_power_specs where spec_key=$1 and version=1 limit 1`, [specKey]);
        let specId = existingSpec.rows[0]?.id;
        if (!specId) {
          const spec = await db.query<{ id: string }>(`
            insert into public.vehicle_power_specs
              (spec_key,version,status,vehicle_category,propulsion_type,engine_cc_from,engine_cc_to,dvs_power_kw,calculation_power_kw,evidence_id,approval_note,approved_by,approved_at,engine_power_hp,power_basis,source_priority,hybrid_type,power_ice_hp,customs_power_hp)
            values ($1,1,'approved','M1','ice',$2,$2,$3,$3,$4,$5,'owner-approved-autohome-strict',now(),$6,'combustion_engine',30,'none',$6,$6)
            returning id`, [specKey, group.engine_cc, hp / PS_PER_KW, evidenceId, 'Approved by project owner for exact AutoHome configuration match.', hp]);
          specId = spec.rows[0]?.id;
          if (!specId) throw new Error("Unable to create AutoHome power spec");
          await db.query(`
            insert into public.vehicle_power_spec_matches
              (spec_id,priority,brand,model,generation,trim,fuel_type,drive_type,production_year_from,production_year_to,engine_cc_from,engine_cc_to)
            values ($1,30,$2,$3,$4,$5,$6,$7,$8,$8,$9,$9)`,
            [specId, group.manufacturer, group.model, group.generation, group.trim, group.fuel_type, sourceDrive, group.model_year, group.engine_cc]);
          specsCreated++;
        }
        if (!specId) throw new Error("Unable to resolve AutoHome power spec");

        for (const row of item.rows) {
          const payload = row.raw_payload ?? {};
          const confirmation = {
            spec_id: specId, spec_version: 1, spec_key: specKey, evidence_id: evidenceId,
            evidence_kind: "manual", evidence_uri: sourceUri, evidence_tier: "T2",
            confidence: promotionScope === "approved_alternatives" ? "owner_approved_alternative_autohome" : "exact_autohome_configuration",
            power_hp: hp, calculation_power_kw: hp / PS_PER_KW,
            match_fields: { generation: group.generation, trim: group.trim, fuel_type: group.fuel_type, drive_type: sourceDrive, years: [group.model_year, group.model_year], engine_cc: [group.engine_cc, group.engine_cc] },
            drive_state: "drive_confirmed", source: "AutoHome", source_spec_name: sourceSpec.name, resolved_at: new Date().toISOString(),
          };
          const candidatePayload = payload.autohome_power_candidate;
          const approvedCandidate = {
            ...(candidatePayload && typeof candidatePayload === "object" ? candidatePayload : {}),
            review_status: "approved",
            approved_at: new Date().toISOString(),
          };
          const result = await db.query(`
            update public.chestny_catalog_staging
            set drive_type=$2,promotion_status='power_confirmed',
                promotion_note=$3,raw_payload=$4::jsonb,updated_at=now()
            where source_listing_id=$1 and source_status='active' and promotion_status='auto_candidate'`,
            [row.source_listing_id, sourceDrive, `Power and drive confirmed from owner-approved exact AutoHome configuration; ${hp} PS; spec=${specId}.`, JSON.stringify({ ...payload, power_confirmation: confirmation, autohome_power_candidate: approvedCandidate })]);
          stagingWritten += result.rowCount ?? 0;
        }
      }
      await db.query("commit");
      console.log(JSON.stringify({ ...summary, dryRun: false, sourceRows, evidenceCreated, specsCreated, stagingWritten, publicCatalogChanged: false }, null, 2));
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  } finally {
    await db.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
