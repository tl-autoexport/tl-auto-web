import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

type HarEntry = {
  request: { url: string };
  response?: { content?: { text?: string } };
};

type HarFile = { log: { entries: HarEntry[] } };

const dbUrl = process.env.SUPABASE_DB_URL;
const sourceFile = process.env.TKS_HAR_FILE;
const dryRun = process.env.TKS_HAR_IMPORT_DRY_RUN !== "false";

if (!sourceFile) throw new Error("TKS_HAR_FILE is required");
if (!dbUrl && !dryRun) throw new Error("SUPABASE_DB_URL is required when TKS_HAR_IMPORT_DRY_RUN=false");

function parseRussianNumber(value: string | undefined) {
  if (!value) return null;
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function ageBand(age: string) {
  if (age === "3") return "under_3";
  if (age === "35") return "from_3_to_5";
  if (age === "57") return "from_5_to_7";
  if (age === "7") return "over_7";
  throw new Error(`Unsupported TKS age code: ${age}`);
}

function propulsionType(engineType: string, sequential: string) {
  if (engineType === "electric") return "electric";
  if (sequential === "true") return "hybrid_sequential";
  if (engineType === "petrol_electric" || engineType === "diesel_electric") return "hybrid_parallel";
  return "ice";
}

function htmlToText(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
}

function payment(text: string, label: string) {
  // The response has already been converted from HTML to plain text, so all
  // markup and non-breaking spaces become ordinary whitespace here.
  const expression = new RegExp(`${label}\\s+20000 руб\\. x ([0-9.,]+)\\s+([0-9 ]+) руб`, "i");
  const match = expression.exec(text);
  return match ? { coefficient: parseRussianNumber(match[1]), rub: parseRussianNumber(match[2]) } : null;
}

function paymentAmount(text: string, label: string) {
  const start = text.toLowerCase().indexOf(label.toLowerCase());
  if (start < 0) return null;
  const fragment = text.slice(start, start + 260);
  // Require whitespace/start before the amount. Without this guard the `3`
  // in `евро/см3 538 551.94 руб.` was incorrectly joined to the duty amount.
  const amounts = [...fragment.matchAll(/(?:^|\s)([0-9][0-9 ]*(?:[.,][0-9]+)?)\s+руб\./gi)]
    .map((match) => parseRussianNumber(match[1]));
  return amounts.at(0) ?? null;
}

function sanitizeQuery(url: URL) {
  const allowed = [
    "cost", "volume", "currency", "power", "power_edizm", "country", "engine_type", "age", "face", "ts_type",
    "mdvs_gt_m30ed", "sequential", "power_hybrid_dvs", "power_hybrid_dvs_edizm", "power_hybrid_electro", "power_hybrid_electro_edizm",
  ];
  return Object.fromEntries(allowed.map((key) => [key, url.searchParams.get(key) ?? ""]));
}

async function main() {
  if (!sourceFile) throw new Error("TKS_HAR_FILE is required");
  const path = resolve(sourceFile);
  const file = JSON.parse(await readFile(path, "utf8")) as HarFile;
  const bytes = await readFile(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const entries = file.log.entries.filter((entry) => entry.request.url.startsWith("https://www.tks.ru/auto/calc/?"));
  const controls = entries.map((entry, index) => {
    const url = new URL(entry.request.url);
    const query = sanitizeQuery(url);
    const resultText = htmlToText(entry.response?.content?.text ?? "");
    const util = payment(resultText, "Утилизационный сбор");
    return {
      index,
      query,
      util,
      customsFeeRub: paymentAmount(resultText, "Таможенное оформление"),
      dutyRub: paymentAmount(resultText, "Пошлина") ?? paymentAmount(resultText, "Единая ставка"),
      resultText,
    };
  });

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, filename: basename(path), sha256, controls: controls.map(({ index, query, util }) => ({ index, query, util })) }, null, 2));
    return;
  }
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required when writing controls");
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("begin");
    const batchResult = await client.query<{ id: string }>(
      `insert into public.vehicle_power_source_batches
        (source_kind, source_name, source_uri, source_sha256, source_version, imported_by, metadata)
       values ('tks_har', $1, $2, $3, 'tks-control-har-v1', 'tks-control-import-v1', $4::jsonb)
       on conflict (source_kind, source_sha256) do update set metadata = excluded.metadata
       returning id`,
      [basename(path), `local-file:${basename(path)}`, sha256, JSON.stringify({ controlCount: controls.length, parser: "tks-control-har-v1" })],
    );
    const batchId = batchResult.rows[0]?.id;
    if (!batchId) throw new Error("TKS HAR source batch was not created");

    for (const control of controls) {
      const sourceRow = await client.query<{ id: string }>(
        `insert into public.vehicle_power_source_rows
          (batch_id, source_sheet, source_row_number, raw_record, raw_power_text, parse_status)
         values ($1, 'tks_calc', $2, $3::jsonb, $4, 'parsed')
         on conflict (batch_id, source_sheet, source_row_number) do update
           set raw_record = excluded.raw_record, raw_power_text = excluded.raw_power_text
         returning id`,
        [batchId, control.index + 1, JSON.stringify({ query: control.query, resultText: control.resultText }), control.query.power],
      );
      const sourceRowId = sourceRow.rows[0]?.id;
      if (!sourceRowId) throw new Error("TKS HAR source row was not created");
      const query = control.query;
      await client.query(
        `insert into public.tks_calculation_controls
          (source_row_id, vehicle_category, propulsion_type, importer_type, age_code, age_band,
           cost_amount, currency_code, engine_cc, power_hp, power_kw, hybrid_dvs_power_kw, hybrid_electric_power_kw_30min,
         observed_util_coefficient, observed_util_rub, observed_customs_fee_rub, observed_duty_rub, response_snapshot)
         values ($1, 'M1', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
         on conflict (source_row_id) do update set
           vehicle_category = excluded.vehicle_category,
           propulsion_type = excluded.propulsion_type,
           importer_type = excluded.importer_type,
           age_code = excluded.age_code,
           age_band = excluded.age_band,
           cost_amount = excluded.cost_amount,
           currency_code = excluded.currency_code,
           engine_cc = excluded.engine_cc,
           power_hp = excluded.power_hp,
           power_kw = excluded.power_kw,
           hybrid_dvs_power_kw = excluded.hybrid_dvs_power_kw,
           hybrid_electric_power_kw_30min = excluded.hybrid_electric_power_kw_30min,
           observed_util_coefficient = excluded.observed_util_coefficient,
           observed_util_rub = excluded.observed_util_rub,
           observed_customs_fee_rub = excluded.observed_customs_fee_rub,
           observed_duty_rub = excluded.observed_duty_rub,
           response_snapshot = excluded.response_snapshot`,
        [
          sourceRowId,
          propulsionType(query.engine_type, query.sequential),
          query.face === "nat" ? "individual" : "legal_entity",
          query.age,
          ageBand(query.age),
          parseRussianNumber(query.cost),
          query.currency,
          parseRussianNumber(query.volume),
          query.power_edizm === "ls" ? parseRussianNumber(query.power) : null,
          query.power_edizm === "kvt" ? parseRussianNumber(query.power) : null,
          query.power_hybrid_dvs_edizm === "kvt" ? parseRussianNumber(query.power_hybrid_dvs) : null,
          query.power_hybrid_electro_edizm === "kvt" ? parseRussianNumber(query.power_hybrid_electro) : null,
          control.util?.coefficient ?? null,
          control.util?.rub ?? null,
          control.customsFeeRub == null ? null : Math.round(control.customsFeeRub),
          control.dutyRub,
          JSON.stringify({ resultText: control.resultText, query }),
        ],
      );
    }
    await client.query("commit");
    console.log(JSON.stringify({ dryRun: false, batchId, filename: basename(path), sha256, controlsImported: controls.length }, null, 2));
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
