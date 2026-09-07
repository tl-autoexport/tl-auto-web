import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

type SourceRow = {
  id: string;
  source_sheet: string;
  source_row_number: number;
  raw_record: Record<string, string>;
  raw_power_text: string | null;
};

type Classification = "30_min_candidate" | "peak_or_fallback" | "range_or_ambiguous" | "non_power_note";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
const RULE_VERSION = "source-audit-v1";

function classify(row: SourceRow): Classification {
  const text = JSON.stringify(row.raw_record).toLowerCase();
  if (/30\s*[- ]?мин|30\s*min|30[- ]?minute|30минут/.test(text)) return "30_min_candidate";
  if (/пиков|peak|max(?:imum|имал)|максимак|по пиковой/.test(text)) return "peak_or_fallback";
  if (/\d+(?:[.,]\d+)?\s*[-–]\s*\d+(?:[.,]\d+)?\s*(?:квт|kw|лс|hp)|возможн|уточн|нет сбктс|нет оф|аналог/.test(text)) return "range_or_ambiguous";
  if (!row.raw_power_text || !/(?:квт|kw|лс|hp|мощ|power)/.test(text)) return "non_power_note";
  return "range_or_ambiguous";
}

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const result = await client.query<SourceRow>(
      `select id, source_sheet, source_row_number, raw_record, raw_power_text
       from public.vehicle_power_source_rows
       order by source_sheet, source_row_number`,
    );
    const counts = new Map<Classification, number>();
    const bySheet = new Map<string, Record<Classification, number>>();
    const examples = new Map<Classification, SourceRow[]>();
    for (const row of result.rows) {
      const classification = classify(row);
      counts.set(classification, (counts.get(classification) ?? 0) + 1);
      const sheetCounts = bySheet.get(row.source_sheet) ?? {
        "30_min_candidate": 0,
        "peak_or_fallback": 0,
        "range_or_ambiguous": 0,
        "non_power_note": 0,
      };
      sheetCounts[classification] += 1;
      bySheet.set(row.source_sheet, sheetCounts);
      const selected = examples.get(classification) ?? [];
      if (selected.length < 5) selected.push(row);
      examples.set(classification, selected);
    }
    await client.query("begin");
    const classifications = result.rows.map((row) => ({ id: row.id, classification: classify(row) }));
    await client.query(
      `update public.vehicle_power_source_rows as source_row
       set review_classification = classified.classification,
           classification_rule_version = $2,
           classified_at = now()
       from jsonb_to_recordset($1::jsonb) as classified(id uuid, classification text)
       where source_row.id = classified.id`,
      [JSON.stringify(classifications), RULE_VERSION],
    );
    await client.query("commit");
    console.log(JSON.stringify({
      sourceRows: result.rowCount,
      policy: {
        "30_min_candidate": "can become evidence only after document/source review",
        "peak_or_fallback": "never approve automatically",
        "range_or_ambiguous": "manual review required",
        "non_power_note": "does not contain usable power fact",
      },
      counts: Object.fromEntries(counts),
      bySheet: Object.fromEntries(bySheet),
      examples: Object.fromEntries([...examples].map(([key, rows]) => [key, rows.map((row) => ({
        id: row.id,
        sheet: row.source_sheet,
        row: row.source_row_number,
        record: row.raw_record,
      }))])),
      classificationRuleVersion: RULE_VERSION,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
