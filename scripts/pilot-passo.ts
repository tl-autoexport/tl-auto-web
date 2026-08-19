import { config } from "dotenv";
import { writeFile } from "node:fs/promises";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

type Kind = "bike" | "boat";
type PilotRecord = {
  source: "passo_bike" | "passo_boat";
  sourceId: string;
  vehicleType: "motorcycle" | "scooter" | "jetski";
  sourceUrl: string;
  sourceUpdatedAt: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  priceKrw: number | null;
  mileageKm: number | null;
  vehicleSpecs: Record<string, string | number | null>;
  imageCount: number;
  imageUrls: string[];
  primaryImageUrl: string | null;
  sampleImageStatus: number | null;
  safeForImport: boolean;
  rejectedReason: string | null;
};

const USER_AGENT = "TL-Auto-Passo-ReadOnly-Pilot/1.0";
const TIMEOUT_MS = 20_000;
const BIKE_TARGET = Number.parseInt(process.env.PASSO_PILOT_BIKE ?? "10", 10);
const JETSKI_TARGET = Number.parseInt(process.env.PASSO_PILOT_JETSKI ?? "10", 10);

async function get(url: string, init?: RequestInit): Promise<string> {
  const response = await fetch(url, {
    ...init,
    headers: { "user-agent": USER_AGENT, accept: "text/html, text/xml, */*", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return new TextDecoder("utf-8").decode(new Uint8Array(await response.arrayBuffer()));
}

function text(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function numberValue(value: string | null): number | null {
  if (!value) return null;
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function priceKrwValue(value: string | null, html: string): number | null {
  const source = value ?? text(html).match(/(?:판매가격|가격)[\s\S]{0,100}?([\d,\.]+)\s*만원/i)?.[1] ?? null;
  const amount = numberValue(source);
  if (amount === null) return null;
  return /만원/.test(value ?? html) ? Math.round(amount * 10_000) : amount;
}

function dateValue(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/) ?? value.match(/(\d{2})-(\d{2})-(\d{2})/);
  if (!match) return null;
  if (match[1].length === 4) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return `20${match[1]}-${match[2]}-${match[3]}`;
}

function fresh(date: string | null): boolean {
  if (!date) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  const threshold = new Date();
  threshold.setUTCHours(0, 0, 0, 0);
  threshold.setUTCDate(threshold.getUTCDate() - 30);
  return parsed >= threshold && parsed <= new Date();
}

function fields(html: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of html.matchAll(/<dt[^>]*>([^<]*)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi)) {
    const label = text(match[1]);
    const value = text(match[2]);
    if (label && value) result.set(label, value);
  }
  return result;
}

const exactTranslation: Record<string, string> = {
  "혼다": "Honda", "할리데이비슨": "Harley-Davidson", "야마하": "Yamaha", "두카티": "Ducati", "가와사키": "Kawasaki", "씨두": "Sea-Doo",
  "골드윙 투어 DCT 에어백": "Gold Wing Tour DCT Airbag", "로드 글라이드": "Road Glide", "팻보이": "Fat Boy", "스트리트 글라이드 스페셜": "Street Glide Special", "로드킹 스페셜": "Road King Special", "티맥스 560": "TMAX 560", "슈퍼로우 1200 T": "SuperLow 1200T", "멀티스트라다 1200 파이커스 피크": "Multistrada 1200 Pikes Peak", "울트라 리미티드": "Ultra Limited", "울트라 310 LX": "Ultra 310 LX", "웨이브블러스터 760": "WaveBlaster 760", "웨이브러너 760": "WaveRunner 760", "스파크 90 IBR TRIXX": "Spark 90 IBR TRIXX", "슈퍼젯": "SuperJet",
  "자동": "Автомат", "6단": "6-ступенчатая", "휘발유": "Бензин", "경유": "Дизель", "은색": "Серебристый", "검정색": "Чёрный", "청색": "Синий", "빨간색": "Красный", "커스텀": "Индивидуальный", "일본": "Япония", "미국": "США", "이태리": "Италия", "기타국가": "Другая страна", "무": "Нет", "가능": "Да", "협의": "По договорённости",
  "투어링 > 스포츠": "Туринг · спорт", "투어링 > 아메리칸": "Туринг · американский стиль", "아메리칸 > 크루져": "Американский круизер", "스쿠터 > 빅스쿠터": "Макси-скутер", "오프로드 > 듀얼퍼포즈": "Эндуро · двойного назначения", "제트스키 1인승": "Гидроцикл · 1 место", "제트스키 2인승": "Гидроцикл · 2 места", "제트스키 3인승": "Гидроцикл · 3 места",
};

function translated(value: string | null | undefined, fallback: string | null = null): string | null {
  if (!value) return fallback;
  const clean = value.replace(/\s+/g, " ").trim();
  if (exactTranslation[clean]) return exactTranslation[clean];
  return /[\u3131-\u318e\uac00-\ud7a3]/.test(clean) ? fallback : clean;
}

function imageNumber(url: string): number {
  return Number(url.match(/_[bs]_(\d+)\.img/i)?.[1] ?? 9999);
}

function imageUrls(html: string, kind: Kind, id: string): string[] {
  const pattern = kind === "bike"
    ? /(?:https?:\/\/[^"'\s]+)?dataimg\/bike_images\/[^"'\s]+\/MOTOR_gid_\d+_[bs]_\d+\.img(?:\?[^"'\s]*)?/gi
    : /(?:https?:\/\/[^"'\s]+)?dataimg\/p_boat\/[^"'\s]+\/BOAT_gid_\d+_[bs]_\d+\.img(?:\?[^"'\s]*)?/gi;
  return [...new Set([...html.matchAll(pattern)]
    .map((match) => match[0])
    .filter((url) => url.includes(`gid_${id}_`))
    .map((url) => url.replace(/_s_(\d+)\.img/i, "_b_$1.img")))]
    .sort((left, right) => imageNumber(left) - imageNumber(right));
}

function absoluteImage(url: string | null, kind: Kind): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return `http://${kind === "bike" ? "file.passo.co.kr" : "file1.passo.co.kr"}/${url.replace(/^\/+/, "")}`;
}

async function checkImage(url: string | null): Promise<number | null> {
  if (!url) return null;
  try {
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return response.status;
  } catch {
    return null;
  }
}

async function list(kind: Kind, page: number): Promise<Array<{ id: string; updated: string | null }>> {
  const url = kind === "bike" ? "http://bike.passo.co.kr/bike/index.php" : "http://boat.passo.co.kr/index.php";
  const params: Record<string, string> = kind === "bike"
    ? { part: "cybershop", path: "cybershop", mode: "process", process: "list", mainck201508: "home", search: "@_maker_idx:", page: String(page), order_by: "", search_mode: "country" }
    : { part: "cybershop", path: "cybershop", mode: "process", process: "list", country_type: "", search: "", page: String(page), order_by: "", search_mode: "makerSearch", section: "boat" };
  const html = await get(url, { method: "POST", body: new URLSearchParams(params), headers: { "content-type": "application/x-www-form-urlencoded" } });
  return [...html.matchAll(/<item>([\s\S]*?)<\/item>/gi)].flatMap((match) => {
    const block = match[1];
    const id = block.match(/<idx>(\d+)<\/idx>/i)?.[1];
    if (!id) return [];
    return [{ id, updated: block.match(/<update_date>([^<]+)<\/update_date>/i)?.[1]?.trim() ?? null }];
  });
}

async function build(kind: Kind, id: string, updatedFromList: string | null): Promise<PilotRecord | null> {
  const source = kind === "bike" ? "passo_bike" : "passo_boat";
  const sourceUrl = kind === "bike"
    ? `http://bike.passo.co.kr/bike/index.php?part=cybershop&path=cybershop&mode=process&process=view&idx=${id}&num=0`
    : `http://boat.passo.co.kr/index.php?part=cybershop&path=cybershop&mode=process&process=view&idx=${id}&num=0&section=boat`;
  const html = await get(sourceUrl);
  const data = fields(html);
  const type = data.get("유형") ?? "";
  if (kind === "boat" && !/제트스키/i.test(type)) return null;
  if (kind === "bike" && /ATV|쿼드|사륜/i.test(`${type} ${data.get("모델(국문)") ?? ""}`)) return null;
  const images = imageUrls(html, kind, id).map((url) => absoluteImage(url, kind)).filter((url): url is string => Boolean(url));
  const primary = images.find((url) => /_b_1\.img/i.test(url)) ?? images[0] ?? null;
  const updated = dateValue(updatedFromList) ?? dateValue(data.get("날짜") ?? null);
  const priceKrw = priceKrwValue(data.get("가격") ?? data.get("판매가격") ?? null, html);
  const year = numberValue(data.get(kind === "bike" ? "제조년도" : "제조년식") ?? null);
  const mileageKm = numberValue(data.get("주행거리") ?? null);
  const brandRaw = (data.get("제조회사") ?? "").replace(/\s*\([^)]*\)/g, "").trim() || null;
  const brand = translated(brandRaw, "Марка не указана");
  const model = translated(data.get("모델(영문)") ?? null) ?? translated(data.get(kind === "bike" ? "모델(국문)" : "모델명") ?? null, "Модель уточняется");
  const specs: Record<string, string | number | null> = kind === "bike"
    ? {
      category: translated(type, "Категория не указана"), engine_cc: numberValue(data.get("배기량") ?? null), transmission: translated(data.get("기어방식") ?? null, "Не указано"), fuel: translated(data.get("사용연료") ?? null, "Не указано"), color: translated(data.get("색상") ?? null, "Не указан"), country: translated(data.get("제조국") ?? null, "Не указана"),
      accident_history: translated(data.get("사고유무") ?? null, "Не указано"), tuning: translated(data.get("튜닝체크") ?? null, "Не указано"), warranty: translated(data.get("A/S") ?? null, "Не указано"), negotiable: translated(data.get("가격절충") ?? null, "Не указано"), delivery: translated(data.get("배송비") ?? null, "Не указано"),
    }
    : parseJetskiSpecs(type, data);
  const status = await checkImage(primary);
  const safeForImport = Boolean(updated && fresh(updated) && model && year && priceKrw && primary);
  return { source, sourceId: id, vehicleType: kind === "boat" ? "jetski" : /스쿠터/i.test(type) ? "scooter" : "motorcycle", sourceUrl, sourceUpdatedAt: updated, brand, model, year, priceKrw, mileageKm, vehicleSpecs: specs, imageCount: images.length, imageUrls: images, primaryImageUrl: primary, sampleImageStatus: status, safeForImport, rejectedReason: safeForImport ? null : "missing/invalid required value or stale listing", };
}

function parseJetskiSpecs(type: string, data: Map<string, string>): Record<string, string | number | null> {
  const engine = data.get("엔진정보") ?? "";
  const fuel = /휘발유/.test(engine) ? "Бензин" : /경유/.test(engine) ? "Дизель" : "Не указано";
  const power = numberValue(engine.match(/(\d+)\s*마력/)?.[1] ?? null);
  const count = numberValue(engine.match(/마력\s*(\d+)대/)?.[1] ?? null);
  return {
    category: translated(type, "Гидроцикл"), passengers: numberValue(data.get("탑승인원") ?? null), fuel, power_hp: power, engines_count: count, country: translated(data.get("제조국가") ?? null, "Не указана"), engine_status: /확인불가/.test(engine) ? "Моточасы не указаны" : "Указаны в объявлении",
  };
}

async function main() {
  const bikeListings = (await Promise.all([0, 1, 2].map((page) => list("bike", page)))).flat().filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index).filter((item) => fresh(dateValue(item.updated)));
  const boatListings = (await list("boat", 0)).filter((item) => fresh(dateValue(item.updated)));
  const records: PilotRecord[] = [];
  for (const item of bikeListings) {
    if (records.filter((record) => record.source === "passo_bike").length >= BIKE_TARGET) break;
    const record = await build("bike", item.id, item.updated);
    if (record) records.push(record);
  }
  for (const item of boatListings) {
    if (records.filter((record) => record.vehicleType === "jetski").length >= JETSKI_TARGET) break;
    const record = await build("boat", item.id, item.updated);
    if (record) records.push(record);
  }
  const rejected = records.filter((record) => !record.safeForImport);
  const result = { mode: "read-only", generatedAt: new Date().toISOString(), targets: { bike: BIKE_TARGET, jetski: JETSKI_TARGET }, selected: records.length, safeForImport: records.filter((record) => record.safeForImport).length, rejected: rejected.length, records };
  const output = JSON.stringify(result, null, 2);
  if (process.env.PASSO_PILOT_OUTPUT_FILE) await writeFile(process.env.PASSO_PILOT_OUTPUT_FILE, output);
  console.log(output);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
