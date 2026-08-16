import { config } from "dotenv";
import { deduplicateActiveEncarCatalog } from "@/server/catalog/encar-deduplication";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const dryRun = process.env.ENCAR_DEDUPLICATION_DRY_RUN !== "false";
deduplicateActiveEncarCatalog({ dryRun })
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
