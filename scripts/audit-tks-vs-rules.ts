import { Client } from "pg";
import { config } from "dotenv";
import { tksUtilCoefficient, tksUtilCoefficientKwForPropulsion } from "../src/server/calc/tks-rules";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

const KW_PER_HP = 0.73549875;
function number(value: string | number | null | undefined) {
  if (!value) return null;
  const n = typeof value === "number" ? value : Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

type Control = {
  id: string;
  propulsion_type: "ice" | "electric" | "hybrid_parallel" | "hybrid_sequential";
  age_code: string;
  engine_cc: number | null;
  power_hp: number | null;
  power_kw: number | null;
  hybrid_dvs_power_kw: number | null;
  hybrid_electric_power_kw_30min: number | null;
  observed_util_coefficient: number;
  response_snapshot: { query?: Record<string, string> };
};

function ageGroup(ageCode: string) {
  return ageCode === "3" ? "under_3" as const : "older" as const;
}

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const result = await client.query<Control>(
      `select id, propulsion_type, age_code, engine_cc, power_hp, power_kw,
              hybrid_dvs_power_kw, hybrid_electric_power_kw_30min,
              observed_util_coefficient, response_snapshot
       from public.tks_calculation_controls
       where review_status <> 'rejected'
       order by created_at, id`,
    );
    const compared: Array<{ id: string; propulsion: string; observed: number; expected: number; powerKw: number | null; powerHp: number; engineCc: number | null }> = [];
    const pending: Record<string, number> = {};
    const invalid: Array<{ id: string; reason: string }> = [];
    for (const control of result.rows) {
      if (control.propulsion_type === "ice" && control.engine_cc != null && control.engine_cc > 3500 && Number(control.observed_util_coefficient) === 0.26) {
        invalid.push({ id: control.id, reason: "TKS HAR returned the <=160 hp fallback for an ICE vehicle above 3500 cm³; control is malformed" });
        continue;
      }
      const engineCcRequired = control.propulsion_type === "ice" || control.propulsion_type === "hybrid_parallel";
      if ((engineCcRequired && control.engine_cc == null) || control.observed_util_coefficient == null) {
        pending[control.propulsion_type] = (pending[control.propulsion_type] ?? 0) + 1;
        continue;
      }
      const query = control.response_snapshot?.query ?? {};
      let powerHp: number | null = control.power_hp;
      if (powerHp == null && control.power_kw != null) powerHp = control.power_kw / KW_PER_HP;
      let powerKw: number | null = control.power_kw;
      if (control.propulsion_type === "hybrid_parallel") {
        const dvs = number(control.hybrid_dvs_power_kw)
          ?? (query.power_hybrid_dvs_edizm === "ls" ? (number(query.power_hybrid_dvs) == null ? null : number(query.power_hybrid_dvs)! * KW_PER_HP) : number(query.power_hybrid_dvs));
        const electric = number(control.hybrid_electric_power_kw_30min)
          ?? (query.power_hybrid_electro_edizm === "kvt" ? number(query.power_hybrid_electro) : query.power_hybrid_electro_edizm === "ls" ? (number(query.power_hybrid_electro) == null ? null : number(query.power_hybrid_electro)! * KW_PER_HP) : null);
        if (dvs != null && electric != null) powerKw = dvs + electric;
      }
      if (control.propulsion_type === "hybrid_parallel" && powerKw != null) {
        powerHp = powerKw / KW_PER_HP;
      }
      if (powerHp == null) {
        pending[control.propulsion_type] = (pending[control.propulsion_type] ?? 0) + 1;
        continue;
      }
      const expected = powerKw != null
        ? tksUtilCoefficientKwForPropulsion(powerKw, control.engine_cc ?? 0, ageGroup(control.age_code), control.propulsion_type)
        : tksUtilCoefficient(powerHp, control.engine_cc ?? 0, ageGroup(control.age_code), control.propulsion_type === "hybrid_sequential");
      if (Math.abs(expected - control.observed_util_coefficient) > 0.0001) {
        compared.push({ id: control.id, propulsion: control.propulsion_type, observed: control.observed_util_coefficient, expected, powerKw, powerHp, engineCc: control.engine_cc });
      }
    }
    const total = result.rowCount ?? 0;
    const pendingCount = Object.values(pending).reduce((sum, count) => sum + count, 0);
    // Malformed HAR controls are evidence-quality failures, not tariff matches.
    // Keep them visible in the report but exclude them from the comparable denominator.
    const comparable = total - pendingCount - invalid.length;
    console.log(JSON.stringify({
      controls: total,
      comparable,
      matches: comparable - compared.length,
      mismatches: compared.length,
      pending,
      invalidControls: invalid.length,
      invalidExamples: invalid.slice(0, 20),
      examples: compared.slice(0, 20),
      note: "Comparison uses direct 2026 TKS kW tariff boundaries where a kW control is available; HP-only records remain on the compatibility path.",
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
