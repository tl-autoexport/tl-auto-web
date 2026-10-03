/** Step 1: read-only inventory of published TL Auto names and reusable Encar taxonomy. */
import { parse } from "dotenv";
import { Client } from "pg";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type SourceNames = {
  manufacturerCode: string | null; modelGroupCode: string | null; generationCode: string | null;
  modificationCode: string | null; trimCode: string | null;
  generationKr: string | null; modificationKr: string | null; modificationEn: string | null;
  trimKr: string | null; trimEn: string | null; domestic: string | null;
  listGenerationKr: string | null; listModificationKr: string | null; listTrimKr: string | null;
};
type Car = {
  id: string; primary_source: string; source_id: string; brand: string | null; model: string | null;
  generation: string | null; generation_code: string | null; trim: string | null;
  grade: string | null; badge: string | null; badge_detail: string | null;
  year: number | null; staging_id: string | null; staging_generation: string | null;
  staging_trim: string | null; snapshot_id: string | null; source_names: SourceNames;
};
type Taxonomy = {
  key: string; car_type: string; level: string; code: string; parent_key: string | null;
  name_kr: string; name_en: string | null; year_from: string | null; year_to: string | null;
};
const root = process.cwd();
const autoRoot = resolve(process.env.AUTOEXPORT_WEB_PROJECT_DIR ?? resolve(root, "../autoexport-web"));
const output = resolve(root, "output/catalog-naming");
const valid = (value: string | null | undefined) => Boolean(value?.trim() && !/^(?:-|unknown|null|undefined|n\/a|\(?세부등급 없음\)?)$/i.test(value.trim()));
const korean = (value: string | null | undefined) => /[\u3131-\u318e\uac00-\ud7a3]/.test(value ?? "");
const bump = (map: Record<string, number>, key: string) => { map[key] = (map[key] ?? 0) + 1; };

async function database(dir: string) {
  const env = parse(await readFile(resolve(dir, ".env.local"), "utf8"));
  if (!env.SUPABASE_DB_URL) throw new Error(`SUPABASE_DB_URL is missing for ${dir}`);
  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  await db.query("begin isolation level repeatable read read only");
  await db.query("set local statement_timeout = '90s'");
  return db;
}

async function loadTl() {
  const db = await database(root);
  try {
    const cars = (await db.query<Car>(`
      with visible as (select * from public.cars c where public.catalog_match(c,'{}'::jsonb)),
      latest as (
        select distinct on(s.source_id) s.source_id,s.payload
        from public.source_snapshots s
        where s.source='encar' and s.source_id in (select source_id from visible)
        order by s.source_id,s.fetched_at desc
      )
      select c.id,c.primary_source,c.source_id,c.brand,c.model,c.generation,c.generation_code,
        c.trim,c.grade,c.badge,c.badge_detail,c.year,
        st.source_listing_id staging_id,st.generation staging_generation,st.trim staging_trim,
        l.source_id snapshot_id,jsonb_build_object(
          'manufacturerCode',l.payload#>>'{detail,category,manufacturerCd}',
          'modelGroupCode',l.payload#>>'{detail,category,modelGroupCd}',
          'generationCode',l.payload#>>'{detail,category,modelCd}',
          'modificationCode',l.payload#>>'{detail,category,gradeCd}',
          'trimCode',l.payload#>>'{detail,category,gradeDetailCd}',
          'generationKr',l.payload#>>'{detail,category,modelName}',
          'modificationKr',l.payload#>>'{detail,category,gradeName}',
          'modificationEn',l.payload#>>'{detail,category,gradeEnglishName}',
          'trimKr',l.payload#>>'{detail,category,gradeDetailName}',
          'trimEn',l.payload#>>'{detail,category,gradeDetailEnglishName}',
          'domestic',l.payload#>>'{detail,category,domestic}',
          'listGenerationKr',l.payload#>>'{list,Model}',
          'listModificationKr',l.payload#>>'{list,Badge}',
          'listTrimKr',l.payload#>>'{list,BadgeDetail}'
        ) source_names
      from visible c left join latest l on l.source_id=c.source_id
      left join public.chestny_catalog_staging st
        on c.primary_source='chestny_prigon' and st.source_listing_id=c.source_id
      order by c.primary_source,c.source_id
    `)).rows;
    const dictionary = (await db.query<{ status: string; count: number }>(
      "select status,count(*)::int count from public.catalog_generation_dictionary group by 1 order by 1",
    )).rows;
    await db.query("commit");
    return { cars, dictionary };
  } finally { await db.end(); }
}

async function loadTaxonomy() {
  const db = await database(autoRoot);
  try {
    const rows = (await db.query<Taxonomy>(
      "select key,car_type,level,code,parent_key,name_kr,name_en,year_from,year_to from public.encar_taxonomy order by key",
    )).rows;
    await db.query("commit");
    return rows;
  } finally { await db.end(); }
}

