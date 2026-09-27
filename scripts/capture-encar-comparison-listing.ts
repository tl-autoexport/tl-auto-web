import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

async function main() {
  const write = process.env.ENCAR_SINGLE_LISTING_WRITE === "true";
  const { captureEncarComparisonListing } = await import(
    "@/server/imports/encar"
  );
  const result = await captureEncarComparisonListing({ write });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
