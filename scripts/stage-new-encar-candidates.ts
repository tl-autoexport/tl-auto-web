import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { importEncar } from "../src/server/imports/encar";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const target = Number(process.env.ENCAR_NEW_STAGING_TARGET ?? 50);
const maxPages = Number(process.env.ENCAR_NEW_STAGING_MAX_PAGES ?? 6);
if (!Number.isInteger(target) || target < 1) throw new Error("ENCAR_NEW_STAGING_TARGET must be a positive integer");
if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error("ENCAR_NEW_STAGING_MAX_PAGES must be a positive integer");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and Supabase service key are required");
const supabaseUrl = url;
const supabaseKey = key;

type CandidateDraft = {
  source: "encar";
  sourceListingId: string;
  sourceUrl: string;
  brand: string | null;
  model: string | null;
  year: number | null;
};

async function main() {
  // This calls Encar but stays dry-run: no rows are inserted into cars.
  const discovery = await importEncar({
    target,
    maxPages,
    onlyNew: true,
    dryRun: true,
    electricTarget: 0,
    electricPages: 0,
    hybridTarget: 0,
    hybridPages: 0,
    collectNewCandidateDrafts: "raw",
  });
  const candidates = (discovery.candidateDrafts ?? []) as CandidateDraft[];
  if (candidates.length !== target) {
    throw new Error(`Only ${candidates.length} new candidates passed discovery; target is ${target}. No staging run was created.`);
  }

  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: run, error: runError } = await db
    .from("encar_enrichment_runs")
    .insert({
      project: "tl-auto",
      purpose: "new_catalog_candidates_full",
      priority: 40,
      status: "awaiting_approval",
      requested_limit: candidates.length,
      candidate_count: candidates.length,
      rules_version: "new-candidate-staging-v1",
      summary: {
        source: "encar",
        onlyNew: true,
        electricTarget: 0,
        hybridTarget: 0,
        maxPages,
        discovery: {
          candidates: discovery.candidates,
          existingCandidates: discovery.existingCandidates,
          freshCandidates: discovery.freshCandidates,
          seen: discovery.seen,
        },
      },
    })
    .select("id,status,candidate_count")
    .single();
  if (runError) throw new Error(runError.message);

  const queueRows = candidates.map((candidate) => ({
    run_id: run.id,
    source: candidate.source,
    source_listing_id: candidate.sourceListingId,
    source_url: candidate.sourceUrl,
    task: {
      insurance: true,
      options: true,
      gallery: true,
      diagnosis: true,
      sellingpoint: true,
      contents: true,
      history: true,
      category: false,
    },
    candidate_snapshot: candidate,
  }));
  const { error: queueError } = await db.from("encar_enrichment_queue").insert(queueRows);
  if (queueError) throw new Error(queueError.message);

  console.log(JSON.stringify({
    run,
    staged: candidates.length,
    sourcePolicy: "only Encar IDs absent from cars; combustion only; no cars inserted; no publication",
    discovery: { candidates: discovery.candidates, existingCandidates: discovery.existingCandidates, freshCandidates: discovery.freshCandidates, seen: discovery.seen },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
