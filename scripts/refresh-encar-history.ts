import { config } from "dotenv";
import { refreshEncarHistories } from "@/server/imports/encar";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

async function main() {
  const dryRun = process.env.ENCAR_HISTORY_DRY_RUN !== "false";
  const concurrency = Number.parseInt(
    process.env.ENCAR_HISTORY_CONCURRENCY ?? "4",
    10,
  );
  const result = await refreshEncarHistories({ dryRun, concurrency });
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
