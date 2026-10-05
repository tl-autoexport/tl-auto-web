import { config } from "dotenv";
import { Client } from "pg";
import { readFile, writeFile } from "node:fs/promises";
import { resolveAutomaticPowerReference } from "../src/server/catalog/automatic-power-reference";
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
(async () => {
  const plan = JSON.parse(
    await readFile("output/encar-859a-after-research.json", "utf8"),
  );
  const db = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  try {
    const refs = (
      await db.query(
        "select * from public.vehicle_power_automatic_reference where status='automatic'",
      )
    ).rows;
    const results = plan.candidates.map(
      (r: {
        sourceListingId: string;
        status: string;
        configuration: Record<string, unknown>;
      }) => {
        const c = r.configuration;
        const ref = resolveAutomaticPowerReference(
          {
            brand: String(c.brand),
            model: String(c.model),
            fuel_type: String(c.fuelType),
            engine_cc: Number(c.engineCc),
            drive_type: c.driveType == null ? null : String(c.driveType),
            badge: c.badge == null ? null : String(c.badge),
            badge_detail: c.trim == null ? null : String(c.trim),
            year: Number(c.year),
            source_listing_id: r.sourceListingId,
          },
          refs,
        );
        return {
          sourceListingId: r.sourceListingId,
          status:
            r.status === "approved_match"
              ? "approved"
              : r.status === "ambiguous"
                ? "ambiguous"
                : ref
                  ? "preliminary"
                  : "unresolved",
          powerHp: ref?.power_hp,
        };
      },
    );
    const counts = results.reduce(
      (a: Record<string, number>, r: { status: string }) => {
        a[r.status] = (a[r.status] ?? 0) + 1;
        return a;
      },
      {},
    );
    const result = {
      runId: plan.runId,
      total: results.length,
      counts,
      results,
    };
    await writeFile(
      "output/encar-859a-final-power-coverage.json",
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(
      JSON.stringify(
        { runId: plan.runId, total: results.length, counts },
        null,
        2,
      ),
    );
  } finally {
    await db.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
