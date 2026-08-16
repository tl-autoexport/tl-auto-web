import { inspectEncarVehicles } from "@/server/imports/encar";

const DEFAULT_VEHICLE_IDS = ["42036785", "41670516", "42035474", "41679191", "41666811"];

async function main() {
  const vehicleIds = process.argv.slice(2);
  const result = await inspectEncarVehicles(vehicleIds.length ? vehicleIds : DEFAULT_VEHICLE_IDS);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
