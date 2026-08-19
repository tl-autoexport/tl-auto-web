import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

type Source = "bike" | "boat";

const USER_AGENT = "TL-Auto-Passo-ReadOnly-Details-Audit/1.0";
const TIMEOUT_MS = 20_000;

function decode(bytes: Uint8Array): string {
  // Passo declares UTF-8 and the XML dictionaries are UTF-8 as well.
  // Keeping the decoder explicit prevents Korean labels from becoming mojibake.
  return new TextDecoder("utf-8").decode(bytes);
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html, text/xml, */*",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return decode(new Uint8Array(await response.arrayBuffer()));
}

function stripTags(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLabel(value: string): string {
  return stripTags(value).replace(/[\u0000-\u001f]/g, " ").trim();
}

function extractOptions(html: string): Array<{ value: string; label: string }> {
  return [...html.matchAll(/<option\b[^>]*\bvalue\s*=\s*["']?([^\s"'>]+)["']?[^>]*>([\s\S]*?)<\/option>/gi)]
    .map((match) => ({ value: match[1], label: cleanLabel(match[2]) }))
    .filter((item) => item.label && !/^select|choose|all$/i.test(item.label));
}

function extractXmlItems(html: string, valueTag: string, labelTag: string): Array<{ value: string; label: string }> {
  const tag = new RegExp(`<item>[\\s\\S]*?<${valueTag}>([^<]+)</${valueTag}>[\\s\\S]*?<${labelTag}>([^<]+)</${labelTag}>[\\s\\S]*?</item>`, "gi");
  return [...html.matchAll(tag)].map((match) => ({ value: match[1].trim(), label: cleanLabel(match[2]) }));
}

function extractBikeModels(html: string): Array<{ value: string; label: string }> {
  const tag = /<model>[\s\S]*?<idx>(\d+)<\/idx>[\s\S]*?<name>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/name>[\s\S]*?<\/model>/gi;
  return [...html.matchAll(tag)].map((match) => ({ value: match[1].trim(), label: cleanLabel(match[2]) }));
}

function unique(values: string[]): string[] {
  return [...new Set(values)].filter(Boolean);
}

function extractImageUrls(html: string, source: Source, id: string): string[] {
  const pattern = source === "bike"
    ? /(?:https?:\/\/[^"'\s]+)?dataimg\/bike_images\/[^"'\s]+\/MOTOR_gid_\d+_[bs]_\d+\.img(?:\?[^"'\s]*)?/gi
    : /(?:https?:\/\/[^"'\s]+)?dataimg\/p_boat\/[^"'\s]+\/BOAT_gid_\d+_[bs]_\d+\.img(?:\?[^"'\s]*)?/gi;
  return unique([...html.matchAll(pattern)].map((match) => match[0]).filter((url) => url.includes(`gid_${id}_`)));
}

function extractAttributeNames(html: string): string[] {
  const names = [...html.matchAll(/\bname\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
  return unique(names.filter((name) => !/(phone|tel|hp|mobile|email|seller|member|password|login|address|name)/i.test(name))).slice(0, 80);
}

function summarizeDetail(html: string, source: Source, id: string) {
  const text = stripTags(html);
  const dates = unique(text.match(/20\d{2}[./-]\d{1,2}[./-]\d{1,2}/g) ?? []).slice(0, 10);
  const years = unique(text.match(/20\d{2}/g) ?? []).slice(0, 10);
  const numbers = unique(text.match(/\b\d[\d,\. ]{1,10}\s?(?:km|Km|cc|CC|ft|m)\b/g) ?? []).slice(0, 20);
  return {
    source,
    id,
    imageCount: extractImageUrls(html, source, id).length,
    imageTemplates: extractImageUrls(html, source, id).slice(0, 6),
    dates,
    years,
    technicalValueSamples: numbers,
    nonPersonalFormFields: extractAttributeNames(html),
    hasUpdateDate: /update_date|updated|update/i.test(html),
    hasPrice: /price|sale_price|판매가격|판매가/i.test(html),
    hasMileage: /mileage|주행거리|km/i.test(text),
    hasEngineOrCapacity: /engine|배기량|cc|capacity|length|boat/i.test(text),
  };
}

async function fetchBikeListIds(): Promise<string[]> {
  const body = new URLSearchParams({
    part: "cybershop", path: "cybershop", mode: "process", process: "list",
    mainck201508: "home", search: "@_maker_idx:", page: "0", order_by: "", search_mode: "country",
  });
  const html = await fetchText("http://bike.passo.co.kr/bike/index.php", {
    method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  return unique([...html.matchAll(/<idx>(\d+)<\/idx>/gi)].map((match) => match[1])).slice(0, 2);
}

async function fetchBoatListIds(): Promise<string[]> {
  const body = new URLSearchParams({
    part: "cybershop", path: "cybershop", mode: "process", process: "list", country_type: "",
    search: "", page: "0", order_by: "", search_mode: "makerSearch", section: "boat",
  });
  const html = await fetchText("http://boat.passo.co.kr/index.php", {
    method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  return unique([...html.matchAll(/<idx>(\d+)<\/idx>/gi)].map((match) => match[1])).slice(0, 2);
}

async function main() {
  const bikeIds = await fetchBikeListIds();
  const boatIds = await fetchBoatListIds();

  const bikeMakerHtml = await fetchText("http://bike.passo.co.kr/bike/index.php?part=cybershop&path=cybershop&mode=process&process=maker&main_country=1&country_idx=1");
  const bikeModelHtml = await fetchText("http://bike.passo.co.kr/bike/index.php?part=cybershop&path=cybershop&mode=process&process=model&idx=96");
  const boatTypeHtml = await fetchText("http://boat.passo.co.kr/index.php", {
    method: "POST",
    body: new URLSearchParams({ part: "cybershop", path: "cybershop", mode: "process", process: "search_type", depth: "0", idx: "0", set_mode: "type", type_idx: "", sub_type_idx: "" }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });

  const details: unknown[] = [];
  for (const id of bikeIds) {
    const html = await fetchText(`http://bike.passo.co.kr/bike/index.php?part=cybershop&path=cybershop&mode=process&process=view&idx=${id}&num=0`);
    details.push(summarizeDetail(html, "bike", id));
  }
  for (const id of boatIds) {
    const html = await fetchText(`http://boat.passo.co.kr/index.php?part=cybershop&path=cybershop&mode=process&process=view&idx=${id}&num=0&section=boat`);
    details.push(summarizeDetail(html, "boat", id));
  }

  console.log(JSON.stringify({
    mode: "read-only",
    generatedAt: new Date().toISOString(),
    classification: {
      boatTypeOptions: extractXmlItems(boatTypeHtml, "type_idx", "type_name"),
      note: "Only the boat type whose decoded label explicitly denotes a personal watercraft / jet ski may map to jetski. Other boat types remain excluded from the TL Auto catalogue.",
    },
    dictionaries: {
      bikeMakers: extractBikeModels(bikeMakerHtml).slice(0, 50),
      bikeModelsForMaker96: extractBikeModels(bikeModelHtml).slice(0, 80),
    },
    details,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
