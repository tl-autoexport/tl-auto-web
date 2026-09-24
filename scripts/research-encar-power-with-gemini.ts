/**
 * Read-only AI/web research for a small batch of unresolved Encar configurations.
 * It writes a local JSON report only: no DB writes, price changes or publication.
 */
import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

config({ path: ".env.local", override: true, quiet: true });
config({ path: ".env", quiet: true });

type WorkGroup = {
  brand: string | null;
  model: string | null;
  generation: string | null;
  year: number | null;
  engineCc: number | null;
  fuelType: string | null;
  driveType: string | null;
  listingIds: string[];
  badgeExamples: string[];
};

type PowerResearch = {
  estimated_power_ps: number | null;
  exact_configuration_match: "exact" | "close" | "unclear";
  confidence: "high" | "medium" | "low";
  sources: Array<{ title: string; url: string; source_type: string; source_date: string | null; finding: string }>;
  conflicts: string[];
  rationale: string;
};

type GeminiResponse = {
  error?: unknown;
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: { groundingChunks?: Array<{ web?: { title?: string; uri?: string } }>; [key: string]: unknown };
  }>;
};

type DeepSeekResponse = {
  error?: unknown;
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
};

const inputPath = process.env.POWER_AI_INPUT ?? "output/tl-auto-new-encar-power-plan.json";
const outputPath = process.env.POWER_AI_OUTPUT ?? "output/tl-auto-new-encar-ai-research.json";
const retryFromPath = process.env.POWER_AI_RETRY_FROM;
const limit = Math.max(1, Math.min(50, Number(process.env.POWER_AI_LIMIT ?? 20)));
const apiKey = process.env.GEMINI_API_KEY;
const deepSeekApiKey = process.env.DEEPSEEK_API_KEY;
const dryRun = process.env.POWER_AI_DRY_RUN !== "false";
const resume = process.env.POWER_AI_RESUME !== "false";
const model = process.env.GEMINI_POWER_MODEL ?? "gemini-2.5-flash";
const deepSeekModel = process.env.DEEPSEEK_POWER_MODEL ?? "deepseek-flash";
const timeoutMs = Math.max(15_000, Number(process.env.POWER_AI_TIMEOUT_MS ?? 90_000));
const providerMaxAttempts = Math.max(1, Math.min(3, Number(process.env.POWER_AI_MAX_ATTEMPTS ?? 3)));

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function parseResearch(text: string): PowerResearch {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Gemini response did not contain a JSON object");
  const value = JSON.parse(cleaned.slice(start, end + 1)) as Partial<PowerResearch>;
  const power = value.estimated_power_ps;
  if (power !== null && (typeof power !== "number" || !Number.isFinite(power) || power < 1 || power > 2500)) {
    throw new Error("Gemini returned an invalid estimated_power_ps");
  }
  const sources = Array.isArray(value.sources) ? value.sources.filter((source) =>
    typeof source?.url === "string" && /^https?:\/\//i.test(source.url),
  ) : [];
  return {
    estimated_power_ps: power ?? null,
    exact_configuration_match: ["exact", "close", "unclear"].includes(String(value.exact_configuration_match))
      ? value.exact_configuration_match as PowerResearch["exact_configuration_match"] : "unclear",
    confidence: ["high", "medium", "low"].includes(String(value.confidence))
      ? value.confidence as PowerResearch["confidence"] : "low",
    sources: sources.map((source) => ({
      title: String(source.title ?? ""), url: source.url, source_type: String(source.source_type ?? "unknown"),
      source_date: source.source_date == null ? null : String(source.source_date), finding: String(source.finding ?? ""),
    })),
    conflicts: Array.isArray(value.conflicts) ? value.conflicts.map(String) : [],
    rationale: String(value.rationale ?? ""),
  };
}

function isRetryableProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:fetch failed|aborted|HTTP (?:429|5\d\d)|ECONN|ETIMEDOUT|EAI_AGAIN|socket|Gemini response did not contain a JSON object|Gemini returned an invalid estimated_power_ps)/i.test(message);
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withProviderRetries<T>(operation: () => Promise<T>): Promise<{ value: T; attempts: number }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= providerMaxAttempts; attempt += 1) {
    try {
      return { value: await operation(), attempts: attempt };
    } catch (error) {
      lastError = error;
      if (!isRetryableProviderError(error) || attempt === providerMaxAttempts) break;
      // Bounded exponential backoff avoids turning a short provider outage
      // into a permanent "no power" result while respecting API limits.
      await wait(2_000 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

async function research(group: WorkGroup): Promise<{ parsed: PowerResearch; raw: GeminiResponse }> {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured; no AI request was made");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const vehicle = {
      make: group.brand, model: group.model, generation: group.generation, model_year: group.year,
      engine_displacement_cc: group.engineCc, fuel: group.fuelType, drivetrain: group.driveType,
      listing_badges: group.badgeExamples,
    };
    const prompt = [
      "Research factory engine power for this South Korean-market vehicle using web search.",
      "Search manufacturer specifications/catalogues first, then homologation or official documents, then multiple independent catalogues.",
      "Do not infer power from displacement alone. Do not treat trim-name similarity as proof of configuration identity.",
      "Return a candidate estimate even when not fully confirmed, but mark confidence and configuration match honestly.",
      "Every claimed power must have at least one source URL in sources. If no source supports a value, return null.",
      "Record conflicts instead of choosing silently. Power must be PS (metric horsepower), not SAE hp; if a source uses kW, convert and say so in finding.",
      "Output only JSON with keys estimated_power_ps (number|null), exact_configuration_match (exact|close|unclear), confidence (high|medium|low), sources (array of {title,url,source_type,source_date,finding}), conflicts (string array), rationale (string).",
      `Vehicle: ${JSON.stringify(vehicle)}`,
    ].join("\n");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        // Gemini's Google Search grounding tool rejects responseMimeType JSON;
        // request JSON in the prompt and validate/parse it before use instead.
        generationConfig: { temperature: 0.1 },
      }),
      signal: controller.signal,
    });
    const raw = await response.json() as GeminiResponse;
    if (!response.ok) throw new Error(`Gemini HTTP ${response.status}: ${JSON.stringify(raw.error ?? raw).slice(0, 600)}`);
    const text = (raw.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("\n");
    const parsed = parseResearch(text);
    const grounding = raw.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const groundedSources = grounding.flatMap((chunk) => chunk.web?.uri ? [{
      title: String(chunk.web.title ?? ""), url: String(chunk.web.uri), source_type: "Gemini Google Search grounding",
      source_date: null, finding: "Search-grounding link; verify the page and the claim before promotion.",
    }] : []);
    const merged = new Map([...parsed.sources, ...groundedSources].map((source) => [source.url, source]));
    parsed.sources = [...merged.values()];
    return { parsed, raw };
  } finally {
    clearTimeout(timeout);
  }
}

