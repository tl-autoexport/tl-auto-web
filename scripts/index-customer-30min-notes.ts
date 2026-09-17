import { readFile, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { config } from "dotenv";

/**
 * Indexes the customer's free-text remarks about the 30-minute electric rating
 * into a separate reference file with a pointer back to the source row.
 *
 * The customer table has no structured column for this rating: out of 8,204
 * rows only a few dozen mention it, as manual expert answers. This script turns
 * those notes into a reviewable artefact so a rule can cite a concrete source
 * (batch, sheet, row) instead of an anonymous claim.
 *
 * The output is deliberately not a manifest: the importer only reads manifest
 * files, so this file cannot be imported by accident.
 *
 * Read-only against the database. Writes only the reference file.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const OUTPUT = "data/power-reference/expert-30min-notes-v1.json";

type Note = {
  source: { batchId: string; sheet: string | null; rowNumber: number | null };
  subject: string | null;
  text: string;
  kilowatts: number | null;
  hp: number | null;
  qualifiers: string[];
};

const KW_TO_PS = 1.359621617;

function parseNote(text: string): { kilowatts: number | null; qualifiers: string[] } {
  const kwMatch = text.match(/([0-9]{1,3}(?:[.,][0-9]+)?)\s*(?:квт|kw)/i);
  const kilowatts = kwMatch ? Number(kwMatch[1].replace(",", ".")) : null;
  const qualifiers: string[] = [];
  if (/электро(двигател)?/i.test(text)) qualifiers.push("electric_motor");
  if (/последовательн/i.test(text)) qualifiers.push("sequential_hybrid_as_electric");
  if (/максимак|максим/i.test(text)) qualifiers.push("use_peak_instead");
  if (/сбктс|лаборатор|лабы|уточн|шилдик/i.test(text)) qualifiers.push("needs_confirmation");
  if (/совокупн|суммарн/i.test(text)) qualifiers.push("combined_with_ice");
  return { kilowatts, qualifiers };
}

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin read only");
    const rows = await db.query(`select batch_id, source_sheet, source_row_number, raw_vehicle_name, raw_power_text
      from public.vehicle_power_source_rows
      where raw_power_text is not null and (raw_power_text ~* 'мин')`);
    await db.query("rollback");

    const notes: Note[] = rows.rows.map((row) => {
      const text = String(row.raw_power_text);
      const parsed = parseNote(text);
      return {
        source: { batchId: row.batch_id, sheet: row.source_sheet, rowNumber: row.source_row_number },
        subject: row.raw_vehicle_name,
        text,
        kilowatts: parsed.kilowatts,
        hp: parsed.kilowatts == null ? null : Math.round(parsed.kilowatts * KW_TO_PS),
        qualifiers: parsed.qualifiers,
      };
    });

    const byQualifier: Record<string, number> = {};
    for (const note of notes) {
      for (const qualifier of note.qualifiers) byQualifier[qualifier] = (byQualifier[qualifier] ?? 0) + 1;
    }

    const existing = await readFile(OUTPUT, "utf8").then(() => true).catch(() => false);
    const payload = {
      kind: "expert_notes",
      notAmanifest: true,
      description:
        "Free-text customer remarks about the 30-minute electric rating. Not importable: the importer reads manifests only. Each note points back to a source row so a rule can cite it. WARNING: `kilowatts` is the first kW figure found in the text; when a note discusses several variants it may belong to another one (the Nissan Serena note quotes 110 kW for the non-hybrid while the 30-minute value is 70 kW). Always re-read `text` before using a value.",
      generatedFrom: "public.vehicle_power_source_rows",
      notes,
    };
    await writeFile(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    console.log(JSON.stringify({
      encarRequests: 0,
      databaseWrites: 0,
      notesIndexed: notes.length,
      withKilowatts: notes.filter((note) => note.kilowatts != null).length,
      byQualifier,
      output: OUTPUT,
      overwritten: existing,
      preview: notes.slice(0, 8).map((note) => ({ subject: note.subject, keywords: note.qualifiers, kw: note.kilowatts })),
    }, null, 2));
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
