import { writeFile } from "node:fs/promises";
import { Client } from "pg";
import { config } from "dotenv";
import { displayModelName } from "../src/server/catalog/display-model";
import { normalizeModel } from "../src/server/normalization/vehicles";

/**
 * Drafts the generation dictionary for review.
 *
 * The label is never invented: it is composed from facts we already hold —
 * the Latin model name we publish and the generation code or ordinal that the
 * source string carries. Anything the rules cannot label goes to the review
 * list instead of getting a guessed name.
 *
 * The draft is data for a human review, not a runtime source.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const OUTPUT = process.env.GENERATION_DICTIONARY_OUTPUT ?? "docs/generation-dictionary-draft.json";

const PARENTHESISED_CODE = /\(([A-Z]{1,4}\d{1,4}[A-Z]{0,2})\)/;
const BARE_CODE = /\b([A-Z]{1,3}\d{2,4}[A-Z]{0,2})\b/;
const ORDINAL = /(\d+)\s*세대/;
const REFRESH = /더 뉴|페이스리프트|신형|부분변경/;
const HANGUL = /[\u3131-\u318E\uAC00-\uD7A3]/;

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
  cars: number;
};

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin read only");
    const { rows } = await db.query<{ brand: string | null; model: string | null; generation: string; cars: number }>(`
      select brand, model, generation, count(*)::int as cars
      from public.cars
      where is_available = true and primary_source = 'chestny_prigon' and generation is not null
      group by 1,2,3 order by 4 desc`);
    await db.query("rollback");

    const entries: Entry[] = [];
    for (const row of rows) {
      const modelLabel = normalizeModel(row.model) ?? displayModelName(row.model);
      const code = (row.generation.match(PARENTHESISED_CODE)?.[1] ?? row.generation.match(BARE_CODE)?.[1] ?? null)?.toUpperCase() ?? null;
      const ordinal = row.generation.match(ORDINAL)?.[1] ?? null;

      if (HANGUL.test(modelLabel)) {
        entries.push({ source_value: row.generation, brand: row.brand, model: row.model, model_label: modelLabel,
          code, label_ru: null, status: "needs_review", reason: "model_name_not_mapped", cars: row.cars });
        continue;
      }
      if (code) {
        entries.push({ source_value: row.generation, brand: row.brand, model: row.model, model_label: modelLabel,
          code: code.toLowerCase(), label_ru: `${modelLabel} (${code})`, status: "auto", cars: row.cars });
        continue;
      }
      if (ordinal) {
        entries.push({ source_value: row.generation, brand: row.brand, model: row.model, model_label: modelLabel,
          code: `${slug(modelLabel)}-gen${ordinal}`, label_ru: `${modelLabel}, ${ordinal}-е поколение`, status: "auto", cars: row.cars });
        continue;
      }
      entries.push({ source_value: row.generation, brand: row.brand, model: row.model, model_label: modelLabel,
        code: null, label_ru: null, status: "needs_review",
        reason: REFRESH.test(row.generation) ? "refresh_marker_without_generation" : "no_code_or_ordinal", cars: row.cars });
    }

    const auto = entries.filter((entry) => entry.status === "auto");
    const review = entries.filter((entry) => entry.status === "needs_review");

    await writeFile(OUTPUT, `${JSON.stringify({
      kind: "generation_dictionary_draft",
      notAmanifest: true,
      description:
        "Draft of the generation dictionary for human review. label_ru is composed from the published Latin model name and the generation code or ordinal found in the source value; nothing is translated by guesswork. Entries with status needs_review require a manual decision.",
      rules: {
        code: "parenthesised or bare generation code, uppercased",
        ordinal: "Korean N세대 becomes \"N-е поколение\"",
        refresh: "더 뉴 / 페이스리프트 / 신형 / 부분변경 cannot name a generation on their own",
      },
      coverage: {
        sourceValues: entries.length,
        cars: entries.reduce((sum, entry) => sum + entry.cars, 0),
        autoLabeled: auto.length,
        autoLabeledCars: auto.reduce((sum, entry) => sum + entry.cars, 0),
        needsReview: review.length,
        needsReviewCars: review.reduce((sum, entry) => sum + entry.cars, 0),
      },
      entries,
      review,
    }, null, 2)}\n`, "utf8");

    console.log(JSON.stringify({
      encarRequests: 0,
      databaseWrites: 0,
      output: OUTPUT,
      sourceValues: entries.length,
      cars: entries.reduce((sum, entry) => sum + entry.cars, 0),
      autoLabeled: auto.length,
      autoLabeledCars: auto.reduce((sum, entry) => sum + entry.cars, 0),
      needsReview: review.length,
      needsReviewCars: review.reduce((sum, entry) => sum + entry.cars, 0),
      reviewReasons: review.reduce<Record<string, number>>((map, entry) => {
        const key = entry.reason ?? "unknown";
        map[key] = (map[key] ?? 0) + 1;
        return map;
      }, {}),
      reviewSample: review.slice(0, 15).map((entry) => ({ source: entry.source_value, model: entry.model, reason: entry.reason, cars: entry.cars })),
      autoSample: auto.slice(0, 12).map((entry) => ({ source: entry.source_value, label_ru: entry.label_ru, code: entry.code })),
    }, null, 2));
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
