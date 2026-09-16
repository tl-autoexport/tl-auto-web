import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const argument = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const input = argument("input");
const project = argument("project") ?? "tl-auto";
const purpose = argument("purpose") ?? "full";
const rulesVersion = argument("rules-version") ?? "v1";
const priority = Number(argument("priority") ?? 40);

if (!input) throw new Error("--input=path is required");
if (!['insurance', 'options', 'gallery', 'full'].includes(purpose)) throw new Error("--purpose must be insurance, options, gallery, or full");
if (!Number.isInteger(priority) || priority < 0 || priority > 100) throw new Error("--priority must be an integer from 0 to 100");

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

type Candidate = { source?: unknown; sourceListingId?: unknown; source_listing_id?: unknown; sourceUrl?: unknown; source_url?: unknown; task?: unknown; [key: string]: unknown };

async function main() {
  const parsed = JSON.parse(await readFile(resolve(input!), "utf8")) as { candidates?: Candidate[]; rules?: unknown; summary?: unknown } | Candidate[];
  const candidates = Array.isArray(parsed) ? parsed : parsed.candidates ?? [];
  if (!candidates.length) throw new Error("Input has no candidates");
  const rows = candidates.map((candidate) => {
    const source = String(candidate.source ?? "chestny_prigon").trim();
    const sourceListingId = String(candidate.sourceListingId ?? candidate.source_listing_id ?? "").trim();
    const sourceUrl = String(candidate.sourceUrl ?? candidate.source_url ?? `https://www.encar.com/dc/dc_cardetailview.do?carid=${sourceListingId}`).trim();
    if (!source || !sourceListingId || !sourceUrl) throw new Error("Every candidate needs source, sourceListingId, and sourceUrl");
    return { source, source_listing_id: sourceListingId, source_url: sourceUrl, task: candidate.task ?? { insurance: purpose === "insurance" || purpose === "full", options: purpose === "options" || purpose === "full", gallery: purpose === "gallery" || purpose === "full" }, candidate_snapshot: candidate };
  });
  const keys = rows.map((row) => `${row.source}:${row.source_listing_id}`);
  if (new Set(keys).size !== keys.length) throw new Error("Input contains duplicate source/sourceListingId pairs");
  const dbKey = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!dbKey) throw new Error("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required");
  const db = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), dbKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: run, error: runError } = await db.from("encar_enrichment_runs").insert({ project, purpose, priority, status: "awaiting_approval", requested_limit: rows.length, candidate_count: rows.length, rules_version: rulesVersion, summary: Array.isArray(parsed) ? {} : { sourceSummary: parsed.summary ?? {}, sourceRules: parsed.rules ?? {} } }).select("id,status,candidate_count").single();
  if (runError) throw new Error(runError.message);
  for (let offset = 0; offset < rows.length; offset += 500) {
    const { error } = await db.from("encar_enrichment_queue").insert(rows.slice(offset, offset + 500).map((row) => ({ ...row, run_id: run.id })));
    if (error) throw new Error(error.message);
  }
  console.log(JSON.stringify({ run, project, purpose, priority, queued: rows.length, encarRequests: 0, productionWrites: 0 }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
