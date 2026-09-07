import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

type WorkbookRow = {
  sheet: string;
  rowNumber: number;
  cells: Record<string, string>;
};

const dbUrl = process.env.SUPABASE_DB_URL;
const sourceFile = process.env.VEHICLE_POWER_WORKBOOK_FILE;
const dryRun = process.env.VEHICLE_POWER_IMPORT_DRY_RUN !== "false";

if (!sourceFile) throw new Error("VEHICLE_POWER_WORKBOOK_FILE is required");
if (!dbUrl && !dryRun) throw new Error("SUPABASE_DB_URL is required when VEHICLE_POWER_IMPORT_DRY_RUN=false");

async function sha256(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function extractRows(path: string): Promise<WorkbookRow[]> {
  const extractor = resolve(process.cwd(), "scripts", "extract-vehicle-power-workbook.py");
  const child = spawn("python3", [extractor, path], { stdio: ["ignore", "pipe", "pipe"] });
  const rows: WorkbookRow[] = [];
  const errors: string[] = [];
  const lineReader = createInterface({ input: child.stdout });
  lineReader.on("line", (line) => {
    if (line.trim()) rows.push(JSON.parse(line) as WorkbookRow);
  });
  child.stderr.on("data", (chunk) => errors.push(String(chunk)));
  const exitCode = await new Promise<number | null>((done) => child.once("close", done));
  if (exitCode !== 0) throw new Error(`Workbook extraction failed: ${errors.join("").trim() || `exit ${exitCode}`}`);
  return rows;
}

function valueFromRow(row: WorkbookRow, names: string[]) {
  const normalized = Object.values(row.cells).map((value) => value.trim());
  return normalized.find((value) => names.some((name) => value.toLowerCase().includes(name))) ?? null;
}

async function main() {
  if (!sourceFile) throw new Error("VEHICLE_POWER_WORKBOOK_FILE is required");
  const absolutePath = resolve(sourceFile);
  const [fileInfo, sourceSha256, rows] = await Promise.all([stat(absolutePath), sha256(absolutePath), extractRows(absolutePath)]);
  const metadata = {
    filename: basename(absolutePath),
    bytes: fileInfo.size,
    rowCount: rows.length,
    sheets: [...new Set(rows.map((row) => row.sheet))],
    extractor: "stdlib-ooxml-v1",
  };

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, sourceSha256, metadata, sample: rows.slice(0, 3) }, null, 2));
    return;
  }

  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required when writing a source batch");
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("begin");
    const batch = await client.query<{ id: string }>(
      `insert into public.vehicle_power_source_batches
         (source_kind, source_name, source_uri, source_sha256, source_version, imported_by, metadata)
       values ('customer_workbook', $1, $2, $3, 'customer-workbook-v1', 'vehicle-power-import-v1', $4::jsonb)
       on conflict (source_kind, source_sha256) do update
         set metadata = excluded.metadata
       returning id`,
      [basename(absolutePath), `local-file:${basename(absolutePath)}`, sourceSha256, JSON.stringify(metadata)],
    );
    const batchId = batch.rows[0]?.id;
    if (!batchId) throw new Error("Source batch was not created");

    for (const row of rows) {
      const rawPowerText = valueFromRow(row, ["квт", "лс", "power", "мощ"]);
      await client.query(
        `insert into public.vehicle_power_source_rows
           (batch_id, source_sheet, source_row_number, raw_record, raw_vehicle_name, raw_vin, raw_power_text)
         values ($1, $2, $3, $4::jsonb, $5, $6, $7)
         on conflict (batch_id, source_sheet, source_row_number) do nothing`,
        [
          batchId,
          row.sheet,
          row.rowNumber,
          JSON.stringify(row.cells),
          valueFromRow(row, ["hyundai", "kia", "genesis", "lexus", "toyota", "nissan", "zeekr", "mg", "byd", "mercedes"]),
          valueFromRow(row, ["vin"]),
          rawPowerText,
        ],
      );
    }
    await client.query("commit");
    console.log(JSON.stringify({ dryRun: false, batchId, sourceSha256, metadata }, null, 2));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
