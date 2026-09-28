/**
 * Import manually screened EncarRus ICE powers as preliminary automatic refs.
 * This script changes only vehicle_power_automatic_reference. It never changes
 * cars, calculations, prices, or publication state.
 */
import { config } from "dotenv";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { resolveAutomaticPowerReference, type AutomaticPowerReferenceRow } from "../src/server/catalog/automatic-power-reference";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const reportPath = process.env.ENCARRUS_ICE_AUDIT ??
  "output/tl-auto-gasd-5f278fea-encarrus-109-audit.json";
const write = process.env.ENCARRUS_ICE_REFERENCE_WRITE === "true";
const dbUrl = process.env.SUPABASE_DB_URL;
const expectedRunId = "5f278fea-f4dc-417d-b0fa-c05983854516";
const EXPECTED_INPUT_CONFIGS = 109;
const EXPECTED_INPUT_LISTINGS = 184;
const EXPECTED_IMPORT_CONFIGS = 105;
const EXPECTED_IMPORT_LISTINGS = 170;

type Card = {
  trim: string;
  year: number | null;
  engineCc: number | null;
  fuelType: string | null;
  driveText: string | null;
  displayedPowerHp: number | null;
  powerBasis?: string | null;
  productUrl?: string | null;
};

type Candidate = {
  classification: string;
  group: {
    brand: string;
    model: string;
    year: number;
    engineCc: number;
    fuelType: string;
    driveType: string | null;
    listingIds: string[];
    badgeExamples?: string[];
  };
  suggestedPowerHp: number;
  powerCandidatesHp: number[];
  matchedCards: Card[];
  sourceGroupFound: boolean;
  sourceGroupMatches: boolean;
};

type ReferenceInput = Pick<AutomaticPowerReferenceRow,
  "brand" | "model" | "fuel_type" | "engine_cc" | "drive_type" | "badge" | "badge_detail"
> & { year: number | null };

type Audit = {
  runId: string;
  planRunId: string;
  planConfigurations: number;
  reportConfigurations: number;
  preliminaryConfigurations: number;
  preliminaryListings: number;
  invalidPreliminary: unknown[];
  candidates: Candidate[];
};

type Reference = {
  configuration_key: string;
  brand: string;
  model: string;
  fuel_type: string;
  engine_cc: number;
  drive_type: string | null;
  badge: null;
  badge_detail: null;
  year_from: number;
  year_to: number;
  power_hp: number;
  power_kw: number;
  source: "encarrus_ice_catalog";
  status: "automatic";
  note: string;
};

const excludedConfigurations = new Set([
  "BMW|5 Series|2022|1998|gasoline|",
  "Mercedes-Benz|S-Class|2022|2999|gasoline|4WD",
  "Mercedes-Benz|GLC|2025|1991|gasoline|4WD",
  "Porsche|Macan|2022|2894|gasoline|",
]);

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function exclusionKey(row: Candidate) {
  const group = row.group;
  return [group.brand, group.model, group.year, group.engineCc, group.fuelType, group.driveType ?? ""].join("|");
}

function referenceKey(row: Candidate) {
  const group = row.group;
  return [normalize(group.brand), normalize(group.model), normalize(group.fuelType), group.engineCc,
    normalize(group.driveType), "", "", `year=${group.year}-${group.year}`].join("|");
}

function toReference(row: Candidate): Reference {
  const group = row.group;
  const evidence = row.matchedCards.map((card) => {
    const label = [card.trim, card.displayedPowerHp == null ? null : `${card.displayedPowerHp} PS`, card.productUrl]
      .filter(Boolean).join(" — ");
    return label;
  });
  return {
    configuration_key: referenceKey(row),
    brand: group.brand,
    model: group.model,
    fuel_type: group.fuelType,
    engine_cc: group.engineCc,
    drive_type: group.driveType,
    badge: null,
    badge_detail: null,
    year_from: group.year,
    year_to: group.year,
    power_hp: row.suggestedPowerHp,
    power_kw: Number((row.suggestedPowerHp * 0.73549875).toFixed(4)),
    source: "encarrus_ice_catalog",
    status: "automatic",
    note: [
      "Предварительная мощность ДВС по карточкам каталога EncarRus; не является подтверждённым значением ТКС/ОТТС.",
      "План и отчёт сверены по run ID и listing IDs; точное основание отображаемой мощности EncarRus не установлено.",
      `Encar listing IDs: ${group.listingIds.join(", ")}.`,
      `Исходные комплектации Encar: ${(group.badgeExamples ?? []).join("; ") || "не указаны"}.`,
      `Мощность: ${row.suggestedPowerHp} PS. Карточки EncarRus: ${[...new Set(evidence)].join(" | ")}`,
    ].join(" "),
  };
}

