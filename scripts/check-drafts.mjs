// Runs the app's own blog checks (src/rules.js) on draft files in drafts/blog/*.json before they're imported.
// Usage: node scripts/check-drafts.mjs [file ...]   (no args = every draft)
import fs from 'node:fs';
import path from 'node:path';
import { checkBlog } from '../src/rules.js';

const dir = new URL('../drafts/blog/', import.meta.url).pathname;
const files = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f));
const settings = { site_url: 'https://www.growthopedia.com', blog_path: '/blog', author_bio: 'set in the app' };
// Checked in the app instead: the featured image is added there, and keyword clashes need the database.
const SKIP = new Set(['featured', 'clash', 'pillar', 'author']);
let bad = 0;
for (const f of files) {
  const p = JSON.parse(fs.readFileSync(f, 'utf8'));
  const fails = checkBlog(p, { settings }).filter((c) => !c.ok && !SKIP.has(c.id));
  const words = (p.body_html || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  console.log(`${fails.length ? 'FAIL' : 'ok  '} ${p.slug} (${words} words)${fails.map((c) => `\n     - ${c.label}: ${c.detail}`).join('')}`);
  if (fails.length) bad++;
}
process.exit(bad ? 1 : 0);
