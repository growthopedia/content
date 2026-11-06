// Drafts and ideas written outside the app land in the planner:
//   drafts/index.json (packed from drafts/blog/*.json by scripts/pack-drafts.mjs) -> "drafted" posts in the Approve tab
//   drafts/ideas.json (entries without body_html)                                   -> "idea" posts on the calendar
// Each slug is imported once, ever (imported_drafts remembers it), so a post you reject or delete never comes back.
// If a later file changes an entry's planned_date and the post is still an idea or an unapproved draft, the new
// date is applied (so the posting rhythm can be changed from the repo); dates you set in the app after approving stay.
import DRAFTS_ from '../drafts/index.json';
import IDEAS from '../drafts/ideas.json';
import { cleanHtml, slugify } from './rules.js';

const ALL = [...DRAFTS_, ...IDEAS];
const FIELDS = ['title', 'topic', 'reason', 'primary_keyword', 'intent', 'slug', 'seo_title', 'meta_description', 'excerpt',
  'categories', 'tags', 'body_html', 'has_faq', 'planned_date'];

// Small stable hash of a draft's text, to notice when the repo copy was rewritten.
function hash(d) {
  const t = [d.title, d.seo_title, d.meta_description, d.excerpt, d.body_html].join('\u0001');
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export async function importDrafts(env) {
  if (!ALL.length) return 0;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS imported_drafts (slug TEXT PRIMARY KEY, blog_post_id INTEGER, imported_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  for (const col of ['planned_date', 'content_hash']) {
    try { await env.DB.prepare(`ALTER TABLE imported_drafts ADD COLUMN ${col} TEXT`).run(); } catch { /* already there */ }
  }
  const done = new Map((await env.DB.prepare(`SELECT slug, blog_post_id, planned_date, content_hash FROM imported_drafts`).all()).results.map((r) => [r.slug, r]));
  const live = new Set((await env.DB.prepare(`SELECT slug FROM blog_posts WHERE slug IS NOT NULL`).all()).results.map((r) => r.slug));
  let n = 0;
  for (const d of ALL) {
    const slug = slugify(d.slug || d.title);
    const prev = done.get(slug);
    if (prev) {
      // A rewritten draft in the repo replaces the planner copy while it's still waiting for review (status drafted).
      const h = hash(d);
      if (d.body_html && prev.blog_post_id && prev.content_hash !== h) {
        const upd = Object.fromEntries(['title', 'seo_title', 'meta_description', 'excerpt', 'categories', 'tags', 'primary_keyword', 'has_faq']
          .filter((k) => d[k] !== undefined).map((k) => [k, k === 'has_faq' ? (d[k] ? 1 : 0) : d[k]]));
        upd.body_html = cleanHtml(d.body_html);
        const ks = Object.keys(upd);
        await env.DB.prepare(`UPDATE blog_posts SET ${ks.map((k) => `${k}=?`).join(', ')}, updated_at=datetime('now') WHERE id=? AND status='drafted'`).bind(...ks.map((k) => upd[k]), prev.blog_post_id).run();
        await env.DB.prepare(`UPDATE imported_drafts SET content_hash=? WHERE slug=?`).bind(h, slug).run();
      }
      if (d.planned_date && prev.planned_date && d.planned_date !== prev.planned_date && prev.blog_post_id) {
        await env.DB.prepare(`UPDATE blog_posts SET planned_date=?, updated_at=datetime('now') WHERE id=? AND status IN ('idea','topic_approved','drafted')`).bind(d.planned_date, prev.blog_post_id).run();
        await env.DB.prepare(`UPDATE imported_drafts SET planned_date=? WHERE slug=?`).bind(d.planned_date, slug).run();
      } else if (!prev.planned_date && d.planned_date) {
        // Imported before dates were tracked: record the date it was imported with, and apply a changed one.
        if (prev.blog_post_id) await env.DB.prepare(`UPDATE blog_posts SET planned_date=?, updated_at=datetime('now') WHERE id=? AND status IN ('idea','topic_approved','drafted')`).bind(d.planned_date, prev.blog_post_id).run();
        await env.DB.prepare(`UPDATE imported_drafts SET planned_date=? WHERE slug=?`).bind(d.planned_date, slug).run();
      }
      continue;
    }
    if (live.has(slug)) { await env.DB.prepare(`INSERT OR IGNORE INTO imported_drafts (slug, planned_date) VALUES (?, ?)`).bind(slug, d.planned_date || null).run(); continue; }
    const isIdea = !d.body_html;
    const vals = { ...Object.fromEntries(FIELDS.filter((k) => d[k] !== undefined && d[k] !== null && d[k] !== '').map((k) => [k, d[k]])), slug,
      ...(isIdea ? {} : { body_html: cleanHtml(d.body_html) }), has_faq: d.has_faq ? 1 : 0 };
    const cols = Object.keys(vals);
    const r = await env.DB.prepare(isIdea
      ? `INSERT INTO blog_posts (${cols.join(', ')}, status) VALUES (${cols.map(() => '?').join(', ')}, 'idea')`
      : `INSERT INTO blog_posts (${cols.join(', ')}, status, topic_approved_at) VALUES (${cols.map(() => '?').join(', ')}, 'drafted', datetime('now'))`)
      .bind(...cols.map((k) => vals[k])).run();
    await env.DB.prepare(`INSERT INTO imported_drafts (slug, blog_post_id, planned_date, content_hash) VALUES (?, ?, ?, ?)`).bind(slug, r.meta.last_row_id, d.planned_date || null, hash(d)).run();
    n++;
  }
  return n;
}
