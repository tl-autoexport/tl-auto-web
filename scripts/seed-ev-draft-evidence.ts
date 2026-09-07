import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const targets = [
  { key: "hyundai-kona-electric", brand: "Hyundai", model: "Kona Electric", pattern: /hyundai[\s_-]+kona[\s_-]+electric/i },
  { key: "tesla-model-3", brand: "Tesla", model: "Model 3", pattern: /tesla\s+model\s*3/i },
  { key: "kia-ev9", brand: "Kia", model: "EV9", pattern: /kia\s*ev\s*9/i },
  { key: "kia-niro-ev", brand: "Kia", model: "Niro EV", pattern: /kia\s+niro\s+ev/i },
];

function cells(row: Record<string, unknown>) {
  return Object.values(row).filter((value): value is string => typeof value === "string").join(" ");
}

function powerKw(text: string) {
  const match = /([0-9]+(?:[.,][0-9]+)?)\s*квт/i.exec(text);
  return match ? Number(match[1].replace(",", ".")) : null;
}

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const rows = await client.query<{ id: string; source_sheet: string; source_row_number: number; raw_record: Record<string, unknown> }>(
      `select id, source_sheet, source_row_number, raw_record
       from public.vehicle_power_source_rows
       where raw_record is not null
         and source_sheet <> 'tks_calc'
       order by source_sheet, source_row_number`,
    );
    const candidates: Array<{ target: typeof targets[number]; sourceRowId: string; sheet: string; row: number; text: string; power: number }> = [];
    for (const row of rows.rows) {
      const text = cells(row.raw_record);
      const target = targets.find((item) => item.pattern.test(text));
      const power = powerKw(text);
      if (target && power && /30\s*мин|30[- ]?minute/i.test(text)) candidates.push({ target, sourceRowId: row.id, sheet: row.source_sheet, row: row.source_row_number, text, power });
    }

    await client.query("begin");
    for (const candidate of candidates) {
      const batch = await client.query<{ id: string }>(
        `select batch_id as id from public.vehicle_power_source_rows where id = $1`,
        [candidate.sourceRowId],
      );
      await client.query(
        `insert into public.vehicle_power_evidence
          (batch_id, source_row_id, source_kind, source_uri, document_reference,
           vehicle_category, brand, model, propulsion_type, electric_power_kw_30min,
           source_units, reliability, review_status, review_note)
         values ($1, $2, 'customer_workbook', 'local-file:Список 30-минуток по маркам (2).xlsx', $3,
                 'M1', $4, $5, 'electric', $6, 'kW (workbook note)', 'low', 'draft',
                 'Черновая запись из рабочей таблицы; требуется подтверждение SBKTS/EPTS/OTTS или документом производителя.')
         on conflict do nothing`,
        [batch.rows[0]?.id, candidate.sourceRowId, `${candidate.sheet} row ${candidate.row}`, candidate.target.brand, candidate.target.model, candidate.power],
      );
    }
    await client.query("commit");
    console.log(JSON.stringify({
      createdDrafts: candidates.length,
      candidates: candidates.map(({ target, sheet, row, power }) => ({ model: target.model, sheet, row, electricPowerKw30min: power })),
      notFound: targets.filter((target) => !candidates.some((candidate) => candidate.target.key === target.key)).map((target) => target.model),
      status: "draft_only",
    }, null, 2));
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
