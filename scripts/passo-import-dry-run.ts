import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

type Kind = "bike" | "boat";
const USER_AGENT = "TL-Auto-Passo-Importer-Dry-Run/1.0";
const MAX_PAGES = Number.parseInt(process.env.PASSO_DRY_RUN_MAX_PAGES ?? "400", 10);
const PAGE_SIZE = 60;

async function request(url: string, body: URLSearchParams): Promise<string> {
  const response = await fetch(url, { method: "POST", body, headers: { "user-agent": USER_AGENT, "content-type": "application/x-www-form-urlencoded", accept: "text/html, text/xml, */*" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return new TextDecoder("utf-8").decode(new Uint8Array(await response.arrayBuffer()));
}

function clean(value: string | undefined): string | null {
  if (!value) return null;
  return value.replace(/<!\[CDATA\[|\]\]>/g, "").trim() || null;
}

function fresh(value: string | null): boolean {
  if (!value) return false;
  const m = value.match(/^(\d{2})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const date = new Date(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const threshold = new Date(now);
  threshold.setHours(0, 0, 0, 0);
  threshold.setDate(threshold.getDate() - 30);
  return date >= threshold && date <= now;
}

function tag(block: string, name: string): string | null {
  return clean(block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"))?.[1]);
}

function body(kind: Kind, page: number): URLSearchParams {
  return kind === "bike"
    ? new URLSearchParams({ part: "cybershop", path: "cybershop", mode: "process", process: "list", mainck201508: "home", search: "@_maker_idx:", page: String(page), order_by: "", search_mode: "country" })
    : new URLSearchParams({ part: "cybershop", path: "cybershop", mode: "process", process: "list", country_type: "", search: "", page: String(page), order_by: "", search_mode: "makerSearch", section: "boat" });
}

async function auditKind(kind: Kind) {
  const url = kind === "bike" ? "http://bike.passo.co.kr/bike/index.php" : "http://boat.passo.co.kr/index.php";
  const seen = new Map<string, { updated: string | null; image: string | null; typeIdx: string | null; priceRaw: string | null }>();
  let reportedTotal: number | null = null;
  let pages = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const html = await request(url, body(kind, page));
    const pageItems = [...html.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
    reportedTotal = Number(html.match(/<page>[\s\S]*?<last>(\d+)<\/last>/i)?.[1] ?? reportedTotal) || reportedTotal;
    for (const block of pageItems) {
      const id = tag(block, "idx");
      if (!id) continue;
      seen.set(id, { updated: tag(block, "update_date"), image: tag(block, "thumb"), typeIdx: tag(block, "type_idx"), priceRaw: tag(block, kind === "bike" ? "c_sale_price" : "sale_price") });
    }
    pages += 1;
    if (!pageItems.length || (reportedTotal !== null && pages >= Math.ceil(reportedTotal / PAGE_SIZE))) break;
  }
  const all = [...seen.values()];
  const freshRows = all.filter((row) => fresh(row.updated));
  const jetski = kind === "boat" ? freshRows.filter((row) => row.typeIdx === "7") : [];
  const imageRows = freshRows.filter((row) => Boolean(row.image));
  const zeroOrSuspiciousPrices = freshRows.filter((row) => {
    const value = Number((row.priceRaw ?? "").replace(/,/g, ""));
    return !Number.isFinite(value) || value <= 0 || (kind === "boat" && value < 10);
  }).length;
  return { source: kind === "bike" ? "passo_bike" : "passo_boat", pages, reportedTotal, discovered: all.length, fresh30Days: freshRows.length, eligibleBySourceRule: kind === "boat" ? jetski.length : freshRows.length, freshWithImageUrl: imageRows.length, missingImageUrl: freshRows.length - imageRows.length, suspiciousPriceRawCount: zeroOrSuspiciousPrices, note: kind === "bike" ? "ATV classification requires detail-card validation; pilot adapter excludes ATV." : "Only type_idx=7 (제트스키) is eligible." };
}

async function main() {
  const startedAt = new Date().toISOString();
  const results = await Promise.all([auditKind("bike"), auditKind("boat")]);
  console.log(JSON.stringify({ mode: "read-only", writes: { supabase: false, filesystem: "report-only" }, generatedAt: startedAt, results }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