async function main() {
  const loaded = await Promise.allSettled([loadTl(), loadTaxonomy()]);
  for (const result of loaded) if (result.status === "rejected") throw result.reason;
  const tl = (loaded[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof loadTl>>>).value;
  const taxonomy = (loaded[1] as PromiseFulfilledResult<Taxonomy[]>).value;
  if (!tl.cars.length) throw new Error("Published catalogue is empty");
  if (new Set(tl.cars.map(car => car.id)).size !== tl.cars.length) throw new Error("Source joins duplicated catalogue rows");
  const byKey = new Map(taxonomy.map(node => [node.key, node]));
  function ancestors(node: Taxonomy) {
    const result: Taxonomy[] = [];
    const seen = new Set<string>();
    let current: Taxonomy | undefined = node;
    while (current && !seen.has(current.key)) {
      seen.add(current.key); result.push(current);
      current = current.parent_key ? byKey.get(current.parent_key) : undefined;
    }
    return result;
  }
  const generationIndex = new Map<string, Taxonomy[]>();
  for (const node of taxonomy.filter(n => n.level === "model")) {
    const branch = ancestors(node);
    const maker = branch.find(n => n.level === "manufacturer");
    const group = branch.find(n => n.level === "model_group");
    if (!maker || !group) continue;
    const key = [maker.code, group.code, node.code].join("|");
    generationIndex.set(key, [...(generationIndex.get(key) ?? []), node]);
  }
  function codeMatches(car: Car) {
    const s = car.source_names;
    if (![s.manufacturerCode, s.modelGroupCode, s.generationCode].every(valid)) {
      return { generation: "missing_source_codes", trim: "generation_not_resolved", generationLabel: null, trimLabel: null };
    }
    const domestic = s.domestic?.toLowerCase();
    const carType = domestic === "true" ? "kor" : domestic === "false" ? "for" : null;
    const matches = (generationIndex.get([s.manufacturerCode, s.modelGroupCode, s.generationCode].join("|")) ?? [])
      .filter(n => !carType || n.car_type === carType);
    if (matches.length !== 1) return {
      generation: matches.length ? "ambiguous" : "not_in_loaded_dictionary",
      trim: "generation_not_resolved", generationLabel: null, trimLabel: null,
    };
    const generation = matches[0];
    if (!valid(s.trimCode) || !valid(s.modificationCode)) return {
      generation: "exact_code_path", trim: "missing_source_codes", generationLabel: generation.name_en, trimLabel: null,
    };
    const trims = taxonomy.filter(n => n.level === "badge_detail" && n.code === s.trimCode).filter(n => {
      const branch = ancestors(n);
      return branch.some(p => p.key === generation.key) && branch.some(p => p.level === "badge" && p.code === s.modificationCode);
    });
    const sameLabel = trims.length > 1 && trims.every(n => valid(n.name_en)) && new Set(trims.map(n => n.name_en?.trim())).size === 1;
    return {
      generation: "exact_code_path", trim: trims.length === 1 ? "exact_code_path" : sameLabel ? "duplicate_path_same_label" : trims.length ? "ambiguous" : "not_in_loaded_dictionary",
      generationLabel: generation.name_en, trimLabel: trims.length === 1 ? trims[0].name_en : null,
    };
  }
  const bySource: Record<string, Record<string, number>> = {};
  const codeCoverage: Record<string, { generation: Record<string, number>; trim: Record<string, number> }> = {};
  const rawValues = new Map<string, { source: string; field: string; value: string; count: number }>();
  const rows = tl.cars.map(car => {
    const s = car.source_names;
    const stats = bySource[car.primary_source] ??= {};
    bump(stats, "total");
    const flags: Record<string, boolean> = {
      storedGeneration: valid(car.generation), storedGenerationCode: valid(car.generation_code),
      storedTrim: valid(car.trim), storedVariant: [car.trim,car.badge_detail,car.badge].some(valid),
      stagingRows: Boolean(car.staging_id), stagingGeneration: valid(car.staging_generation), stagingTrim: valid(car.staging_trim),
      sourceSnapshots: Boolean(car.snapshot_id), sourceGenerationCode: valid(s.generationCode), sourceTrimCode: valid(s.trimCode),
      sourceTrimName: valid(s.trimEn) || valid(s.trimKr),
      sourceListGenerationName: valid(s.listGenerationKr), sourceListTrimName: valid(s.listTrimKr),
      recoverableGenerationName: [car.generation,car.staging_generation,s.generationKr,s.listGenerationKr].some(valid),
      recoverableTrimName: [car.trim,car.staging_trim,s.trimEn,s.trimKr,s.listTrimKr].some(valid),
      koreanStoredGeneration: korean(car.generation), koreanStoredVariant: [car.trim,car.badge_detail,car.badge].some(korean),
    };
    for (const [key, value] of Object.entries(flags)) { stats[key] ??= 0; if (value) stats[key]++; }
    for (const field of ["model","generation","trim","badge","badge_detail","staging_generation","staging_trim"] as const) {
      const value = car[field]; if (!valid(value)) continue;
      const key = [car.primary_source,field,value].join("|");
      const item = rawValues.get(key) ?? { source: car.primary_source, field, value: value!, count: 0 };
      item.count++; rawValues.set(key,item);
    }
    const matches = codeMatches(car);
    const coverage = codeCoverage[car.primary_source] ??= { generation: {}, trim: {} };
    bump(coverage.generation,matches.generation); bump(coverage.trim,matches.trim);
    return { ...car, codeMatch: matches, missingGenerationName: !flags.recoverableGenerationName, missingTrimName: !flags.recoverableTrimName };
  });
  const taxonomyCounts: Record<string, { total: number; english: number }> = {};
  for (const node of taxonomy) {
    const tally = taxonomyCounts[`${node.car_type}/${node.level}`] ??= { total: 0, english: 0 };
    tally.total++; if (valid(node.name_en) && !korean(node.name_en)) tally.english++;
  }
  const generatedAt = new Date().toISOString();
  const summary = { generatedAt, readOnly: true, databaseWrites: 0, sourceRequests: 0, total: rows.length,
    bySource, codeCoverage, taxonomyCounts, generationDictionary: tl.dictionary };
  await mkdir(output,{ recursive: true });
  await writeFile(resolve(output,"audit.json"),JSON.stringify({ ...summary, rows, rawValues: [...rawValues.values()] },null,2));
  await writeFile(resolve(output,"taxonomy-snapshot.json"),JSON.stringify({ generatedAt, nodes: taxonomy },null,2));
  const table = ["| Источник | Машин | Название поколения в карточке | Код поколения TL Auto | Комплектация в карточке | Комплектация в staging | Название комплектации доступно локально |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(bySource).map(([source,s]) => `| ${source} | ${s.total} | ${s.storedGeneration} | ${s.storedGenerationCode} | ${s.storedTrim} | ${s.stagingTrim} | ${s.recoverableTrimName} |`)];
  const examples = [...rawValues.values()].filter(x => ["generation","staging_generation","trim","staging_trim"].includes(x.field))
    .sort((a,b) => b.count-a.count).slice(0,24).map(x => `| ${x.source} | ${x.field} | ${x.value.replace(/\|/g,"/")} | ${x.count} |`);
  const report = `# Аудит названий TL Auto — шаг 1\n\nДата: ${generatedAt}. Только чтение; записей в БД: 0; запросов к источникам объявлений: 0.\n\nПроверено ${rows.length} опубликованных машин по public.catalog_match. Проверена уникальность ID после объединения источников.\n\n${table.join("\n")}\n\n«Название комплектации доступно локально» означает наличие строки в cars.trim, staging.trim или gradeDetailName/gradeDetailEnglishName снимка Encar. Это ещё не подтверждение правильности экранного названия. badge/grade сами по себе не считаются комплектацией.\n\n## Сопоставление с Autoexport Web только по полному пути кодов\n\n\`\`\`json\n${JSON.stringify(codeCoverage,null,2)}\n\`\`\`\n\nБез кодов сопоставление на шаге 1 не предполагается. Пробное сопоставление строк, исправление названий и расширение словаря — шаг 2. Наличие английской подписи не означает, что она уже отредактирована для TL Auto.\n\n## Частые исходные названия\n\n| Источник | Поле | Значение | Машин |\n| --- | --- | --- | ---: |\n${examples.join("\n")}\n\n## Результат проверки\n\nПолный отчёт: output/catalog-naming/audit.json. Снимок таксономии: output/catalog-naming/taxonomy-snapshot.json. Исходные строки сохранены; каталог и сайт не изменены.\n\nСледующий шаг: локальный справочник TL Auto и пробное сопоставление с учётом полных веток, регистров, аббревиатур и отдельных сущностей «поколение / модификация / комплектация».\n`;
  await writeFile(resolve(root,"docs/catalog-naming-step-1-audit.md"),report.replace(
    "cars.trim, staging.trim или gradeDetailName/gradeDetailEnglishName снимка Encar",
    "cars.trim, staging.trim, gradeDetailName/gradeDetailEnglishName или list.BadgeDetail снимка Encar (значения вроде «세부등급 없음» исключены)",
  ));
  console.log(JSON.stringify(summary,null,2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode=1; });
