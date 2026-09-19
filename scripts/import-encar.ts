import { config } from "dotenv";
import { importEncar } from "@/server/imports/encar";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

async function main() {
  const allowedModels = process.env.ENCAR_ALLOWED_MODELS
    ? JSON.parse(process.env.ENCAR_ALLOWED_MODELS) as string[]
    : undefined;
  const result = await importEncar({ allowedModels });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
