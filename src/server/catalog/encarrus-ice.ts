import { parseEncarrusListingPower, type EncarrusPowerEvidence } from "./encarrus-power";

export type EncarrusIceCard = {
  encarrusListingId: string;
  name: string;
  trim: string;
  year: number | null;
  engineText: string | null;
  engineCc: number | null;
  fuelType: "gasoline" | "diesel" | null;
  displayedPowerText: string | null;
  displayedPowerHp: number | null;
  powerBasis: EncarrusPowerEvidence["powerBasis"];
  driveText: string | null;
  modelUrl: string;
  productUrl: string | null;
};

function clean(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, value: string) => String.fromCodePoint(Number(value)))
    .replace(/&#x([\da-f]+);/gi, (_match, value: string) => String.fromCodePoint(parseInt(value, 16)))
    .replace(/\s+/g, " ").trim();
}

export function normalizeEncarrusText(value: string | null | undefined) {
  return String(value ?? "").toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]/g, "");
}

export function encarrusFuelType(value: string | null): "gasoline" | "diesel" | null {
  if (!value) return null;
  const text = value.toLowerCase();
  const gasoline = /бензин|бензинов|gasoline|petrol|가솔린/.test(text);
  const diesel = /дизел|diesel|경유/.test(text);
  if (gasoline === diesel) return null;
  return gasoline ? "gasoline" : "diesel";
}

export function encarrusEngineCc(value: string | null): number | null {
  if (!value) return null;
  const text = clean(value).toLowerCase().replace(/,/g, ".");
  const cc = text.match(/(\d{3,4})\s*(?:см[³3]?|cc)(?![a-zа-я])/i);
  if (cc) return Number(cc[1]);
  const liters = text.match(/(\d(?:\.\d{1,2})?)\s*(?:л(?:итр(?:а|ов)?)?|l)(?![a-zа-я])/i);
  if (liters) return Math.round(Number(liters[1]) * 1000);
  return null;
}

export function parseEncarrusIceCards(html: string, modelUrl: string): EncarrusIceCard[] {
  const starts = [...html.matchAll(/<div class="element--wrapper[^\"]*" id="card_(\d+)"/g)];
  const cards: EncarrusIceCard[] = [];
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index].index ?? 0;
    const end = starts[index + 1]?.index ?? html.length;
    const cardHtml = html.slice(start, end);
    const id = starts[index][1];
    const name = clean(cardHtml.match(/class="c-name">([^<]*)</)?.[1] ?? "");
    const trim = clean(cardHtml.match(/class="c-trim">([^<]*)</)?.[1] ?? "");
    const props = new Map([...cardHtml.matchAll(/<div class="c-prop">\s*<span class="c-prop-k">([^<]+)<\/span>\s*<span class="c-prop-v">([\s\S]*?)<\/div>/g)]
      .map((match) => [clean(match[1]), clean(match[2])]));
    const engineText = props.get("Двиг.") ?? null;
    const fuelType = encarrusFuelType(engineText);
    const power = parseEncarrusListingPower(cardHtml, fuelType);
    const productPath = cardHtml.match(/href="([^"]*\/korea\/product\/\d+\/[^"]*)"/i)?.[1] ?? null;
    const year = Number(trim.match(/\b(19|20)\d{2}\b/)?.[0]) || null;
    cards.push({
      encarrusListingId: id,
      name,
      trim,
      year,
      engineText,
      engineCc: encarrusEngineCc(engineText),
      fuelType,
      displayedPowerText: power.rawPowerText,
      displayedPowerHp: power.displayedPowerHp,
      powerBasis: power.powerBasis,
      driveText: props.get("Привод") ?? null,
      modelUrl: `https://encarrus.ru${modelUrl}`,
      productUrl: productPath ? new URL(productPath, "https://encarrus.ru").toString() : null,
    });
  }
  return cards;
}

export function encarrusIceMatch(card: EncarrusIceCard, group: {
  year: number | null; engineCc: number | null; fuelType: string | null; driveType: string | null;
}) {
  if (card.year == null || card.year !== group.year) return { matched: false, reason: "year_mismatch_or_missing" };
  if (card.fuelType == null || card.fuelType !== group.fuelType) return { matched: false, reason: "fuel_mismatch_or_unrecognized" };
  if (card.engineCc == null || group.engineCc == null || Math.abs(card.engineCc - group.engineCc) > 120)
    return { matched: false, reason: "engine_displacement_mismatch_or_missing" };
  if (group.driveType && card.driveText) {
    const target = normalizeEncarrusText(group.driveType);
    const source = normalizeEncarrusText(card.driveText);
    const wants4wd = /4wd|4x4|awd/.test(target);
    const wants2wd = /2wd|fwd|rwd/.test(target);
    const has4wd = /4wd|4x4|awd|полный/.test(source);
    const has2wd = /2wd|fwd|rwd|передний|задний/.test(source);
    if ((wants4wd && !has4wd) || (wants2wd && !has2wd)) return { matched: false, reason: "drive_mismatch" };
  }
  return { matched: true, reason: group.driveType && !card.driveText ? "drive_unverified" : "exact_core_configuration" };
}
