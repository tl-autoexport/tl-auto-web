import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

/**
 * Read-only coverage audit for the card attributes the listing sources do not
 * always provide: colour, drive and seat count. It also lists Korean-only
 * colour values that the palette does not yet translate.
 */
async function main() {
  await client.connect();
  try {
    const coverage = await client.query<{ primary_source: string; total: number; with_color: number; with_drive: number; with_seats: number }>(`
      select primary_source,
             count(*)::int as total,
             count(*) filter (where color is not null and btrim(color) <> '')::int as with_color,
             count(*) filter (where drive_type is not null and btrim(drive_type) <> '')::int as with_drive,
             count(*) filter (where vehicle_specs->>'seats' ~ '^[0-9]+$' and (vehicle_specs->>'seats')::int > 0)::int as with_seats
      from public.cars
      where is_available
        and primary_source in ('encar', 'chestny_prigon')
      group by 1
      order by 1
    `);
    const missingDrive = await client.query<{ brand: string | null; model: string | null; cards: number }>(`
      select brand, model, count(*)::int as cards
      from public.cars
      where is_available
        and primary_source in ('encar', 'chestny_prigon')
        and (drive_type is null or btrim(drive_type) = '')
      group by 1, 2
      order by cards desc, brand, model
      limit 20
    `);
    const missingColor = await client.query<{ brand: string | null; model: string | null; cards: number }>(`
      select brand, model, count(*)::int as cards
      from public.cars
      where is_available
        and primary_source in ('encar', 'chestny_prigon')
        and (color is null or btrim(color) = '')
      group by 1, 2
      order by cards desc, brand, model
      limit 20
    `);
    const koreanColors = await client.query<{ color: string; cards: number }>(`
      select color, count(*)::int as cards
      from public.cars
      where is_available
        and primary_source in ('encar', 'chestny_prigon')
        and color ~ '[가-힣]'
      group by 1
      order by cards desc, color
      limit 30
    `);
    const staging = await client.query<{ total: number; with_exterior_color: number; with_drive: number }>(`
      select count(*)::int as total,
             count(*) filter (where exterior_color is not null and btrim(exterior_color) <> '')::int as with_exterior_color,
             count(*) filter (where drive_type is not null and btrim(drive_type) <> '')::int as with_drive
      from public.chestny_catalog_staging
    `);
    const missingSeats = await client.query<{ source_id: string; brand: string | null; model: string | null; year: number | null }>(`
      select source_id, brand, model, year
      from public.cars
      where is_available
        and primary_source in ('encar', 'chestny_prigon')
        and (
          vehicle_specs->>'seats' is null
          or vehicle_specs->>'seats' !~ '^[0-9]+$'
          or (vehicle_specs->>'seats')::int <= 0
        )
      order by brand, model, year
    `);

    console.log(JSON.stringify({
      coverage: coverage.rows,
      stagingCoverage: staging.rows[0] ?? null,
      missingSeats: missingSeats.rows,
      missingDriveTopModels: missingDrive.rows,
      missingColorTopModels: missingColor.rows,
      koreanColorsNotNormalized: koreanColors.rows,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
