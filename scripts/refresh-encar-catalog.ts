import { config } from "dotenv";
import { importEncar } from "@/server/imports/encar";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

async function main() {
  const target = Number.parseInt(process.env.ENCAR_TARGET ?? "10", 10);
  const maxPages = Number.parseInt(process.env.ENCAR_MAX_PAGES ?? "3", 10);
  const dryRun = process.env.ENCAR_DRY_RUN !== "false";
  const result = await importEncar({ target, maxPages, dryRun, replaceCatalog: !dryRun });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
