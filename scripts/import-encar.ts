import { config } from "dotenv";
import { importEncar } from "@/server/imports/encar";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

async function main() {
  const result = await importEncar();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
