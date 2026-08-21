import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const PASSO_MEDIA_BUCKET = "passo-media";
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 20_000;

type MirrorItem = {
  url: string;
  is_primary: boolean;
  sort_order: number;
  source_url: string;
  mirrored: boolean;
};

type MirrorResult = {
  items: MirrorItem[];
  mirrored: number;
  reused: number;
  failed: number;
};

function publicUrl(supabase: SupabaseClient, path: string) {
  return supabase.storage.from(PASSO_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

function pathFor(source: string, sourceId: string, sourceUrl: string) {
  const digest = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 24);
  return `${source}/${sourceId}/${digest}.jpg`;
}

async function fetchWithRetry(url: string, init: RequestInit = {}) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          referer: "http://passo.co.kr/",
          "user-agent": "TL-Auto-Passo-Media-Mirror/1.0",
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return response;
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
  throw lastError instanceof Error ? lastError : new Error("Passo media request failed");
}

async function publicObjectExists(url: string) {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function mirrorPassoImages({
  supabase,
  source,
  sourceId,
  imageUrls,
}: {
  supabase: SupabaseClient;
  source: string;
  sourceId: string;
  imageUrls: string[];
}): Promise<MirrorResult> {
  const items: MirrorItem[] = [];
  let mirrored = 0;
  let reused = 0;
  let failed = 0;

  for (const [index, sourceUrl] of imageUrls.entries()) {
    const path = pathFor(source, sourceId, sourceUrl);
    const internalUrl = publicUrl(supabase, path);
    if (await publicObjectExists(internalUrl)) {
      items.push({ url: internalUrl, is_primary: index === 0, sort_order: index, source_url: sourceUrl, mirrored: true });
      reused += 1;
      continue;
    }

    try {
      const response = await fetchWithRetry(sourceUrl);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const { error } = await supabase.storage.from(PASSO_MEDIA_BUCKET).upload(path, bytes, {
        contentType: response.headers.get("content-type")?.startsWith("image/") ? response.headers.get("content-type")! : "image/jpeg",
        cacheControl: "31536000",
        upsert: false,
      });
      if (error && !/already exists|duplicate/i.test(error.message)) throw error;
      items.push({ url: internalUrl, is_primary: index === 0, sort_order: index, source_url: sourceUrl, mirrored: true });
      if (error) reused += 1;
      else mirrored += 1;
    } catch (error) {
      failed += 1;
      console.warn(`[passo-media] failed ${sourceUrl}: ${error instanceof Error ? error.message : String(error)}`);
      items.push({ url: sourceUrl, is_primary: index === 0, sort_order: index, source_url: sourceUrl, mirrored: false });
    }
  }

  return { items, mirrored, reused, failed };
}

export function createPassoMediaClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin env variables are required for Passo media mirroring");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function ensurePassoMediaBucket(supabase: SupabaseClient) {
  const { data, error } = await supabase.storage.listBuckets();
  if (error) throw error;
  if (data?.some((bucket) => bucket.id === PASSO_MEDIA_BUCKET)) return;
  const result = await supabase.storage.createBucket(PASSO_MEDIA_BUCKET, { public: true, fileSizeLimit: "20MB" });
  if (result.error && !/already exists|duplicate/i.test(result.error.message)) throw result.error;
}
