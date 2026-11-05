// Drafts written outside the app (drafts/blog/*.json, packed into drafts/index.json by scripts/pack-drafts.mjs)
// land in the Approve tab as "drafted" blog posts, the same as drafts made in the app. Each slug is imported
// once, ever: the imported_drafts table remembers it, so a draft you reject or delete never comes back.
import DRAFTS from '../drafts/index.json';
import { cleanHtml, slugify } from './rules.js';

const FIELDS = ['title', 'topic', 'reason', 'primary_keyword', 'intent', 'slug', 'seo_title', 'meta_description', 'excerpt',
  'categories', 'tags', 'body_html', 'has_faq', 'planned_date'];

export async function importDrafts(env) {
  if (!DRAFTS.length) return 0;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS imported_drafts (slug TEXT PRIMARY KEY, blog_post_id INTEGER, imported_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  const done = new Set((await env.DB.prepare(`SELECT slug FROM imported_drafts`).all()).results.map((r) => r.slug));
  const live = new Set((await env.DB.prepare(`SELECT slug FROM blog_posts WHERE slug IS NOT NULL`).all()).results.map((r) => r.slug));
  let n = 0;
  for (const d of DRAFTS) {
    const slug = slugify(d.slug || d.title);
    if (done.has(slug)) continue;
    if (live.has(slug)) { await env.DB.prepare(`INSERT OR IGNORE INTO imported_drafts (slug) VALUES (?)`).bind(slug).run(); continue; }
    const vals = { ...Object.fromEntries(FIELDS.filter((k) => d[k] !== undefined && d[k] !== null).map((k) => [k, d[k]])), slug, body_html: cleanHtml(d.body_html), has_faq: d.has_faq ? 1 : 0 };
    const cols = Object.keys(vals);
    const r = await env.DB.prepare(`INSERT INTO blog_posts (${cols.join(', ')}, status, topic_approved_at) VALUES (${cols.map(() => '?').join(', ')}, 'drafted', datetime('now'))`)
      .bind(...cols.map((k) => vals[k])).run();
    await env.DB.prepare(`INSERT INTO imported_drafts (slug, blog_post_id) VALUES (?, ?)`).bind(slug, r.meta.last_row_id).run();
    n++;
  }
  return n;
}
