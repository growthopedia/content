// Packs drafts/blog/*.json into drafts/index.json, which the Worker imports (src/drafts.js). Run after adding drafts.
import fs from 'node:fs';
const dir = new URL('../drafts/blog/', import.meta.url).pathname;
const all = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(dir + f, 'utf8')));
all.sort((a, b) => String(a.planned_date).localeCompare(String(b.planned_date)));
fs.writeFileSync(new URL('../drafts/index.json', import.meta.url), JSON.stringify(all, null, 1) + '\n');
console.log(`Packed ${all.length} drafts`);
