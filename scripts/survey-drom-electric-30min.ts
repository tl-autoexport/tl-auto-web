import { config } from "dotenv";

/**
 * Read-only survey of the Drom catalog for the electric motor 30-minute rating.
 *
 * Drom serves windows-1251, which a plain fetch renders as broken text, so the
 * page is decoded explicitly. For each requested model the script finds the
 * modification pages that mention a hybrid, fetches them and reports whether
 * `electric_motor_30_minute_power` is present and what value it carries.
 *
 * LIMITATION as of 2026-09-17: a direct fetch from this environment returns a
 * page without catalog links, so the survey reports zero variants. Drom appears
 * to require a real browser session. The reliable path is to capture a HAR in
 * the browser and analyse it offline, which is how the EV6 field was found.
 * The decoding and field-extraction logic here stays valid for that analysis.
 *
 * Drom was accepted by the project owner as a reviewed source for this rating.
 * No Encar requests, no database writes.
 */
config({ path: ".env.local", quiet: true });

const MODELS = (process.env.DROM_MODELS ?? "hyundai/sonata").split(",").map((value) => value.trim()).filter(Boolean);
const MAX_VARIANTS = Number(process.env.DROM_MAX_VARIANTS ?? 8);

const BASE = "https://www.drom.ru";
const decoder = new TextDecoder("windows-1251");

async function load(path: string): Promise<string | null> {
  try {
    const response = await fetch(`${BASE}${path}`, {
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        "accept-language": "ru-RU,ru;q=0.9",
      },
    });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    return decoder.decode(buffer);
  } catch {
    return null;
  }
}

function thirtyMinuteValue(html: string): number | null {
  const index = html.indexOf("electric_motor_30_minute_power");
  if (index < 0) return null;
  const window = html.slice(index, index + 4000);
  const match = window.match(/>\s*([0-9]{1,3}(?:[.,][0-9])?)\s*</);
  return match ? Number(match[1].replace(",", ".")) : null;
}

async function main() {
  const report: Array<Record<string, unknown>> = [];

  for (const model of MODELS) {
    const brand = model.split("/")[0];
    const root = await load(`/catalog/${model}/`);
    if (!root) { report.push({ model, status: "root_unavailable" }); continue; }

    const ids = [...root.matchAll(new RegExp(`/catalog/${model}/(?:[a-z0-9-]+/)?(\\d+)/`, "g"))].map((match) => match[1]);
    let unique = [...new Set(ids)].slice(0, MAX_VARIANTS);

    // The model root usually links generations, not modifications, so a second
    // hop is needed to reach the pages that actually carry the specifications.
    if (!unique.length) {
      const generationPaths = [...new Set([...root.matchAll(new RegExp(`/catalog/${model}/[a-z0-9-]+/`, "g"))].map((match) => match[0]))].slice(0, 3);
      for (const generation of generationPaths) {
        const page = await load(generation);
        if (!page) continue;
        const found = [...page.matchAll(new RegExp(`/catalog/${model}/(?:[a-z0-9-]+/)?(\\d+)/`, "g"))].map((match) => match[1]);
        unique = [...new Set([...unique, ...found])].slice(0, MAX_VARIANTS);
        if (unique.length >= MAX_VARIANTS) break;
      }
    }

    const variants: Array<Record<string, unknown>> = [];
    for (const id of unique) {
      const html = await load(`/catalog/${model}/${id}/`);
      if (!html) { variants.push({ id, status: "unavailable" }); continue; }
      const title = (html.match(/<title>([^<]{0,120})<\/title>/)?.[1] ?? "").trim();
      const hybrid = /гибрид/i.test(html);
      const value = thirtyMinuteValue(html);
      variants.push({ id, title, mentionsHybrid: hybrid, thirtyMinutePower: value,
        hasField: html.includes("electric_motor_30_minute_power") });
    }

    report.push({ model, brand, rootVariantsFound: ids.length, checked: unique.length, variants });
  }

  console.log(JSON.stringify({ models: MODELS.length, report }, null, 2));
}
main().catch((error) => { console.error(error); process.exit(1); });
