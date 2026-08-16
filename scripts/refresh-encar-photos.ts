import { config } from "dotenv";
import { refreshEncarPhotos } from "@/server/imports/encar";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

async function main() {
  const result = await refreshEncarPhotos();
  console.log(JSON.stringify(result, null, 2));

  if (result.errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
