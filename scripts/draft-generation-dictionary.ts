import { writeFile } from "node:fs/promises";
import { Client } from "pg";
import { config } from "dotenv";
import { displayModelName } from "../src/server/catalog/display-model";
import { normalizeModel } from "../src/server/normalization/vehicles";

/**
 * Drafts the generation dictionary for review.
 *
 * The label is never invented: it is composed from the published Latin model
 * name plus a generation code the model's own allowlist recognises, or the
 * Korean ordinal the source value states.
 *
 * A code is recognised in two ways:
 *   - inside parentheses, which is a strong signal: `(DN8)`, `(JA)`, `(8Y)`;
 *   - as a bare token, but only when the same model already used it in
 *     parentheses elsewhere, so `LPG`, `GT` or `2WD` can never be mistaken for
 *     a generation.
 *
 * Everything else goes to the review list with the candidate codes found in the
 * string, so a human decides instead of a regex guessing.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const OUTPUT = process.env.GENERATION_DICTIONARY_OUTPUT ?? "docs/generation-dictionary-draft.json";

const PARENTHESISED_CODE = /\(([A-Za-z0-9]{2,4})\)/;
const BARE_TOKEN = /\b([A-Z][A-Z0-9]{1,3})\b/g;
const ORDINAL = /(\d+)\s*세대/;
const REFRESH = /더 뉴|페이스리프트|신형|부분변경/;
const HANGUL = /[\u3131-\u318E\uAC00-\uD7A3]/;

/** Tokens that look like codes but are powertrain, drivetrain or trim markers. */
const NOT_A_CODE = new Set([
  "lpg", "lpi", "lng", "cng", "gt", "gdi", "tgdi", "mpi", "dpi", "crdi", "tdi", "tsi", "tfsi",
  "wd", "awd", "fwd", "rwd", "mt", "cvt", "dct", "ev", "hev", "phev", "mhev", "amg", "vip",
  "sx", "ex", "lx", "se", "le", "gl", "gls", "lt", "ltz", "rs",
]);

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

type Entry = {
  source_value: string;
  brand: string | null;
  model: string | null;
  model_label: string;
  code: string | null;
  label_ru: string | null;
  status: "auto" | "needs_review";
  reason?: string;
  candidate_codes?: string[];
  cars: number;
};

type Row = { brand: string | null; model: string | null; generation: string; cars: number };

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin read only");
    const { rows } = await db.query<Row>(`
      select brand, model, generation, count(*)::int as cars
      from public.cars
      where is_available = true and primary_source = 'chestny_prigon' and generation is not null
      group by 1,2,3 order by 4 desc`);
    await db.query("rollback");

    const modelLabelOf = (row: Row) => normalizeModel(row.model) ?? displayModelName(row.model);
    const modelKeyOf = (row: Row) => modelLabelOf(row).toLowerCase();

    // Per-model allowlist, built only from that model's own parenthesised codes.
    const codesByModel = new Map<string, Set<string>>();
    for (const row of rows) {
      const match = row.generation.match(PARENTHESISED_CODE);
      if (!match) continue;
      const code = match[1].toUpperCase();
      if (NOT_A_CODE.has(code.toLowerCase())) continue;
      const key = modelKeyOf(row);
      const set = codesByModel.get(key) ?? new Set<string>();
      set.add(code);
      codesByModel.set(key, set);
    }

    const entries: Entry[] = [];
    for (const row of rows) {
      const modelLabel = modelLabelOf(row);
      const allowed = codesByModel.get(modelKeyOf(row)) ?? new Set<string>();
      const parenthesised = row.generation.match(PARENTHESISED_CODE)?.[1]?.toUpperCase() ?? null;
      const bare = parenthesised
        ? null
        : [...row.generation.toUpperCase().matchAll(BARE_TOKEN)].map((match) => match[1]).find((token) => allowed.has(token)) ?? null;
      const code = parenthesised ?? bare;
      const ordinal = row.generation.match(ORDINAL)?.[1] ?? null;
      const candidates = [...row.generation.toUpperCase().matchAll(BARE_TOKEN)]
        .map((match) => match[1])
        .filter((token) => !NOT_A_CODE.has(token.toLowerCase()) && token !== modelLabel.toUpperCase());

      const base = { source_value: row.generation, brand: row.brand, model: row.model, model_label: modelLabel, cars: row.cars };

      if (HANGUL.test(modelLabel)) {
        entries.push({ ...base, code, label_ru: null, status: "needs_review", reason: "model_name_not_mapped", candidate_codes: candidates });
        continue;
      }
      if (code) {
        entries.push({ ...base, code: code.toLowerCase(), label_ru: `${modelLabel} (${code})`, status: "auto" });
        continue;
      }
      if (ordinal) {
        entries.push({ ...base, code: `${slug(modelLabel)}-gen${ordinal}`, label_ru: `${modelLabel}, ${ordinal}-е поколение`, status: "auto" });
        continue;
      }
      entries.push({
        ...base, code: null, label_ru: null, status: "needs_review",
        reason: REFRESH.test(row.generation) ? "refresh_marker_without_generation" : "no_code_or_ordinal",
        candidate_codes: candidates,
      });
    }

    const auto = entries.filter((entry) => entry.status === "auto");
    const review = entries.filter((entry) => entry.status === "needs_review");
    const sum = (list: Entry[]) => list.reduce((total, entry) => total + entry.cars, 0);

    await writeFile(OUTPUT, `${JSON.stringify({
      kind: "generation_dictionary_draft",
      notAmanifest: true,
      description:
        "Draft of the generation dictionary for human review. label_ru is composed from the published Latin model name and a generation code the model's own allowlist recognises, or the ordinal the source states. Nothing is translated by guesswork; needs_review entries list the candidate codes found in the source value.",
      rules: {
        parenthesised_code: "any 2-4 character alphanumeric token in parentheses, e.g. (DN8), (JA), (8Y)",
        bare_code: "recognised only when the same model already used it in parentheses",
        ordinal: "Korean N세대 becomes \"N-е поколение\"",
        review: "no code and no ordinal, or a refresh marker that cannot name a generation",
      },
      coverage: {
        sourceValues: entries.length,
        cars: sum(entries),
        autoLabeled: auto.length,
        autoLabeledCars: sum(auto),
        needsReview: review.length,
        needsReviewCars: sum(review),
      },
      modelCodeAllowlist: Object.fromEntries([...codesByModel.entries()].map(([model, codes]) => [model, [...codes].sort()])),
      entries,
      review,
    }, null, 2)}\n`, "utf8");

    console.log(JSON.stringify({
      encarRequests: 0,
      databaseWrites: 0,
      output: OUTPUT,
      sourceValues: entries.length,
      cars: sum(entries),
      autoLabeled: auto.length,
      autoLabeledCars: sum(auto),
      needsReview: review.length,
      needsReviewCars: sum(review),
      reviewReasons: review.reduce<Record<string, number>>((map, entry) => {
        const key = entry.reason ?? "unknown";
        map[key] = (map[key] ?? 0) + 1;
        return map;
      }, {}),
      reviewWithCandidates: review.filter((entry) => (entry.candidate_codes ?? []).length).length,
      candidateSample: review.filter((entry) => (entry.candidate_codes ?? []).length).slice(0, 12)
        .map((entry) => ({ source: entry.source_value, model: entry.model, candidates: entry.candidate_codes, cars: entry.cars })),
      allowlistSize: [...codesByModel.values()].reduce((total, set) => total + set.size, 0),
    }, null, 2));
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
