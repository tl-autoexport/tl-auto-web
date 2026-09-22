import { config } from "dotenv";
import { refreshEncarPhotos } from "@/server/imports/encar";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

async function main() {
  const sourceIds = (process.env.ENCAR_PHOTO_SOURCE_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const result = await refreshEncarPhotos(sourceIds.length ? sourceIds : undefined);
  console.log(JSON.stringify(result, null, 2));

  if (result.errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
