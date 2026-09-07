import { Client } from "pg";
import { config } from "dotenv";
import { tksCustomsFeeRub, tksDutyVolumeRate, tksNewPriceRate } from "../src/server/calc/tks-rules";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");

type Control = {
  id: string;
  age_code: string;
  cost_amount: number | string | null;
  currency_code: string | null;
  engine_cc: number | null;
  observed_customs_fee_rub: number | string | null;
  observed_duty_rub: number | string | null;
  response_snapshot: { resultText?: string; query?: Record<string, string> };
};

function num(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function textNumber(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  return match ? num(match[1]) : null;
}

function ratesFromTks(text: string) {
  return {
    eurRub: textNumber(text, /Курс Евро\s+([\d\s,\.]+)\s+руб/),
    customsRubPerKrw1000: textNumber(text, /Курс валюты там\. стоимости\s+([\d\s,\.]+)\s+руб\./),
  };
}

function ageGroup(ageCode: string) {
  if (ageCode === "3") return "under_3" as const;
  if (ageCode === "35") return "from_3_to_5" as const;
  if (ageCode === "57") return "from_5_to_7" as const;
  return "over_7" as const;
}

function expectedDuty(control: Control, customsValueRub: number, eurRub: number) {
  if (control.engine_cc == null) return null;
  const priceEur = customsValueRub / eurRub;
  const age = ageGroup(control.age_code);
  if (age === "under_3") {
    const band = tksNewPriceRate(priceEur);
    return Math.max(control.engine_cc * band.eurPerCc * eurRub, priceEur * band.percent * eurRub);
  }
  const eurPerCc = tksDutyVolumeRate(age === "from_3_to_5" ? age : age === "from_5_to_7" ? age : "over_7", control.engine_cc);
  // TKS's private-import table uses the volume minimum for 3–5 and 20% value
  // minimum for vehicles older than five years.
  const percent = age === "from_3_to_5" ? 0.154 : 0.2;
  return Math.max(control.engine_cc * eurPerCc * eurRub, priceEur * percent * eurRub);
}

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const result = await client.query<Control>(
      `select id, age_code, cost_amount, currency_code, engine_cc,
              observed_customs_fee_rub, observed_duty_rub, response_snapshot
       from public.tks_calculation_controls
       where review_status <> 'rejected'
         and (observed_customs_fee_rub is not null or observed_duty_rub is not null)
       order by created_at, id`,
    );
    const mismatches: Array<Record<string, unknown>> = [];
    const pending: Array<{ id: string; reason: string }> = [];
    let feeComparable = 0;
    let dutyComparable = 0;
    let feeMatches = 0;
    let dutyMatches = 0;
    const unsupportedRegimes: Record<string, number> = {};

    for (const control of result.rows) {
      const snapshot = control.response_snapshot ?? {};
      const rates = ratesFromTks(snapshot.resultText ?? "");
      const cost = num(control.cost_amount);
      if (cost == null || rates.customsRubPerKrw1000 == null || rates.eurRub == null) {
        pending.push({ id: control.id, reason: "cost or TKS exchange rates are missing" });
        continue;
      }
      const customsValueRub = control.currency_code === "410"
        ? cost * rates.customsRubPerKrw1000 / 1000
        : null;
      if (customsValueRub == null) {
        pending.push({ id: control.id, reason: `unsupported currency ${control.currency_code ?? "(empty)"}` });
        continue;
      }
      if (control.observed_customs_fee_rub != null) {
        feeComparable += 1;
        const expectedFee = tksCustomsFeeRub(customsValueRub);
        const observedFee = num(control.observed_customs_fee_rub)!;
        if (expectedFee === observedFee) feeMatches += 1;
        else mismatches.push({ id: control.id, payment: "customs_fee", expected: expectedFee, observed: observedFee, customsValueRub });
      }
      if (control.observed_duty_rub != null) {
        const resultText = snapshot.resultText ?? "";
        // EV and sequential-hybrid controls are returned by TKS as СТП
        // (duty + excise + VAT), not the ЕТС volume/price table. Their
        // excise brackets need a separate evidence set and must not be
        // misreported as failures of the ЕТС duty formula.
        if (!resultText.includes("Единая ставка")) {
          const key = control.response_snapshot?.query?.engine_type ?? "standard_stp";
          unsupportedRegimes[key] = (unsupportedRegimes[key] ?? 0) + 1;
          continue;
        }
        const expected = expectedDuty(control, customsValueRub, rates.eurRub);
        if (expected == null) {
          pending.push({ id: control.id, reason: "engine displacement is missing for duty calculation" });
        } else {
          dutyComparable += 1;
          const observed = num(control.observed_duty_rub)!;
          if (Math.abs(expected - observed) <= 0.05) dutyMatches += 1;
          else mismatches.push({ id: control.id, payment: "duty", expected: Number(expected.toFixed(2)), observed, eurRub: rates.eurRub, customsValueRub });
        }
      }
    }
    console.log(JSON.stringify({
      controls: result.rowCount ?? 0,
      customsFee: { comparable: feeComparable, matches: feeMatches, mismatches: feeComparable - feeMatches },
      duty: { comparable: dutyComparable, matches: dutyMatches, mismatches: dutyComparable - dutyMatches },
      pending: pending.length,
      pendingExamples: pending.slice(0, 20),
      unsupportedRegimes,
      examples: mismatches.slice(0, 20),
      note: "Expected values use the exchange rates embedded in each TKS HAR; dealer markups and project rates are excluded.",
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
