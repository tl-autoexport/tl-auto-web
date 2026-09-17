import { Client } from "pg";
import { config } from "dotenv";

/**
 * Read-only inventory of the customer power table that was imported into
 * `vehicle_power_source_batches` / `vehicle_power_source_rows`.
 *
 * It answers three questions: which batches exist and what kind of source they
 * are, whether the rows carry a 30-minute electric rating at all, and what the
 * power text actually looks like.
 *
 * No Encar requests, no database writes.
 */
config({ path: ".env.local", override: true, quiet: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const bump = (map: Record<string, number>, key: string) => { map[key] = (map[key] ?? 0) + 1; };

async function main() {
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin read only");

    const batches = await db.query(`select * from public.vehicle_power_source_batches order by created_at desc`);

    const rows = await db.query(`select batch_id, source_sheet, raw_vehicle_name, raw_vin, raw_power_text, parse_status, raw_record
      from public.vehicle_power_source_rows`);

    const byBatch: Record<string, number> = {};
    const bySheet: Record<string, number> = {};
    const byParseStatus: Record<string, number> = {};
    const powerTextSamples: Array<Record<string, unknown>> = [];
    const minuteRows: Array<Record<string, unknown>> = [];
    let withVin = 0;
    let mentions30 = 0;
    let mentionsMinute = 0;
    let mentionsSystem = 0;
    let mentionsHp = 0;
    let mentionsKw = 0;

    const recordKeys: Record<string, number> = {};

    for (const row of rows.rows) {
      bump(byBatch, String(row.batch_id));
      bump(bySheet, String(row.source_sheet ?? "null"));
      bump(byParseStatus, String(row.parse_status));
      if (row.raw_vin) withVin++;

      const text = String(row.raw_power_text ?? "");
      if (/30/.test(text)) mentions30++;
      if (/мин|minute/i.test(text)) mentionsMinute++;
      if (/систем|суммарн|combined|system/i.test(text)) mentionsSystem++;
      if (/л\.?\s?с|hp|ps/i.test(text)) mentionsHp++;
      if (/кВт|kw/i.test(text)) mentionsKw++;
      if (powerTextSamples.length < 25 && text) {
        powerTextSamples.push({ vehicle: row.raw_vehicle_name, power: text, vin: row.raw_vin ? "yes" : null });
      }
      if (minuteRows.length < 40 && /мин|minute|30\s*мин|30-min/i.test(text)) {
        minuteRows.push({
          sheet: row.source_sheet,
          vehicle: row.raw_vehicle_name,
          power: text,
          record: row.raw_record,
        });
      }

      const record = (row.raw_record ?? {}) as Record<string, unknown>;
      for (const key of Object.keys(record)) bump(recordKeys, key);
    }

    const columns = await db.query(`select column_name, data_type
      from information_schema.columns
      where table_schema='public' and table_name='vehicle_power_source_rows'
      order by ordinal_position`);

    await db.query("rollback");
    console.log(JSON.stringify({
      readOnlyTransaction: true,
      encarRequests: 0,
      databaseWrites: 0,
      batches: batches.rows,
      totals: {
        rows: rows.rowCount,
        batches: batches.rowCount,
        withVin,
        parseStatus: byParseStatus,
        rawPowerTextMentions30: mentions30,
        rawPowerTextMentionsMinute: mentionsMinute,
        rawPowerTextMentionsSystem: mentionsSystem,
        rawPowerTextMentionsHp: mentionsHp,
        rawPowerTextMentionsKw: mentionsKw,
      },
      rowsByBatch: byBatch,
      rowsBySheet: bySheet,
      mostCommonRecordKeys: Object.entries(recordKeys).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([key, count]) => ({ key, count })),
      sourceRowColumns: columns.rows,
      powerTextSamples,
      minuteRows,
    }, null, 2));
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
