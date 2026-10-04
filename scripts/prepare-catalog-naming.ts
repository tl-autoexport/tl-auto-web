/** Step 2: build a local dictionary and naming proposals from saved data only. No database writes. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveCatalogNaming, type Car, type Node, type GenerationAlias } from "../src/server/catalog/catalog-naming-resolver";
import { containsKoreanName, isOrdinalOnlyName, namingKey, namingRulesVersion } from "../src/server/catalog/catalog-naming";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const root = process.cwd();
const output = resolve(root,"output/catalog-naming");
const localData = resolve(root,"data/catalog-naming");
const bump = (map: Record<string,number>, key: string) => { map[key] = (map[key] ?? 0)+1; };

async function main() {
  const [auditText,taxonomyText,aliasText,rulesText] = await Promise.all([
    readFile(resolve(output,"audit.json"),"utf8"),readFile(resolve(output,"taxonomy-snapshot.json"),"utf8"),
    readFile(resolve(output,"generation-dictionary-snapshot.json"),"utf8"),
    readFile(resolve(localData,"label-rules-v1.json"),"utf8"),
  ]);
  const audit = JSON.parse(auditText) as { generatedAt: string; total: number; rows: Car[] };
  const snapshot = JSON.parse(taxonomyText) as { generatedAt: string; nodes: Node[] };
  const aliases = (JSON.parse(aliasText) as { rows: GenerationAlias[] }).rows;
  const {rows:rowProposals,dictionaryNodes,repairs,duplicateNameGroups}=resolveCatalogNaming(audit.rows,snapshot.nodes,aliases);
  const bySource: Record<string,{ total:number; generation:Record<string,number>; modification:Record<string,number>; trim:Record<string,number>; visibleGeneration:number; versionLine:number; issues:Record<string,number> }> = {};
  for (const r of rowProposals) {
    const s = bySource[r.source] ??= { total:0,generation:{},modification:{},trim:{},visibleGeneration:0,versionLine:0,issues:{} };
    s.total++;if(r.generation.label)s.visibleGeneration++;if(r.versionLine)s.versionLine++;
    for(const field of ["generation","modification","trim"] as const)bump(s[field],r[field].status);
    for(const issue of r.issues)bump(s.issues,issue);
    for(const label of [r.brand,r.model,r.generation.label,r.generation.fullName,r.modification.label,r.trim.label]) {
      if(label && containsKoreanName(label))throw new Error(`Untranslated label proposed for ${r.sourceListingId}`);
    }
    if(r.trim.label && isOrdinalOnlyName(r.trim.label))throw new Error(`Ordinal proposed as trim for ${r.sourceListingId}`);
  }
  if(rowProposals.length!==audit.total || new Set(rowProposals.map(r=>r.id)).size!==audit.total)throw new Error("Proposals do not cover each audited car exactly once");
  const generatedAt = new Date().toISOString();
  const metadata = { version:namingRulesVersion,generatedAt,auditGeneratedAt:audit.generatedAt,
    sourceProject:"autoexport-web",sourceSnapshotAt:snapshot.generatedAt,
    inputHashes:{ audit:hash(auditText),taxonomy:hash(taxonomyText),generationAliases:hash(aliasText),rules:hash(rulesText) },
    readOnly:true,databaseWrites:0,sourceRequests:0 };
  await mkdir(localData,{recursive:true});
  await writeFile(resolve(localData,"encar-taxonomy-v1.json"),JSON.stringify({...metadata,nodes:dictionaryNodes,duplicateNameGroups,labelRepairs:repairs},null,2));
  await writeFile(resolve(localData,"generation-aliases-v1.json"),JSON.stringify({version:namingRulesVersion,aliases:aliases.filter(a=>a.status==='approved')},null,2));
  const samples = [
    ["Kia","Ray","Prestige"],["Hyundai","Sonata","Premium"],["Genesis","GV80",""],["BMW","5 Series","M Sport"],["Mercedes-Benz","E-Class","Avantgarde"],
  ].map(([brand,model,trim]) => rowProposals.filter(r=>namingKey(r.brand)===namingKey(brand)&&namingKey(r.model)===namingKey(model))
    .sort((a,b)=>Number((b.trim.label??"")===trim)-Number((a.trim.label??"")===trim) || Number(Boolean(b.generation.label))-Number(Boolean(a.generation.label)))[0]).filter(Boolean);
  const report = { ...metadata,total:rowProposals.length,dictionaryNodes:dictionaryNodes.length,duplicateNameGroups:duplicateNameGroups.length,
    labelRepairs:repairs.length,bySource,samples,rows:rowProposals };
  await writeFile(resolve(output,"proposals.json"),JSON.stringify(report,null,2));
  await writeFile(resolve(output,"review.json"),JSON.stringify({ ...metadata,rows:rowProposals.filter(r=>r.issues.length || [r.generation.status,r.modification.status,r.trim.status].some(s=>['needs_review','conflict'].includes(s))) },null,2));
  const sampleRows = samples.map(r=>`| ${r.sourceListingId} | ${r.title} | ${r.generation.label??'—'} | ${r.modification.label??'—'} | ${r.trim.label??'—'} |`);
  const modelChanges = rowProposals.filter(r=>r.issues.includes("source_model_differs_from_catalog"));
  const modelChangeCounts: Record<string,number> = {};
  for(const r of modelChanges)bump(modelChangeCounts,`${r.original.model} → ${r.model}`);
  const summaryRows = Object.entries(bySource).map(([source,s])=>`| ${source} | ${s.total} | ${s.versionLine} | ${s.trim.resolved??0} | ${s.visibleGeneration} |`);
  const findings = `## Итог для проверки\n\n| Источник | Машин | Есть строка версии | Отдельная комплектация | Подпись поколения |\n| --- | --- | --- | --- | --- |\n${summaryRows.join("\n")}\n\n- Строка версии отсутствует у ${rowProposals.filter(r=>!r.versionLine).length} машин. MINI Cooper извлечён из явно указанного названия ветки источника.\n- Если у поколения нет шасси-кода или порядкового номера, используется название варианта Encar; годы выпуска добавляются, чтобы различать одноимённые версии.\n- У 37 машин «Честного пригона» отсутствует исходное название поколения, поэтому оно оставлено пустым.\n- Пять порядковых названий разобраны по точным кодовым веткам Encar: Bentley Brooklands, Lexus RC F, Honda Odyssey. Номер перенесён в поколение, отдельный пакет комплектации источник не задаёт.\n- Предложены исправления модели для ${modelChanges.length} машин: ${Object.entries(modelChangeCounts).map(([name,count])=>`${name}: ${count}`).join("; ")}. Эти исправления требуют проверки перед записью.\n- Для MINI отдельно обработана иерархия источника: номер поколения, версия Cooper S/SD/D и комплектация разделены.\n- Отсутствие отдельной комплектации не означает отсутствие версии: у машины может быть только модификация двигателя.\n\n`;
  const md = `# Справочник и пробное сопоставление — шаг 2\n\nДата: ${generatedAt}. Проверены все ${report.total} машины из аудита шага 1. Записей в БД: 0; запросов к источникам: 0; опубликованный интерфейс не изменён.\n\n## Локальные артефакты\n\n- data/catalog-naming/encar-taxonomy-v1.json — локальная таксономия с исходными кодами, связями, строками и предложенными подписями.\n- data/catalog-naming/generation-aliases-v1.json — копия утверждённых исходных соответствий поколений TL Auto. Старые полные подписи не используются для склейки модели и поколения.\n- data/catalog-naming/label-rules-v1.json — явные правила названий, аббревиатур и разбора составных версий.\n- output/catalog-naming/proposals.json — предложение по каждой машине с основаниями и исходными значениями.\n- output/catalog-naming/review.json — случаи, требующие проверки.\n\n${findings}## Числа по источникам\n\n\`\`\`json\n${JSON.stringify(bySource,null,2)}\n\`\`\`\n\nresolved означает предложение подписи на основании кода/точного соответствия/сохранённого поля; это не новый статус мощности или проверка оснащения. visibleGeneration считает подписанные поколения: явный код кузова/номер либо название варианта Encar с годами из таксономии. missing — нет отдельного значения; not_specified — источник явно сообщает об отсутствии отдельного уровня. source_descriptor — используется исходное название варианта Encar без кода кузова или номера поколения.\n\n## Реальные примеры для проверки названий\n\n| Encar ID | Название | Поколение для карточки | Модификация | Комплектация |\n| --- | --- | --- | --- | --- |\n${sampleRows.join("\n")}\n\n## Правила и ограничения\n\n- Коды и названия сверяются внутри полной ветки марки/модели/поколения. Точное имя без кодов сверяется в контексте марки и модели.\n- Дубли с одинаковой подписью разрешаются как алиасы отображения; исходные узлы и связи сохраняются. Разные подписи в одной ветке остаются конфликтом.\n- Двигатель, топливо и привод не выдаются за комплектацию. Порядковые слова 2nd/3rd не считаются комплектацией и не преобразуются автоматически в код кузова.\n- У поколения отдельны полное исходное название ветки и короткая экранная подпись. Рестайлинг не угадывается по году или слову New.\n- Известные составные названия разделяются по явному пакету, например E300 Avantgarde → E300 / Avantgarde и 530i M Sport → 530i / M Sport.\n- Пустые значения не заполняются рекламными словами Standard/Базовая; нет приписывания опций по названию комплектации.\n- Эта версия справочника подготовлена для проверки. Она ещё не подключена к опубликованным карточкам или фильтрам.\n\nШаг 2: остановка для проверки перед образцами оформления.\n`;
  await writeFile(resolve(root,"docs/catalog-naming-step-2-proposals.md"),md);
  console.log(JSON.stringify({total:report.total,dictionaryNodes:report.dictionaryNodes,duplicateNameGroups:report.duplicateNameGroups,labelRepairs:report.labelRepairs,bySource,samples:samples.map(r=>({id:r.sourceListingId,title:r.title,generation:r.generation.label,version:r.compactVersion}))},null,2));
}
main().catch(error=>{console.error(error instanceof Error ? error.message : String(error));process.exitCode=1;});
