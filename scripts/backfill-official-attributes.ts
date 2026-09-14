import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
const write = process.env.OFFICIAL_ATTRIBUTES_DRY_RUN === "false";
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type Car = {
  id: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  engine_cc: number | null;
  fuel_type: string | null;
  drive_type: string | null;
  vehicle_specs: Record<string, unknown> | null;
};

type Rule = {
  brand: string;
  model: string;
  yearFrom: number;
  yearTo: number;
  engineFrom: number;
  engineTo: number;
  fuels: string[];
  value: number | "FWD";
  source: string;
  note: string;
};

// Rules are deliberately narrow. They were verified against manufacturer
// model-history/specification pages; a rule is not used for a model with
// multiple possible values unless the configuration makes the value unique.
const driveRules: Rule[] = [
  { brand: "Hyundai", model: "AVANTE", yearFrom: 2019, yearTo: 2025, engineFrom: 1570, engineTo: 1610, fuels: ["gasoline", "hybrid"], value: "FWD", source: "https://www.hyundai.com/kr/ko/brand/brandstory/heritage/2020-avante", note: "Hyundai official specifications: Avante CN7 1.6 is front-wheel drive." },
  { brand: "Hyundai", model: "Sonata", yearFrom: 2019, yearTo: 2023, engineFrom: 1980, engineTo: 2010, fuels: ["gasoline", "hybrid"], value: "FWD", source: "https://www.hyundai.com/kr/ko/brand/brandstory/model/sonata-history/2019-sonata", note: "Hyundai official specifications: Sonata DN8 2.0 gasoline/HEV is front-wheel drive." },
  { brand: "Hyundai", model: "Venue", yearFrom: 2019, yearTo: 2026, engineFrom: 1590, engineTo: 1610, fuels: ["gasoline"], value: "FWD", source: "https://www.hyundai.com/kr/ko/brand/brandstory/heritage/2019-venue-qx", note: "Hyundai official specifications: Venue 1.6 is front-wheel drive." },
  { brand: "Kia", model: "K3", yearFrom: 2021, yearTo: 2023, engineFrom: 1580, engineTo: 1610, fuels: ["gasoline"], value: "FWD", source: "https://worldwide.kia.com/ko/brand/our-brand/heritage/vehicles/all-new-k3/", note: "Kia official specifications: All-new K3 is front-wheel drive." },
  { brand: "Kia", model: "K5", yearFrom: 2019, yearTo: 2026, engineFrom: 1580, engineTo: 2010, fuels: ["gasoline", "hybrid"], value: "FWD", source: "https://worldwide.kia.com/ko/brand/our-brand/heritage/vehicles/all-new-k5-3rd-gen", note: "Kia official specifications: third-generation K5 gasoline/hybrid is front-wheel drive." },
];

const seatRules: Rule[] = [
  { brand: "Audi", model: "A3", yearFrom: 2018, yearTo: 2018, engineFrom: 1980, engineTo: 2000, fuels: ["gasoline"], value: 5, source: "https://www.audi.com/en/models/a3/a3-sedan.html", note: "Five-seat compact sedan configuration." },
  { brand: "BMW", model: "2 Series", yearFrom: 2022, yearTo: 2022, engineFrom: 1980, engineTo: 2010, fuels: ["gasoline"], value: 5, source: "https://www.bmw.com/en-au/models/2-series/gran-coupe/bmw-2-series-gran-coupe.html", note: "Five-seat Gran Coupe configuration." },
  { brand: "Hyundai", model: "AVANTE", yearFrom: 2019, yearTo: 2025, engineFrom: 1570, engineTo: 2010, fuels: ["gasoline", "hybrid"], value: 5, source: "https://www.hyundai.com/kr/ko/brand/brandstory/heritage/2020-avante", note: "Five-seat compact sedan configuration." },
  { brand: "Hyundai", model: "Casper", yearFrom: 2021, yearTo: 2023, engineFrom: 990, engineTo: 1010, fuels: ["gasoline"], value: 4, source: "https://www.hyundai.com/kr/ko/vehicles/casper", note: "Four-seat Hyundai Casper configuration." },
  { brand: "Hyundai", model: "Kona", yearFrom: 2025, yearTo: 2025, engineFrom: 1570, engineTo: 1610, fuels: ["gasoline", "hybrid"], value: 5, source: "https://www.hyundai.com/kr/ko/vehicles/the-all-new-kona", note: "Five-seat Kona configuration." },
  { brand: "Hyundai", model: "Sonata", yearFrom: 2023, yearTo: 2023, engineFrom: 1980, engineTo: 2010, fuels: ["hybrid"], value: 5, source: "https://www.hyundai.com/kr/ko/brand/brandstory/heritage/2019-sonata-hev", note: "Five-seat Sonata Hybrid configuration." },
  { brand: "Hyundai", model: "Tucson", yearFrom: 2023, yearTo: 2024, engineFrom: 1570, engineTo: 1610, fuels: ["gasoline", "hybrid"], value: 5, source: "https://www.hyundai.com/kr/ko/vehicles/tucson", note: "Five-seat Tucson configuration." },
  { brand: "Kia", model: "K5", yearFrom: 2019, yearTo: 2020, engineFrom: 1570, engineTo: 2010, fuels: ["gasoline"], value: 5, source: "https://worldwide.kia.com/ko/brand/our-brand/heritage/vehicles/all-new-k5-3rd-gen", note: "Five-seat K5 sedan configuration." },
  { brand: "Kia", model: "Morning", yearFrom: 2019, yearTo: 2019, engineFrom: 990, engineTo: 1010, fuels: ["gasoline"], value: 5, source: "https://worldwide.kia.com/ko/brand/our-brand/heritage/vehicles/morning", note: "Five-seat Morning configuration." },
  { brand: "Kia", model: "Niro", yearFrom: 2022, yearTo: 2022, engineFrom: 1570, engineTo: 1610, fuels: ["hybrid"], value: 5, source: "https://worldwide.kia.com/ko/vehicles/niro", note: "Five-seat Niro configuration." },
  { brand: "Kia", model: "Ray", yearFrom: 2019, yearTo: 2024, engineFrom: 990, engineTo: 1010, fuels: ["gasoline"], value: 5, source: "https://worldwide.kia.com/ko/vehicles/ray", note: "Five-seat Ray configuration." },
  { brand: "Kia", model: "Seltos", yearFrom: 2024, yearTo: 2024, engineFrom: 1570, engineTo: 1610, fuels: ["gasoline"], value: 5, source: "https://worldwide.kia.com/ko/vehicles/seltos", note: "Five-seat Seltos configuration." },
  { brand: "Kia", model: "Sportage", yearFrom: 2019, yearTo: 2022, engineFrom: 1570, engineTo: 1610, fuels: ["gasoline", "diesel"], value: 5, source: "https://worldwide.kia.com/ko/vehicles/sportage", note: "Five-seat Sportage configuration." },
  { brand: "Renault Korea", model: "XM3", yearFrom: 2020, yearTo: 2020, engineFrom: 1570, engineTo: 1610, fuels: ["gasoline"], value: 5, source: "https://www.renault.co.kr/vehicles/xm3.jsp", note: "Five-seat XM3 configuration." },
  { brand: "Volkswagen", model: "Tiguan", yearFrom: 2019, yearTo: 2023, engineFrom: 1950, engineTo: 1990, fuels: ["diesel"], value: 5, source: "https://www.volkswagen.co.kr/ko/models/tiguan.html", note: "Five-seat Tiguan configuration." },
];

