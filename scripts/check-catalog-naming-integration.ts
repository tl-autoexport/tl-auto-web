/** Read-only replay against the reviewed full-catalogue proposals. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import taxonomy from '../data/catalog-naming/encar-taxonomy-v1.json';
import aliases from '../data/catalog-naming/generation-aliases-v1.json';
import { createCatalogNamingResolver, type Car, type Node, type GenerationAlias } from '../src/server/catalog/catalog-naming-resolver';
async function main(){
 const audit=JSON.parse(await readFile('output/catalog-naming/audit.json','utf8'));
 const reviewed=JSON.parse(await readFile('output/catalog-naming/proposals.json','utf8'));
 const resolve=createCatalogNamingResolver(taxonomy.nodes as Node[],aliases.aliases as GenerationAlias[]);
 const result=resolve(audit.rows as Car[]).rows;
 assert.equal(result.length,10294);assert.deepEqual(result,reviewed.rows);
 assert.equal(result.filter(r=>!r.versionLine).length,0);
 assert.equal(result.filter(r=>r.trim.status==='needs_review'||r.trim.status==='conflict').length,0);
 console.log('Shared import resolver exactly reproduces all 10,294 reviewed naming records');
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
