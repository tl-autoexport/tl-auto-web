import { config } from "dotenv";
import { importEncar } from "@/server/imports/encar";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

async function main() {
  const target = Number.parseInt(process.env.ENCAR_TARGET ?? "10", 10);
  const maxPages = Number.parseInt(process.env.ENCAR_MAX_PAGES ?? "3", 10);
  const electricTarget = Number.parseInt(process.env.ENCAR_ELECTRIC_TARGET ?? "4", 10);
  const electricPages = Number.parseInt(process.env.ENCAR_ELECTRIC_PAGES ?? "3", 10);
  const onlyNew = process.env.ENCAR_ONLY_NEW === "true";
  const fastMode = process.env.ENCAR_FAST_MODE === "true";
  const maxListingAgeDays = Number.parseInt(
    process.env.CATALOG_MAX_LISTING_AGE_DAYS ?? "30",
    10,
  );
  const dryRun = process.env.ENCAR_DRY_RUN !== "false";
  const result = await importEncar({
    target,
    maxPages,
    electricTarget,
    electricPages,
    onlyNew,
    fastMode,
    maxListingAgeDays,
    dryRun,
    replaceCatalog: process.env.ENCAR_REPLACE_CATALOG === "true",
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