function matches(car: Car, rule: Rule) {
  return car.brand === rule.brand && car.model === rule.model &&
    car.year != null && car.year >= rule.yearFrom && car.year <= rule.yearTo &&
    car.engine_cc != null && car.engine_cc >= rule.engineFrom && car.engine_cc <= rule.engineTo &&
    car.fuel_type != null && rule.fuels.includes(car.fuel_type);
}

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query<Car>(`
      select id, brand, model, year, engine_cc, fuel_type, drive_type, vehicle_specs
      from public.cars
      where primary_source = 'chestny_prigon' and is_available = true
    `);
    const driveUpdates = rows.filter((car) => !car.drive_type).flatMap((car) => {
      const rule = driveRules.find((candidate) => matches(car, candidate));
      return rule ? [{ id: car.id, value: rule.value as string, source: rule.source, note: rule.note }] : [];
    });
    const seatUpdates = rows.filter((car) => !Number(car.vehicle_specs?.seats)).flatMap((car) => {
      const rule = seatRules.find((candidate) => matches(car, candidate));
      return rule ? [{ id: car.id, value: rule.value as number, source: rule.source, note: rule.note }] : [];
    });

    if (write) {
      await client.query("begin");
      try {
        await client.query(`
          update public.cars as c
          set drive_type = v.drive_type,
              vehicle_specs = coalesce(c.vehicle_specs,'{}'::jsonb) || jsonb_build_object(
                'drive_source','official_manufacturer',
                'drive_source_url',v.source,
                'drive_resolution_note',v.note
              ),
              updated_at = now()
          from jsonb_to_recordset($1::jsonb) as v(id uuid, drive_type text, source text, note text)
          where c.id = v.id and (c.drive_type is null or btrim(c.drive_type)='')
        `, [JSON.stringify(driveUpdates.map((item) => ({ id: item.id, drive_type: item.value, source: item.source, note: item.note })))]);
        await client.query(`
          update public.cars as c
          set vehicle_specs = coalesce(c.vehicle_specs,'{}'::jsonb) || jsonb_build_object(
                'seats',v.seats,
                'seats_source','official_manufacturer',
                'seats_source_url',v.source,
                'seats_resolution_note',v.note
              ),
              updated_at = now()
          from jsonb_to_recordset($1::jsonb) as v(id uuid, seats integer, source text, note text)
          where c.id = v.id and (
            c.vehicle_specs->>'seats' is null or c.vehicle_specs->>'seats' !~ '^[0-9]+$'
            or (c.vehicle_specs->>'seats')::int <= 0
          )
        `, [JSON.stringify(seatUpdates.map((item) => ({ id: item.id, seats: item.value, source: item.source, note: item.note })))]);
        await client.query("commit");
      } catch (error) { await client.query("rollback"); throw error; }
    }
    console.log(JSON.stringify({ dryRun: !write, driveUpdates: driveUpdates.length, seatUpdates: seatUpdates.length, remainingDrive: rows.filter((car) => !car.drive_type).length - driveUpdates.length, remainingSeats: rows.filter((car) => !Number(car.vehicle_specs?.seats)).length - seatUpdates.length, encarRequests: 0 }, null, 2));
  } finally { await client.end(); }
}

main().catch((error) => { console.error(error); process.exit(1); });
