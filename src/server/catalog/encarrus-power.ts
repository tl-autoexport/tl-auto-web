export type EncarrusPowerEvidence = {
  source: "listing_card" | "product_detail";
  rawPowerText: string | null;
  rawPowerNote: string | null;
  displayedPowerHp: number | null;
  hybridCombinedPowerHp: number | null;
  hybridEnginePowerHp: number | null;
  recyclingPowerHp: number | null;
  electric30MinPowerHp: number | null;
  powerBasis: "electric_peak_and_30min" | "hybrid_combined_with_components" | "displayed_basis_unspecified" | "unknown";
};

function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, value: string) => String.fromCodePoint(Number(value)))
    .replace(/&#x([\da-f]+);/gi, (_match, value: string) => String.fromCodePoint(parseInt(value, 16)))
    .replace(/\s+/g, " ").trim();
}

function powerNumber(text: string | null): number | null {
  if (!text) return null;
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(?:л\.?\s*с\.?|лошадин(?:ых)?\s*сил|hp|ps)/i);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function labeledPower(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function makeEvidence(input: {
  source: EncarrusPowerEvidence["source"];
  powerText: string | null;
  powerNote?: string | null;
  fuelType: string | null;
}): EncarrusPowerEvidence {
  const text = [input.powerText, input.powerNote].filter(Boolean).join(" ");
  const displayedPowerHp = powerNumber(input.powerText);
  const electric30MinPowerHp = labeledPower(text, /30\s*[-–]?\s*мин(?:ут\w*)?\D{0,30}?(\d+(?:[.,]\d+)?)/i);
  const hybridEnginePowerHp = labeledPower(text, /(?:двигатель|двс)\D{0,20}?(\d+(?:[.,]\d+)?)\s*(?:л\.?\s*с\.?)?/i);
  const recyclingPowerHp = labeledPower(text, /(?:утильсбор\w*|утилизационн\w*)[^.\d]{0,60}(\d+(?:[.,]\d+)?)\s*(?:л\.?\s*с\.?)?/i);
  const isHybrid = input.fuelType === "hybrid";
  const isElectric = input.fuelType === "electric";
  const explicitlyCombined = /суммарн|совокупн|общая мощност/i.test(text);
  const hybridCombinedPowerHp = isHybrid && explicitlyCombined ? displayedPowerHp : null;

  return {
    source: input.source,
    rawPowerText: input.powerText,
    rawPowerNote: input.powerNote ?? null,
    displayedPowerHp,
    hybridCombinedPowerHp,
    hybridEnginePowerHp: isHybrid ? hybridEnginePowerHp : null,
    recyclingPowerHp: isHybrid ? recyclingPowerHp : null,
    electric30MinPowerHp: isElectric || isHybrid ? electric30MinPowerHp : null,
    powerBasis: isElectric && displayedPowerHp != null && electric30MinPowerHp != null
      ? "electric_peak_and_30min"
      : isHybrid && hybridCombinedPowerHp != null && hybridEnginePowerHp != null && recyclingPowerHp != null
        ? "hybrid_combined_with_components"
        : displayedPowerHp != null ? "displayed_basis_unspecified" : "unknown",
  };
}

/** Parse power from EncarRus listing-card HTML, preserving nested power-30min markup. */
export function parseEncarrusListingPower(cardHtml: string, fuelType: string | null): EncarrusPowerEvidence {
  const property = [...cardHtml.matchAll(/<div class="c-prop">\s*<span class="c-prop-k">([^<]+)<\/span>\s*<span class="c-prop-v">([\s\S]*?)<\/div>/g)]
    .find((match) => textOf(match[1]) === "Мощн.");
  const powerHtml = property?.[2] ?? null;
  const noteHtml = powerHtml?.match(/<span[^>]*class="[^"]*power-30min[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? null;
  return makeEvidence({ source: "listing_card", powerText: powerHtml ? textOf(powerHtml) : null, powerNote: noteHtml ? textOf(noteHtml) : null, fuelType });
}

/** Parse EncarRus product-page `.pd-spec` power label/value/sub-label blocks. */
export function parseEncarrusProductPower(html: string, fuelType: string | null): EncarrusPowerEvidence {
  const blocks = [...html.matchAll(/<div class="pd-spec">([\s\S]*?)(?=<div class="pd-spec">|$)/g)].map((match) => match[1]);
  const powerBlock = blocks.find((block) => textOf(block.match(/<div class="sp-lbl">([\s\S]*?)<\/div>/i)?.[1] ?? "") === "Мощность");
  const value = powerBlock?.match(/<div class="sp-val">([\s\S]*?)<\/div>/i)?.[1] ?? null;
  const note = powerBlock?.match(/<div class="sp-sub">([\s\S]*?)<\/div>/i)?.[1] ?? null;
  const evidence = makeEvidence({ source: "product_detail", powerText: value ? textOf(value) : null, powerNote: note ? textOf(note) : null, fuelType });

  // The product page repeats a compact spec; use it only as a fallback if the
  // primary power label is absent, never to overwrite the labeled power block.
  if (evidence.displayedPowerHp != null) return evidence;
  const compact = html.match(/<div class="ps-spec"><span class="k">Мощность<\/span>\s*<span class="v">([\s\S]*?)<\/span><\/div>/i)?.[1];
  if (!compact) return evidence;
  return makeEvidence({ source: "product_detail", powerText: textOf(compact), fuelType });
}

/** EncarRus uses the Korean-market name Avante for Hyundai Elantra. */
export function encarrusModelAliases(brand: string | null, model: string | null): string[] {
  const key = `${String(brand ?? "").toLowerCase().replace(/[^a-z]/g, "")}:${String(model ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  if (key === "hyundai:elantra") return ["avante"];
  return [];
}
