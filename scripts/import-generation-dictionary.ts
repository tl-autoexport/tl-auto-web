import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { config } from "dotenv";

/**
 * Imports the reviewed generation dictionary and resolves `cars.generation_code`.
 *
 * Guarantees enforced before anything is written:
 *   - one source value maps to exactly one code (the table's unique index);
 *   - one code never carries two different labels within the same model. A code
 *     may repeat across source spellings (투싼 (NX4) and 더 뉴 투싼 (NX4)), but
 *     the label must be identical, otherwise the import stops.
 *
 * The normalized comparison strips case, spaces, brackets and punctuation while
 * keeping letters of any script, so Korean source values compare reliably. The
 * same expression is used by the generated columns of the table.
 *
 * Read-only by default; set GENERATION_DICTIONARY_WRITE=true to apply.
 * No Encar requests.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
const write = process.env.GENERATION_DICTIONARY_WRITE === "true";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const INPUT = process.env.GENERATION_DICTIONARY_INPUT ?? "docs/generation-dictionary-draft.json";

/** Must stay identical to the generated key columns in the migration. */
const NORMALIZE_PATTERN = String.raw`[\s()[\]{}_\-/\\.,]+`;

type DraftEntry = {
  source_value: string;
  brand: string | null;
  model: string | null;
  label_ru: string | null;
  code: string | null;
  provenance: string | null;
  status: "auto" | "needs_review";
  cars: number;
};

type Draft = {
  entries: DraftEntry[];
  review: DraftEntry[];
  rejected: Array<{ source_value: string; model: string | null; code: string | null; cars: number }>;
};

type NormalizedRow = {
  brand: string; model: string; source_value: string; code: string | null;
  label_ru: string | null; provenance: string | null; cars: number; status: "approved" | "review" | "rejected";
};

const normalizeKey = (value: string | null | undefined) =>
  (value ?? "").toLowerCase().replace(/[\s()[\]{}_\-/\\.,]+/g, "");

/** A code may repeat across spellings, but never with two different labels. */
function findCodeLabelConflicts(rows: NormalizedRow[]) {
  const labelsByCode = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.code) continue;
    const key = `${normalizeKey(row.brand)}|${normalizeKey(row.model)}|${row.code}`;
    const labels = labelsByCode.get(key) ?? new Set<string>();
    labels.add(row.label_ru ?? "<null>");
    labelsByCode.set(key, labels);
  }
  return [...labelsByCode.entries()].filter(([, labels]) => labels.size > 1);
}

async function main() {
  const draft = JSON.parse(await readFile(INPUT, "utf8")) as Draft;

  // `entries` already contains every reviewed value, so the status comes from
  // the entry itself; `review` is the same rows and must not be counted twice.
  const rows: NormalizedRow[] = [
    ...draft.entries.map((entry) => ({
      ...entry, brand: entry.brand ?? "", model: entry.model ?? "",
      status: entry.status === "auto" ? ("approved" as const) : ("review" as const),
    })),
    ...draft.rejected.map((entry) => ({
      brand: "", model: entry.model ?? "", source_value: entry.source_value,
      code: null, label_ru: null, provenance: null, cars: entry.cars, status: "rejected" as const,
    })),
  ];

  const conflicts = findCodeLabelConflicts(rows);
  if (conflicts.length) {
    throw new Error(`A code carries different labels within a model: ${conflicts.map(([key, labels]) => `${key} -> ${[...labels].join(" / ")}`).join("; ")}`);
  }

  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    let written = 0;
    let resolvedCars = 0;
    const auditedAt = new Date().toISOString();

    if (write) {
      await db.query("begin");
      try {
        for (const row of rows) {
          const result = await db.query(
            `insert into public.catalog_generation_dictionary
               (brand, model, source_value, code, label_ru, provenance, status, cars_count, audited_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz)
             on conflict (brand_key, model_key, source_key) do update set
               code=excluded.code, label_ru=excluded.label_ru, provenance=excluded.provenance,
               status=excluded.status, cars_count=excluded.cars_count, audited_at=excluded.audited_at, updated_at=now()`,
            [row.brand, row.model, row.source_value, row.code, row.label_ru, row.provenance, row.status, row.cars, auditedAt],
          );
          written += result.rowCount ?? 0;
        }

        const resolved = await db.query(
          `update public.cars c
              set generation_code = d.code, updated_at = now()
             from public.catalog_generation_dictionary d
            where d.status = 'approved' and d.code is not null
              and lower(regexp_replace(c.brand, $1, '', 'g')) = d.brand_key
              and lower(regexp_replace(c.model, $1, '', 'g')) = d.model_key
              and lower(regexp_replace(c.generation, $1, '', 'g')) = d.source_key
              and c.is_available = true and c.generation is not null
              and c.generation_code is distinct from d.code`,
          [NORMALIZE_PATTERN],
        );
        resolvedCars = resolved.rowCount ?? 0;
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }

    console.log(JSON.stringify({
      dryRun: !write,
      input: INPUT,
      draftApproved: draft.entries.length,
      draftReview: draft.review.length,
      draftRejected: draft.rejected.length,
      codeLabelConflicts: 0,
      dictionaryRowsWritten: write ? written : null,
      dictionaryRowsPlanned: rows.length,
      resolvedCars,
      encarRequests: 0,
    }, null, 2));
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
