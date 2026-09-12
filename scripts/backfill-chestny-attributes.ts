import { Client } from "pg";
import { config } from "dotenv";
import { normalizeColor, normalizeDrive } from "../src/server/normalization/vehicles";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const write = process.env.CHESTNY_ATTR_BACKFILL_DRY_RUN === "false";
const force = process.env.CHESTNY_ATTR_BACKFILL_FORCE === "true";
const batchSize = 500;
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

type StagingRow = {
  source_listing_id: string;
  exterior_color: string | null;
  drive_type: string | null;
  trim: string | null;
  generation: string | null;
};

/**
 * Copies colour and drive from the Chesty source staging into the published
 * cards. Values are normalized in Node (Korean palette and axle words), so the
 * database only ever receives a display-ready value. Existing card values are
 * preserved unless CHESTNY_ATTR_BACKFILL_FORCE=true.
 */
async function main() {
  await client.connect();
  try {
    const { rows } = await client.query<StagingRow>(`
      select s.source_listing_id, s.exterior_color, s.drive_type, s.trim, s.generation
      from public.chestny_catalog_staging s
      join public.cars c
        on c.primary_source = 'chestny_prigon'
       and c.source_id = s.source_listing_id
      order by s.source_listing_id
    `);

    const updates = rows
      .map((row) => ({
        sourceId: row.source_listing_id,
        color: normalizeColor(row.exterior_color),
        drive: normalizeDrive(
          [row.drive_type, row.trim, row.generation]
            .filter((value): value is string => typeof value === "string" && value.trim() !== "")
            .join(" "),
        ),
      }))
      .filter((update) => update.color || update.drive);

    let touched = 0;
    if (write) {
      const sql = force
        ? `
          update public.cars as c
          set color = coalesce(v.color, c.color),
              drive_type = coalesce(v.drive, c.drive_type)
          from unnest($1::text[], $2::text[], $3::text[]) as v(source_id, color, drive)
          where c.primary_source = 'chestny_prigon'
            and c.source_id = v.source_id
            and (v.color is not null or v.drive is not null)
        `
        : `
          update public.cars as c
          set color = coalesce(c.color, v.color),
              drive_type = coalesce(c.drive_type, v.drive)
          from unnest($1::text[], $2::text[], $3::text[]) as v(source_id, color, drive)
          where c.primary_source = 'chestny_prigon'
            and c.source_id = v.source_id
            and (
              (v.color is not null and (c.color is null or btrim(c.color) = ''))
              or (v.drive is not null and (c.drive_type is null or btrim(c.drive_type) = ''))
            )
        `;
      for (let offset = 0; offset < updates.length; offset += batchSize) {
        const batch = updates.slice(offset, offset + batchSize);
        const result = await client.query(sql, [
          batch.map((u) => u.sourceId),
          batch.map((u) => u.color),
          batch.map((u) => u.drive),
        ]);
        touched += result.rowCount ?? 0;
      }
    }

    console.log(JSON.stringify({
      write,
      force,
      publishedCardsJoined: rows.length,
      candidatesWithSourceAttribute: updates.length,
      rowsTouched: touched,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