async function reviewWithDeepSeek(group: WorkGroup, gemini: PowerResearch): Promise<{ parsed: PowerResearch; raw: DeepSeekResponse; citedSources: PowerResearch["sources"]; parseError: string | null }> {
  if (!deepSeekApiKey) throw new Error("DEEPSEEK_API_KEY is not configured; no DeepSeek request was made");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const instructions = [
      "You are the second-stage reviewer for vehicle factory power research.",
      "Use only the supplied Gemini web-search findings and URLs. You do not have web search in this request.",
      "Do not add sources, URLs, dates, or facts from memory. Do not infer power from engine displacement alone.",
      "Check whether each source refers to the same market, model/generation, year, fuel, engine and drivetrain.",
      "If evidence is insufficient, conflicting, or configuration differs, return estimated_power_ps=null or mark close/unclear and explain conflicts.",
      "Power unit is metric PS. Preserve only URLs present in supplied sources.",
      "Return JSON only with keys estimated_power_ps (number|null), exact_configuration_match (exact|close|unclear), confidence (high|medium|low), sources (array of {title,url,source_type,source_date,finding}), conflicts (string array), rationale (string).",
    ].join(" ");
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${deepSeekApiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: deepSeekModel,
        thinking: { type: "disabled" },
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: JSON.stringify({
            vehicle: {
              brand: group.brand, model: group.model, generation: group.generation, year: group.year,
              engineCc: group.engineCc, fuelType: group.fuelType, driveType: group.driveType, badges: group.badgeExamples,
            },
            GeminiResearch: gemini,
          }) },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });
    const raw = await response.json() as DeepSeekResponse;
    if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}: ${JSON.stringify(raw.error ?? raw).slice(0, 600)}`);
    const text = raw.choices?.[0]?.message?.content;
    if (!text) throw new Error(`DeepSeek returned no message content (finish_reason=${raw.choices?.[0]?.finish_reason ?? "unknown"})`);
    let parsed: PowerResearch;
    let parseError: string | null = null;
    try {
      parsed = parseResearch(text);
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
      parsed = {
        estimated_power_ps: null, exact_configuration_match: "unclear", confidence: "low",
        sources: [], conflicts: [`Ответ DeepSeek не прошёл JSON-проверку: ${parseError}`],
        rationale: "Результат требует повторного просмотра; мощность автоматически не извлекалась.",
      };
    }
    const allowedUrls = new Set(gemini.sources.map((source) => source.url));
    const citedSources = parsed.sources.filter((source) => allowedUrls.has(source.url));
    if (parsed.estimated_power_ps != null && citedSources.length === 0) {
      parsed.conflicts.push("DeepSeek предложил мощность, но не сослался ни на один URL из проверенных Gemini источников.");
      parsed.estimated_power_ps = null;
      parsed.confidence = "low";
    }
    parsed.sources = citedSources;
    return { parsed, raw, citedSources, parseError };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const input = JSON.parse(await readFile(inputPath, "utf8")) as { externalSearch?: { worklist?: WorkGroup[] } };
  const worklist = input.externalSearch?.worklist;
  if (!Array.isArray(worklist)) throw new Error(`No externalSearch.worklist in ${inputPath}`);

  // Exclude configurations already given a preliminary reference in the prior source pass.
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is required for read-only duplicate/configuration filtering");
  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  let known: Array<{ brand: string | null; model: string | null; fuel_type: string | null; engine_cc: number | null; drive_type: string | null; badge: string | null; badge_detail: string | null; year_from: number | null; year_to: number | null }>;
  try {
    await db.query("begin read only");
    const result = await db.query(`select brand,model,fuel_type,engine_cc,drive_type,badge,badge_detail,year_from,year_to
      from public.vehicle_power_automatic_reference where status='automatic'`);
    known = result.rows;
    await db.query("commit");
  } finally { await db.end(); }

  const isCoveredByReferences = (group: WorkGroup) => {
    const compatible = known.filter((ref) =>
      normalize(ref.brand) === normalize(group.brand) && normalize(ref.model) === normalize(group.model) &&
      normalize(ref.fuel_type) === normalize(group.fuelType) && Number(ref.engine_cc) === Number(group.engineCc) &&
      (ref.drive_type == null ? group.driveType == null : group.driveType != null && normalize(ref.drive_type) === normalize(group.driveType)) &&
      ref.badge_detail == null &&
      (ref.year_from == null || group.year == null || (group.year >= ref.year_from && group.year <= (ref.year_to ?? ref.year_from))),
    );
    if (!group.badgeExamples.length) return compatible.some((ref) => ref.badge == null);
    // Different listings in one configuration group may carry different trim labels.
    // Treat the group as covered only when every observed label has its own exact or wildcard row.
    return group.badgeExamples.every((badge) => compatible.some((ref) => ref.badge == null || normalize(ref.badge) === normalize(badge)));
  };
  const remaining = worklist.filter((group) => !isCoveredByReferences(group));
  let selected = remaining.sort((a, b) => b.listingIds.length - a.listingIds.length ||
    String(a.brand).localeCompare(String(b.brand)) || String(a.model).localeCompare(String(b.model))).slice(0, limit);
  if (retryFromPath) {
    const previous = JSON.parse(await readFile(retryFromPath, "utf8")) as { results?: Array<Record<string, unknown>> };
    const retryKeys = new Set((previous.results ?? [])
      .filter((row) => row.status === "provider_error" || row.status === "deepseek_error")
      .map((row) => Array.isArray(row.listingIds) ? row.listingIds.map(String).join(",") : ""));
    selected = selected.filter((group) => retryKeys.has(group.listingIds.map(String).join(",")));
  }
  if (!dryRun && !apiKey) throw new Error("GEMINI_API_KEY is required when POWER_AI_DRY_RUN=false");
  if (!dryRun && !deepSeekApiKey) throw new Error("DEEPSEEK_API_KEY is required when POWER_AI_DRY_RUN=false");
  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(), input: inputPath, limit, providers: ["Gemini Google Search grounding", "DeepSeek evidence review"],
    dryRun, readOnly: true, databaseWrites: 0, priceChanges: 0, publications: 0,
    retryFrom: retryFromPath ?? null,
    alreadyCoveredConfigurations: worklist.length - remaining.length,
    candidateConfigurations: selected.length, candidateListings: selected.reduce((sum, group) => sum + group.listingIds.length, 0),
    results: [],
  };
  const results: unknown[] = [];
  const previousByListings = new Map<string, Record<string, unknown>>();
  if (resume && !dryRun) {
    try {
      const previous = JSON.parse(await readFile(outputPath, "utf8")) as { input?: string; results?: Array<Record<string, unknown>> };
      if (previous.input === inputPath) {
        for (const row of previous.results ?? []) {
          const ids = row.listingIds;
          if (Array.isArray(ids) && row.geminiResearch && row.rawResponses && typeof row.rawResponses === "object") {
            previousByListings.set(ids.map(String).join(","), row);
          }
        }
      }
    } catch { /* No prior report; start a fresh run. */ }
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  if (dryRun) {
    report.results = selected.map((group) => ({ ...group, status: "pending_ai_research" }));
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ...report, results: undefined, output: outputPath }, null, 2));
    return;
  }
  for (const [index, group] of selected.entries()) {
    const identity = { ...group, listingIds: group.listingIds };
    let result: Awaited<ReturnType<typeof research>>;
    let geminiAttempts = 0;
    const previous = previousByListings.get(group.listingIds.join(","));
    const previousRaw = previous?.rawResponses as { gemini?: GeminiResponse } | undefined;
    if (previous?.geminiResearch && previousRaw?.gemini) {
      result = { parsed: previous.geminiResearch as PowerResearch, raw: previousRaw.gemini };
    } else {
      try {
        const retry = await withProviderRetries(() => research(group));
        result = retry.value;
        geminiAttempts = retry.attempts;
      } catch (error) {
        results.push({ ...identity, status: "provider_error", attempts: providerMaxAttempts, error: error instanceof Error ? error.message : String(error) });
        report.results = results;
        await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
        console.error(JSON.stringify({ completed: index + 1, total: selected.length, status: "provider_error" }));
        continue;
      }
    }
    let deepSeek: Awaited<ReturnType<typeof reviewWithDeepSeek>>;
    try {
      const retry = await withProviderRetries(() => reviewWithDeepSeek(group, result.parsed));
      deepSeek = retry.value;
    } catch (error) {
      results.push({
        ...identity, status: "deepseek_error", error: error instanceof Error ? error.message : String(error),
        geminiAttempts,
        geminiCandidatePowerPs: result.parsed.estimated_power_ps, geminiResearch: result.parsed,
        groundingMetadata: result.raw.candidates?.[0]?.groundingMetadata ?? null,
        rawResponses: { gemini: result.raw },
      });
      report.results = results;
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
      console.error(JSON.stringify({ completed: index + 1, total: selected.length, status: "deepseek_error" }));
      continue;
    }
    const disagreement = result.parsed.estimated_power_ps != null && deepSeek.parsed.estimated_power_ps != null &&
      result.parsed.estimated_power_ps !== deepSeek.parsed.estimated_power_ps;
    const finalPowerPs = disagreement ? null : deepSeek.parsed.estimated_power_ps;
    results.push({
      ...identity,
      status: deepSeek.parseError ? "deepseek_parse_error" : disagreement ? "model_disagreement" : finalPowerPs == null ? "needs_review_or_no_power" : "preliminary_candidate",
      geminiAttempts,
      confidence: deepSeek.parsed.confidence,
      geminiCandidatePowerPs: result.parsed.estimated_power_ps,
      deepSeekCandidatePowerPs: deepSeek.parsed.estimated_power_ps,
      estimatedPowerPs: finalPowerPs,
      estimatedPowerKw: finalPowerPs == null ? null : Number((finalPowerPs * 0.73549875).toFixed(4)),
      exactConfigurationMatch: deepSeek.parsed.exact_configuration_match,
      sources: deepSeek.citedSources,
      conflicts: [...new Set([...result.parsed.conflicts, ...deepSeek.parsed.conflicts, ...(disagreement ? ["Мощности Gemini и DeepSeek расходятся; значение не выбрано автоматически."] : [])])],
      rationale: deepSeek.parsed.rationale,
      geminiResearch: result.parsed,
      deepSeekReview: deepSeek.parsed,
      deepSeekParseError: deepSeek.parseError,
      groundingMetadata: result.raw.candidates?.[0]?.groundingMetadata ?? null,
      rawResponses: { gemini: result.raw, deepseek: deepSeek.raw },
    });
    report.results = results;
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ completed: index + 1, total: selected.length, listings: group.listingIds.length, reusedGemini: Boolean(previousRaw?.gemini), status: (results.at(-1) as { status: string }).status }));
    if (index + 1 < selected.length) await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  console.log(JSON.stringify({ ...report, results: undefined, output: outputPath }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
