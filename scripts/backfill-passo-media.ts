import { config } from "dotenv";
import { createPassoMediaClient, ensurePassoMediaBucket, mirrorPassoImages } from "./passo-media-mirror";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

async function main() {
  const supabase = createPassoMediaClient();
  await ensurePassoMediaBucket(supabase);
  const { data, error } = await supabase
    .from("passo_catalog_staging")
    .select("id, source, source_id, image_urls")
    .eq("import_status", "validated");
  if (error) throw error;

  let mirrored = 0;
  let reused = 0;
  let failed = 0;
  for (const row of data ?? []) {
    const externalUrls = (Array.isArray(row.image_urls) ? row.image_urls : [])
      .map((item) => (typeof item === "string" ? item : item && typeof item === "object" && "source_url" in item ? item.source_url : item && typeof item === "object" && "url" in item ? item.url : null))
      .filter((url): url is string => typeof url === "string" && url.startsWith("http"));
    if (!externalUrls.length) continue;

    const result = await mirrorPassoImages({ supabase, source: row.source, sourceId: row.source_id, imageUrls: [...new Set(externalUrls)] });
    const update = await supabase.from("passo_catalog_staging").update({ image_urls: result.items }).eq("id", row.id);
    if (update.error) throw update.error;
    mirrored += result.mirrored;
    reused += result.reused;
    failed += result.failed;
    console.log(`${row.source}/${row.source_id}: mirrored=${result.mirrored} reused=${result.reused} failed=${result.failed}`);
  }

  console.log(JSON.stringify({ records: data?.length ?? 0, mirrored, reused, failed }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
