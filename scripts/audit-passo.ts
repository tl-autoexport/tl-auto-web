import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

type SourceName = "passo_bike" | "passo_boat";

type SourceConfig = {
  name: SourceName;
  listUrl: string;
  detailUrl: (id: string) => string;
  listBody: (page: number) => string;
  imagePattern: RegExp;
  detailImagePattern: RegExp;
};

type Listing = {
  id: string;
  publishedAt: string | null;
  imageUrl: string | null;
};

const MAX_PAGES = Number.parseInt(process.env.PASSO_AUDIT_MAX_PAGES ?? "400", 10);
const PHOTO_SAMPLES = Number.parseInt(process.env.PASSO_AUDIT_PHOTO_SAMPLES ?? "8", 10);
const REQUEST_TIMEOUT_MS = 20_000;
const USER_AGENT = "TL-Auto-Passo-ReadOnly-Audit/1.0";

const sources: SourceConfig[] = [
  {
    name: "passo_bike",
    listUrl: "http://bike.passo.co.kr/bike/index.php",
    detailUrl: (id) =>
      `http://bike.passo.co.kr/bike/index.php?part=cybershop&path=cybershop&mode=process&process=view&idx=${id}&num=0`,
    listBody: (page) =>
      new URLSearchParams({
        part: "cybershop",
        path: "cybershop",
        mode: "process",
        process: "list",
        mainck201508: "home",
        search: "@_maker_idx:",
        page: String(page),
        order_by: "",
        search_mode: "country",
      }).toString(),
    imagePattern: /dataimg\/bike_images\/[^"'\s]+\/MOTOR_gid_(\d+)_s_1\.img[^"'\s]*/gi,
    detailImagePattern: /dataimg\/bike_images\/[^"'\s]+\/MOTOR_gid_(\d+)_(?:b|s)_\d+\.img[^"'\s]*/gi,
  },
  {
    name: "passo_boat",
    listUrl: "http://boat.passo.co.kr/index.php",
    detailUrl: (id) =>
      `http://boat.passo.co.kr/index.php?part=cybershop&path=cybershop&mode=process&process=view&idx=${id}&num=0&section=boat`,
    listBody: (page) =>
      new URLSearchParams({
        part: "cybershop",
        path: "cybershop",
        mode: "process",
        process: "list",
        country_type: "",
        search: "",
        page: String(page),
        order_by: "",
        search_mode: "makerSearch",
        section: "boat",
      }).toString(),
    imagePattern: /dataimg\/p_boat\/[^"'\s]+\/BOAT_gid_(\d+)_s_1\.img[^"'\s]*/gi,
    detailImagePattern: /dataimg\/p_boat\/[^"'\s]+\/BOAT_gid_(\d+)_(?:b|s)_\d+\.img[^"'\s]*/gi,
  },
];

async function request(url: string, init?: RequestInit): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html, text/xml, */*",
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return new TextDecoder("utf-8").decode(bytes);
  } finally {
    clearTimeout(timer);
  }
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const match = value.match(/^(\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, yy, mm, dd] = match;
  return new Date(2000 + Number(yy), Number(mm) - 1, Number(dd));
}

function extractListings(html: string, source: SourceConfig): Listing[] {
  const items = [...html.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  if (items.length) {
    return items.flatMap((item) => {
      const block = item[1];
      const id = block.match(/<idx>(\d+)<\/idx>/i)?.[1];
      if (!id) return [];
      const publishedAt = block.match(/<update_date>([^<]+)<\/update_date>/i)?.[1]?.trim() ?? null;
      const imageUrl = block.match(/<thumb>([^<]+)<\/thumb>/i)?.[1]?.trim() ?? null;
      return [{ id, publishedAt, imageUrl: imageUrl ? normalizeUrl(imageUrl, source) : null }];
    });
  }

  const imageMatches = [...html.matchAll(source.imagePattern)];
  const ids = [...new Set(imageMatches.map((match) => match[1]))];
  const dates = html.match(/\b\d{2}-\d{2}-\d{2}\b/g) ?? [];
  return ids.map((id, index) => ({
    id,
    publishedAt: dates[index] ?? null,
      imageUrl: imageMatches[index]?.[0] ? normalizeUrl(imageMatches[index][0], source) : null,
  }));
}

function extractReportedTotal(html: string): number | null {
  const match = html.match(/<page>[\s\S]*?<last>(\d+)<\/last>[\s\S]*?<\/page>/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function normalizeUrl(url: string, source: SourceConfig): string {
  if (url.startsWith("http")) return url;
  const host = source.name === "passo_bike" ? "file.passo.co.kr" : "file1.passo.co.kr";
  return `http://${host}/${url.replace(/^\/+/, "")}`;
}

function isFresh(value: string | null, now: Date): boolean {
  const date = parseDate(value);
  if (!date) return false;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 30);
  return date >= start && date <= now;
}

async function checkPhoto(url: string | null): Promise<{ url: string | null; status: number | null; ok: boolean }> {
  if (!url) return { url: null, status: null, ok: false };
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return { url, status: response.status, ok: response.ok };
  } catch {
    return { url, status: null, ok: false };
  }
}

async function auditSource(source: SourceConfig, now: Date) {
  const listings = new Map<string, Listing>();
  const pageStats: Array<{ page: number; count: number; bytes: number }> = [];
  let stoppedBecause = "max_pages";
  let reportedTotal: number | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const html = await request(source.listUrl, {
      method: "POST",
      body: source.listBody(page),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        referer: source.listUrl,
      },
    });
    const pageListings = extractListings(html, source);
    reportedTotal = extractReportedTotal(html) ?? reportedTotal;
    pageStats.push({ page, count: pageListings.length, bytes: html.length });
    const before = listings.size;
    pageListings.forEach((listing) => listings.set(listing.id, listing));
    if (pageListings.length === 0 || listings.size === before) {
      stoppedBecause = pageListings.length === 0 ? "empty_page" : "no_new_ids";
      break;
    }
    if (reportedTotal !== null && page + 1 >= Math.ceil(reportedTotal / 60)) {
      stoppedBecause = "reported_total_reached";
      break;
    }
  }

  const all = [...listings.values()];
  const fresh = all.filter((listing) => isFresh(listing.publishedAt, now));
  const missingDate = all.filter((listing) => !parseDate(listing.publishedAt));
  const stale = all.filter((listing) => !missingDate.includes(listing) && !isFresh(listing.publishedAt, now));
  const missingImage = all.filter((listing) => !listing.imageUrl);
  const samples = fresh.slice(0, PHOTO_SAMPLES);
  const photoChecks = [];

  for (const listing of samples) {
    let detailImage: string | null = null;
    try {
      const detail = await request(source.detailUrl(listing.id), { headers: { referer: source.listUrl } });
      const matches = [...detail.matchAll(source.detailImagePattern)];
      const primary = matches.find((match) => detail.includes(`gid_${listing.id}_b_1.img`));
      detailImage = primary?.[0] ? normalizeUrl(primary[0], source) : matches[0]?.[0] ? normalizeUrl(matches[0][0], source) : null;
    } catch {
      detailImage = listing.imageUrl;
    }
    photoChecks.push({ id: listing.id, ...(await checkPhoto(detailImage)) });
  }

  return {
    source: source.name,
    pages: pageStats,
    stoppedBecause,
    reportedTotal,
    totalDiscovered: all.length,
    fresh30Days: fresh.length,
    stale: stale.length,
    missingDate: missingDate.length,
    withImage: all.length - missingImage.length,
    missingImage: missingImage.length,
    photoSamples: photoChecks,
    freshSampleIds: fresh.slice(0, 10).map((listing) => listing.id),
  };
}

async function main() {
  const requested = process.argv[2] as SourceName | undefined;
  const selected = requested ? sources.filter((source) => source.name === requested) : sources;
  if (!selected.length) throw new Error(`Unknown source: ${requested}`);
  const now = new Date();
  const results = [];
  for (const source of selected) {
    try {
      results.push(await auditSource(source, now));
    } catch (error) {
      results.push({ source: source.name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  console.log(JSON.stringify({ mode: "read-only", generatedAt: now.toISOString(), results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