async function main() {
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required");
  const audit = JSON.parse(await readFile(reportPath, "utf8")) as Audit;
  if (audit.runId !== expectedRunId || audit.planRunId !== expectedRunId) {
    throw new Error(`Unexpected run ID in audit: ${audit.runId}/${audit.planRunId}`);
  }
  if (audit.planConfigurations !== 251 || audit.reportConfigurations !== 251 ||
      audit.preliminaryConfigurations !== EXPECTED_INPUT_CONFIGS ||
      audit.preliminaryListings !== EXPECTED_INPUT_LISTINGS ||
      audit.candidates.length !== EXPECTED_INPUT_CONFIGS || audit.invalidPreliminary.length !== 0) {
    throw new Error("Audit totals/validation differ from the manually checked run; refusing import");
  }

  const excluded = audit.candidates.filter((row) => excludedConfigurations.has(exclusionKey(row)));
  const selected = audit.candidates.filter((row) => !excludedConfigurations.has(exclusionKey(row)));
  const invalid = selected.filter((row) =>
    row.classification !== "preliminary_candidate" || !row.sourceGroupFound || !row.sourceGroupMatches ||
    !Array.isArray(row.group.listingIds) || row.powerCandidatesHp?.length !== 1 ||
    row.powerCandidatesHp[0] !== row.suggestedPowerHp || !row.matchedCards?.length ||
    row.matchedCards.some((card) => card.displayedPowerHp !== row.suggestedPowerHp ||
      card.year !== row.group.year || card.fuelType !== row.group.fuelType || card.engineCc == null ||
      Math.abs(card.engineCc - row.group.engineCc) > 120 || !card.productUrl)
  );
  const listingCount = selected.reduce((sum, row) => sum + row.group.listingIds.length, 0);
  const references = selected.map(toReference);
  const keys = references.map((row) => row.configuration_key);
  if (excluded.length !== 4 || selected.length !== EXPECTED_IMPORT_CONFIGS ||
      listingCount !== EXPECTED_IMPORT_LISTINGS || invalid.length ||
      new Set(keys).size !== keys.length) {
    throw new Error(`Import cohort failed closed validation: ${JSON.stringify({
      excluded: excluded.length, selected: selected.length, listingCount, invalid: invalid.length,
      duplicateKeys: keys.length - new Set(keys).size,
    })}`);
  }

  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    if (write) await db.query("begin");
    const existing = await db.query<{
      configuration_key: string; status: string; source: string; power_hp: string;
    }>(
      `select configuration_key,status,source,power_hp::text
         from public.vehicle_power_automatic_reference
        where configuration_key=any($1::text[])${write ? " for update" : ""}`,
      [keys],
    );
    const existingByKey = new Map(existing.rows.map((row) => [row.configuration_key, row]));
    const proposedByKey = new Map(references.map((row) => [row.configuration_key, row]));
    const protectedRefs = existing.rows.filter((row) => row.status !== "automatic");
    if (protectedRefs.length) {
      throw new Error(`Protected non-automatic refs; refusing import: ${JSON.stringify(protectedRefs)}`);
    }
    const heldConflicts = existing.rows.flatMap((row) => {
      const proposed = proposedByKey.get(row.configuration_key);
      if (!proposed || Number(row.power_hp) === proposed.power_hp) return [];
      const candidate = selected.find((item) => referenceKey(item) === row.configuration_key);
      return candidate ? [{
        configuration_key: row.configuration_key,
        brand: candidate.group.brand,
        model: candidate.group.model,
        year: candidate.group.year,
        listingCount: candidate.group.listingIds.length,
        listingIds: candidate.group.listingIds,
        existingSource: row.source,
        existingPowerHp: Number(row.power_hp),
        proposedPowerHp: proposed.power_hp,
        badgeExamples: candidate.group.badgeExamples ?? [],
      }] : [];
    });
    const heldKeys = new Set(heldConflicts.map((row) => row.configuration_key));
    const safeSelected = selected.filter((row) => !heldKeys.has(referenceKey(row)));
    const safeReferences = references.filter((row) => !heldKeys.has(row.configuration_key));
    const safeKeys = safeReferences.map((row) => row.configuration_key);
    const safeListingCount = safeSelected.reduce((sum, row) => sum + row.group.listingIds.length, 0);
    const pending = safeReferences.filter((row) => !existingByKey.has(row.configuration_key));
    const liveReferences = await db.query<AutomaticPowerReferenceRow>(
      `select configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,
              year_from,year_to,power_hp::double precision as power_hp,
              power_kw::double precision as power_kw,source,status
         from public.vehicle_power_automatic_reference where status <> 'retired'`,
    );
    const combined = [...liveReferences.rows, ...safeReferences];
    const resolverConflicts = safeSelected.flatMap((row) => {
      const group = row.group;
      const badges = [...new Set(group.badgeExamples?.length ? group.badgeExamples : [null])];
      return badges.flatMap((badge) => {
        const input: ReferenceInput = {
          brand: group.brand, model: group.model, fuel_type: group.fuelType,
          engine_cc: group.engineCc, drive_type: group.driveType,
          badge, badge_detail: null, year: group.year,
        };
        const resolved = resolveAutomaticPowerReference(input, combined);
        return resolved?.power_hp === row.suggestedPowerHp ? [] : [{
          brand: group.brand, model: group.model, year: group.year, badge,
          expectedPowerHp: row.suggestedPowerHp, resolvedPowerHp: resolved?.power_hp ?? null,
          resolvedKey: resolved?.configuration_key ?? null,
        }];
      });
    });
    if (resolverConflicts.length) {
      throw new Error(`Existing resolver precedence conflicts; refusing: ${JSON.stringify(resolverConflicts)}`);
    }

    console.log(JSON.stringify({
      write,
      runId: audit.runId,
      source: "encarrus_ice_catalog",
      status: "automatic (preliminary; T4 evidence)",
      configurationsInAudit: audit.preliminaryConfigurations,
      listingsInAudit: audit.preliminaryListings,
      heldForExistingPowerConflict: {
        configurations: heldConflicts.length,
        listings: heldConflicts.reduce((sum, row) => sum + row.listingCount, 0),
        details: heldConflicts,
      },
      excludedConflictingConfigurations: excluded.map((row) => ({
        brand: row.group.brand, model: row.group.model, year: row.group.year,
        engineCc: row.group.engineCc, listingCount: row.group.listingIds.length,
      })),
      configurationsToRecord: safeSelected.length,
      listingsCovered: safeListingCount,
      alreadyRecorded: safeReferences.length - pending.length,
      newReferences: pending.length,
      resolverConflicts: resolverConflicts.length,
      powersByFuel: Object.fromEntries(["gasoline", "diesel"].map((fuel) => [
        fuel, safeSelected.filter((row) => row.group.fuelType === fuel).length,
      ])),
      effects: { carsChanged: 0, calculationsChanged: 0, pricesChanged: 0, publications: 0 },
    }, null, 2));
    if (!write) return;

    if (pending.length) {
      await db.query(
        `insert into public.vehicle_power_automatic_reference
          (configuration_key,brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,
           year_from,year_to,power_hp,power_kw,source,status,note,updated_at)
         select x.configuration_key,x.brand,x.model,x.fuel_type,x.engine_cc,x.drive_type,x.badge,x.badge_detail,
                x.year_from,x.year_to,x.power_hp,x.power_kw,x.source,x.status,x.note,now()
           from jsonb_to_recordset($1::jsonb) as x(
             configuration_key text,brand text,model text,fuel_type text,engine_cc integer,drive_type text,
             badge text,badge_detail text,year_from integer,year_to integer,power_hp numeric,power_kw numeric,
             source text,status text,note text)
         on conflict (configuration_key) do nothing`,
        [JSON.stringify(pending)],
      );
    }
    const verify = await db.query<{ configuration_key: string; power_hp: string; status: string }>(
      `select configuration_key,power_hp::text,status
         from public.vehicle_power_automatic_reference
        where configuration_key=any($1::text[])`,
      [safeKeys],
    );
    const verifiedByKey = new Map(verify.rows.map((row) => [row.configuration_key, row]));
    const verificationFailures = safeReferences.flatMap((reference) => {
      const row = verifiedByKey.get(reference.configuration_key);
      return row?.status === "automatic" && Number(row.power_hp) === reference.power_hp ? [] : [{
        configuration_key: reference.configuration_key,
        expectedPowerHp: reference.power_hp,
        actualPowerHp: row?.power_hp ?? null,
        actualStatus: row?.status ?? null,
      }];
    });
    if (verificationFailures.length) {
      throw new Error(`Post-write verification failed: ${JSON.stringify(verificationFailures)}`);
    }
    await db.query("commit");
    console.log(JSON.stringify({ applied: pending.length, safeConfigurations: safeReferences.length,
      heldConflicts: heldConflicts.length, verified: safeReferences.length,
      referenceOnly: true, carsChanged: 0, calculationsChanged: 0, pricesChanged: 0, publications: 0 }));
  } catch (error) {
    if (write) await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
