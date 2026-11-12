// Growthopedia Content: the same app as content.cribpicks.com, with Growthopedia's blog posts.
//   /            publishing calendar (drag a post to a new day, then save)
//   /review/     review queue (approve, request changes, scrap)
//   /post/<id>/  a draft, rendered the way growthopedia.com renders posts, with approve / request changes on top
//   /clusters/   topic clusters, each with a question wheel suggested by Claude from the cluster and its posts
// Auth is checked in index.js before anything here runs (Cloudflare Access + ALLOWED_EMAILS).
import CSS from './web/app.css';
import CAL_JS from './web/calendar.client.js';
import REVIEW_JS from './web/review.client.js';
import CLUSTERS_JS from './web/clusters.client.js';
import KIT_CSS from './web/postkit.css';
import KIT_JS from './web/postkit.client.js';
import { canSendToSite, sendToSite } from './site.js';
import { localDate } from './time.js';
import { listStores, getStore, saveStore, testStore, setBlog, deleteStore, oauthStart, oauthCallback, shopInfo } from './shopify.js';

const SITE = 'https://www.growthopedia.com';
const FONTS = 'https://fonts.googleapis.com/css2?family=Young+Serif&family=Nunito+Sans:opsz,wght@6..12,400;6..12,600;6..12,700;6..12,800&display=swap';
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const tz = (env) => env.TIMEZONE || 'America/New_York';
const today = (env) => localDate(new Date(), tz(env));
const all = async (env, sql, ...p) => (await env.DB.prepare(sql).bind(...p).all()).results;
const first = (env, sql, ...p) => env.DB.prepare(sql).bind(...p).first();
const run = (env, sql, ...p) => env.DB.prepare(sql).bind(...p).run();
const cats = (c) => String(c || '').split(',').map((x) => x.trim()).filter(Boolean);

export const ASSETS = {
  '/assets/app.css': [CSS, 'text/css'],
  '/assets/calendar.js': [CAL_JS, 'text/javascript'],
  '/assets/review.js': [REVIEW_JS, 'text/javascript'],
  '/assets/clusters.js': [CLUSTERS_JS, 'text/javascript'],
  '/assets/postkit.css': [KIT_CSS, 'text/css'],
  '/assets/postkit.js': [KIT_JS, 'text/javascript'],
};

// Planner statuses -> the CribPicks labels.
const LABEL = { published: 'Published', scheduled: 'Scheduled', review: 'Needs review', changes: 'Changes requested', planned: 'Planned' };
export function stateOf(p, t) {
  if (p.status === 'published') return 'published';
  if (p.status === 'draft_approved') return p.planned_date && p.planned_date <= t ? 'published' : 'scheduled';
  if (p.status === 'drafted') return 'review';
  if (p.status === 'changes_requested') return 'changes';
  if (p.status === 'idea' || p.status === 'topic_approved' || p.status === 'on_hold') return 'planned';
  return null; // rejected
}

async function waitingCount(env) {
  return (await first(env, `SELECT COUNT(*) n FROM blog_posts WHERE status='drafted'`)).n;
}
function nav(active, n) {
  const l = [['/', 'Calendar', 'calendar'], ['/review/', `Review queue${n ? ` (${n})` : ''}`, 'review'], ['/clusters/', 'Clusters', 'clusters'], ['/stores/', 'Shopify stores', 'stores']];
  return `<nav class="ct-tabs" aria-label="Content tools">${l.map(([h, t, k]) => `<a href="${h}"${k === active ? ' aria-current="page"' : ''}>${t}</a>`).join('')}<a href="${SITE}/blog" target="_blank" rel="noopener">Open the site</a></nav>`;
}
function shell(email, { title, body, status = 200 }) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)} | Growthopedia Content</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="${FONTS}" rel="stylesheet">
<link rel="stylesheet" href="/assets/app.css"></head>
<body><header class="ct-top"><a class="ct-brand" href="/">Growthopedia <span>Content</span></a>${email ? `<span class="ct-who">${esc(email)}</span>` : ''}</header>
<main class="wrap ct-main">${body}</main></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' } });
}
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

// ---------- calendar ----------
async function calendarItems(env) {
  const t = today(env);
  const rows = await all(env, `SELECT b.id, b.title, b.planned_date, b.status, b.categories, b.published_url, b.site_sent_at, s.name AS store FROM blog_posts b LEFT JOIN stores s ON s.id=b.store_id WHERE b.planned_date IS NOT NULL AND b.status != 'rejected'`);
  return rows.map((p) => {
    const st = stateOf(p, t);
    if (!st) return null;
    const live = st === 'published' ? (p.published_url || null) : null;
    return { k: String(p.id), slug: String(p.id), title: p.title, date: p.planned_date, status: st, menu: p.store || 'Growthopedia', sub: cats(p.categories)[0] || '', preview: p.status !== 'idea' && p.status !== 'topic_approved' ? `/post/${p.id}/` : null, live };
  }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}
async function calendarPage(env, email) {
  const items = await calendarItems(env);
  const data = { today: today(env), canSave: true, labels: LABEL, items };
  return shell(email, { title: 'Publishing calendar', body: `${nav('calendar', await waitingCount(env))}
<div class="ct-head"><h1>Publishing calendar</h1>
<p class="lede">Drag a post to a new day, then save. Approved posts publish on their date with the site’s daily update. Published posts stay where they are.</p></div>
<div class="ct-bar">
  <div class="ct-month"><button type="button" class="btn btn-sm btn-ghost" data-nav="-1" aria-label="Previous month">‹</button><h2 id="ct-title" aria-live="polite"></h2><button type="button" class="btn btn-sm btn-ghost" data-nav="1" aria-label="Next month">›</button><button type="button" class="btn btn-sm btn-ghost" data-nav="0">Today</button></div>
  <fieldset class="ct-show"><legend>Show</legend>
    <label><input type="checkbox" data-show="approved" checked> <span class="ct-dot st-scheduled"></span>Approved</label>
    <label><input type="checkbox" data-show="review"> <span class="ct-dot st-review"></span>In review</label>
    <label><input type="checkbox" data-show="planned"> <span class="ct-dot st-planned"></span>Planned</label>
  </fieldset>
</div>
<div class="ct-msg" role="status" hidden></div>
<div class="ct-cal" id="ct-cal"></div>
<div class="ct-save" hidden><b data-n></b><button type="button" class="btn btn-sm" data-save>Save changes</button><button type="button" class="btn btn-sm btn-ghost" data-undo>Undo</button></div>
<dialog class="ct-pop" id="ct-pop"><form method="dialog" class="ct-pop-in"><button class="ct-x" value="close" aria-label="Close">×</button><div data-pop></div></form></dialog>
<script type="application/json" id="ct-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script type="module" src="/assets/calendar.js"></script>` });
}
async function move(env, b) {
  const list = Array.isArray(b.moves) ? b.moves : [];
  if (!list.length) throw fail('Nothing to save.');
  if (list.length > 60) throw fail('Too many changes at once. Save 60 or fewer.');
  const t = today(env);
  let site = 0, n = 0;
  for (const m of list) {
    const id = Number(m.k), to = String(m.to || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || Number.isNaN(Date.parse(to + 'T12:00:00Z'))) throw fail('That date doesn’t look right.');
    const p = await first(env, `SELECT * FROM blog_posts WHERE id=?`, id);
    if (!p) throw fail('One of these posts changed since you opened the page. Reload and try again.', 409);
    const st = stateOf(p, t);
    if (!st || st === 'published') throw fail(`"${p.title}" is already published, so its date stays.`);
    if (to < t) throw fail(`"${p.title}" can’t move to a day that has passed.`);
    if (p.planned_date === to) continue;
    if (p.site_sent_at && p.status === 'draft_approved') {
      if (!canSendToSite(env)) throw fail(`"${p.title}" is already on the site, and saving to the site is off: add the GITHUB_TOKEN secret to the Worker.`, 503);
      try { await sendToSite(env, { ...p, planned_date: to }, 'published', t); } catch (e) { throw fail(`Couldn’t update "${p.title}" on the site: ${e.message}`, 502); }
      site++;
    }
    await run(env, `UPDATE blog_posts SET planned_date=?, updated_at=datetime('now') WHERE id=?`, to, id);
    n++;
  }
  return { ok: true, count: n, site };
}

// ---------- review queue ----------
async function reviewPage(env, email, url) {
  const t = today(env);
  const stores = await listStores(env);
  const site = url.searchParams.get('site') || '';
  const rows = (await all(env, `SELECT id, title, planned_date, status, categories, change_note, published_url, store_id FROM blog_posts WHERE status != 'rejected' ORDER BY planned_date IS NULL, planned_date, id`))
    .filter((p) => !site || (site === 'g' ? !p.store_id : String(p.store_id) === site))
    .map((p) => ({ ...p, st: stateOf(p, t) })).filter((p) => p.st);
  const filter = url.searchParams.get('show') || 'upcoming';
  const shown = rows.filter((p) => filter === 'all' ? true : filter === 'review' ? p.st === 'review' : filter === 'published' ? p.st === 'published' : (p.planned_date && p.planned_date >= t) || p.st === 'review' || p.st === 'changes');
  const count = (s) => rows.filter((p) => p.st === s).length;
  const fmt = (d) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(d.slice(0, 4) !== t.slice(0, 4) ? { year: 'numeric' } : {}), timeZone: 'UTC' }) : 'No date');
  const CHIP = { review: 'Needs review', changes: 'Changes requested', scheduled: 'Scheduled', published: 'Published', planned: 'Planned' };
  const hasBody = (p) => p.status !== 'idea' && p.status !== 'topic_approved';
  const acts = (p) => {
    const live = p.st === 'published' && p.published_url ? `<a class="gq-link" href="${esc(p.published_url)}" target="_blank" rel="noopener">View</a>` : '';
    if (p.st !== 'review') return live;
    return `<button type="button" class="btn btn-sm" data-gq="approve">Approve</button><button type="button" class="gq-link" data-gq-open="changes">Request changes</button><button type="button" class="gq-link gq-x" data-gq-open="scrap">Scrap</button>
<div class="gq-form" hidden data-form="changes"><label>What should change?<textarea rows="3" maxlength="2000" data-note></textarea></label><button type="button" class="btn btn-sm" data-gq="changes">Send to the writer</button></div>
<div class="gq-form" hidden data-form="scrap"><p class="small">Scrap this post? It won’t publish and leaves this list (you can still find it under Everything).</p><label>Why (optional)<input data-note maxlength="200"></label><button type="button" class="btn btn-sm gq-scrap" data-gq="scrap">Yes, scrap it</button></div>`;
  };
  const row = (p) => `<tr class="gq-${p.st}" data-id="${p.id}">
<td class="gq-sel">${p.st === 'review' ? `<input type="checkbox" data-pick aria-label="Select ${esc(p.title)}">` : ''}</td>
<td class="gq-date">${fmt(p.planned_date)}</td>
<td class="gq-post">${hasBody(p) ? `<a href="/post/${p.id}/">${esc(p.title)}</a>` : `<b>${esc(p.title)}</b>`}<small>${esc(cats(p.categories).join(' · '))}</small>${p.change_note && p.st === 'changes' ? `<small class="gq-note">Your note: ${esc(p.change_note)}</small>` : ''}</td>
<td>${stores.length ? (p.st === 'published' || p.st === 'scheduled' ? `<span class="small">${esc(stores.find((x) => x.id === p.store_id)?.name || 'Growthopedia')}</span>` : `<select class="gq-store" data-store-for="${p.id}" aria-label="Site for ${esc(p.title)}"><option value="">Growthopedia</option>${stores.map((x) => `<option value="${x.id}"${x.id === p.store_id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`) : ''}</td>
<td><span class="gq-chip">${CHIP[p.st]}</span></td>
<td><div class="gq-act">${acts(p)}</div></td></tr>`;
  const opt = (k, l) => `<a href="?show=${k}${site ? `&site=${site}` : ''}"${filter === k ? ' aria-current="page"' : ''}>${l}</a>`;
  const siteNav = stores.length ? `<nav class="gq-filter">${[['', 'All sites'], ['g', 'Growthopedia'], ...stores.map((x) => [String(x.id), x.name])].map(([k, l]) => `<a href="?show=${filter}${k ? `&site=${k}` : ''}"${site === k ? ' aria-current="page"' : ''}>${esc(l)}</a>`).join('')}</nav>` : '';
  const nWait = count('review');
  return shell(email, { title: 'Review queue', body: `${nav('review', nWait)}
<div class="ct-head"><h1>Blog posts to review</h1>
<p class="lede">Approve, request changes or scrap. Approved posts publish on their date: Growthopedia posts on growthopedia.com, client posts on that client’s Shopify blog.</p></div>
${canSendToSite(env) ? '' : '<p class="gq-msg err">Sending to the site is off: add the GITHUB_TOKEN secret to the content Worker. Approving still works here, but posts won’t reach growthopedia.com until it’s added.</p>'}
<div class="gq-top"><div><b>${nWait}</b><span>Waiting on you</span></div><div><b>${count('scheduled')}</b><span>Approved, scheduled</span></div><div><b>${count('published')}</b><span>Published</span></div><div><b>${count('planned')}</b><span>Planned</span></div></div>
${siteNav}<nav class="gq-filter">${opt('upcoming', 'Upcoming')}${opt('review', 'Needs review')}${opt('published', 'Published')}${opt('all', 'Everything')}</nav>
<div class="gq-msg" role="status" hidden></div>
<div class="gq"><table><thead><tr><th>${nWait ? '<input type="checkbox" data-pick-all aria-label="Select all waiting posts">' : ''}</th><th>Date</th><th>Post</th><th>${stores.length ? 'Site' : ''}</th><th>Status</th><th></th></tr></thead><tbody>${shown.map(row).join('') || '<tr><td colspan="6">Nothing here.</td></tr>'}</tbody></table></div>
<div class="gq-bulk" hidden><b data-pick-n>0 selected</b><button type="button" class="btn btn-sm" data-gq-bulk="approve">Approve selected</button><button type="button" class="btn btn-sm gq-scrap" data-gq-bulk="scrap">Scrap selected</button></div>
<script type="module" src="/assets/review.js"></script>` });
}
// Decisions reuse the planner's own blog actions (sending to / taking off the site lives there).
async function decide(env, b, blogAction) {
  const ids = [...new Set((Array.isArray(b.ids) ? b.ids : [b.id]).map(Number).filter(Boolean))];
  if (!ids.length) throw fail('No matching posts.');
  if (ids.length > 60) throw fail('Too many at once.');
  const decision = String(b.decision || '');
  const note = String(b.note || '').trim();
  if (decision === 'changes' && !note) throw fail('Write what to change first.');
  const done = [], errors = [];
  for (const id of ids) {
    try {
      if (decision === 'approve') await blogAction(env, id, { action: 'approve_draft' });
      else if (decision === 'changes') await blogAction(env, id, { action: 'request_changes', note });
      else if (decision === 'scrap') await blogAction(env, id, { action: 'reject', reason: note || 'Scrapped in the review queue' });
      else throw fail('Unknown decision.');
      done.push(id);
    } catch (e) {
      const p = await first(env, `SELECT title FROM blog_posts WHERE id=?`, id);
      errors.push(`${p ? `"${p.title}": ` : ''}${e.message}`);
    }
  }
  if (!done.length) throw fail(errors.join(' '));
  return { ok: true, count: done.length, ids: done, errors };
}

// ---------- preview ----------
async function preview(env, id) {
  const p = await first(env, `SELECT * FROM blog_posts WHERE id=?`, id);
  if (!p || p.status === 'rejected') throw fail('Page not found', 404);
  const t = today(env), st = stateOf(p, t);
  const date = p.planned_date ? new Date(p.planned_date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'No date yet';
  const B = 'border:0;border-radius:99px;padding:7px 16px;font:700 14px/1.2 var(--body);cursor:pointer;text-decoration:none';
  const open = st === 'review';
  const bar = `<div class="pv-bar" style="position:sticky;top:0;z-index:90;background:var(--forest);color:#fffdf8;padding:10px 16px;display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;justify-content:center;font:700 14px/1.3 var(--body)">
<a href="/review/" style="color:#fffdf8">← Review queue</a><span style="opacity:.85">${esc(LABEL[st] || p.status)} · ${esc(date)}</span><span data-pv-status aria-live="polite"></span>
${open ? `<button type="button" data-pv="approve" style="${B};background:var(--mustard);color:var(--ink)">Approve</button><button type="button" data-pv-open style="${B};background:transparent;color:#fffdf8;box-shadow:inset 0 0 0 1px rgba(255,253,248,.5)">Request changes</button>
<form data-pv-form hidden style="flex-basis:100%;display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><textarea rows="2" maxlength="2000" placeholder="What should change?" style="flex:1 1 320px;max-width:560px;font:400 14px/1.4 var(--body);border:0;border-radius:12px;padding:8px 10px"></textarea><button type="submit" style="${B};background:var(--mustard);color:var(--ink);align-self:center">Send</button></form>` : ''}</div>`;
  const script = open ? `<script>(()=>{const bar=document.querySelector('.pv-bar'),st=bar.querySelector('[data-pv-status]'),f=bar.querySelector('[data-pv-form]');
const send=async(decision,note,btn)=>{btn.disabled=true;const t=btn.textContent;btn.textContent='Saving…';try{const r=await fetch('/api/review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ids:[${Number(p.id)}],decision,note})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Something went wrong');st.textContent=decision==='approve'?'Approved. It publishes on its date.':'Sent for changes.';bar.querySelectorAll('[data-pv],[data-pv-open],[data-pv-form]').forEach(x=>x.remove())}catch(e){st.textContent=e.message;btn.disabled=false;btn.textContent=t}};
bar.querySelector('[data-pv]').addEventListener('click',e=>send('approve','',e.currentTarget));
bar.querySelector('[data-pv-open]').addEventListener('click',()=>{f.hidden=!f.hidden;if(!f.hidden)f.querySelector('textarea').focus()});
f.addEventListener('submit',e=>{e.preventDefault();const n=f.querySelector('textarea').value.trim();if(!n){st.textContent='Write what to change first.';return}send('changes',n,f.querySelector('button'))});})();</script>` : '';
  const c = cats(p.categories);
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>${esc(p.seo_title || p.title)} | Preview</title><link href="${FONTS}" rel="stylesheet"><link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/postkit.css">
<style>.pv{max-width:820px;margin:0 auto;padding:28px 24px 80px}.pv-cat{display:inline-block;background:var(--butter);border-radius:99px;padding:4px 12px;font-size:12px;font-weight:800;letter-spacing:.04em}
.pv h1{font-size:clamp(34px,5vw,54px);margin:14px 0 10px;line-height:1.05}.pv-meta{color:var(--ink-soft);font-size:14px;margin:0 0 18px}
.pv-seo{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px 16px;margin:0 0 26px;font-size:14px;display:grid;gap:4px}.pv-seo b{font-size:12px;color:var(--ink-soft)}
.prose2{max-width:72ch;font-size:18px;line-height:1.7}.prose2 h2{font-family:var(--head);font-weight:400;font-size:clamp(28px,3vw,38px);line-height:1.1;margin:1.6em 0 .5em}.prose2 h3{font-family:var(--head);font-weight:400;font-size:24px;margin:1.3em 0 .4em}
.prose2 a{text-decoration:underline;text-decoration-color:var(--mustard);text-underline-offset:3px}.pv-note{background:#f8ddd5;border-radius:12px;padding:10px 14px;margin:0 0 18px}</style></head>
<body>${bar}<article class="pv">${c[0] ? `<span class="pv-cat">${esc(c[0])}</span>` : ''}<h1>${esc(p.title)}</h1>
<p class="pv-meta">By Jen Cannizzo · ${esc(date)}</p>
${p.change_note && st === 'changes' ? `<p class="pv-note"><b>Your note:</b> ${esc(p.change_note)}</p>` : ''}
<div class="pv-seo"><b>Search title</b><span>${esc(p.seo_title || p.title)}</span><b>Meta description</b><span>${esc(p.meta_description || '—')}</span><b>Excerpt</b><span>${esc(p.excerpt || '—')}</span></div>
<div class="prose2">${p.body_html || '<p class="muted">No draft yet.</p>'}</div></article>${script}<script src="/assets/postkit.js" defer></script></body></html>`,
  { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' } });
}

// ---------- clusters and the question wheel ----------
export const QW_SCHEMA = `CREATE TABLE IF NOT EXISTS cluster_questions (cluster_id INTEGER PRIMARY KEY, seed TEXT, data TEXT NOT NULL, model TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`;
async function clustersPage(env, email) {
  const t = today(env);
  const cl = await all(env, `SELECT c.*, (SELECT COUNT(*) FROM blog_posts b WHERE b.cluster_id=c.id AND b.status!='rejected') posts,
    (SELECT COUNT(*) FROM blog_posts b WHERE b.cluster_id=c.id AND (b.status='published' OR (b.status='draft_approved' AND b.planned_date<=?))) live,
    (SELECT created_at FROM cluster_questions q WHERE q.cluster_id=c.id) wheel FROM clusters c ORDER BY c.name`, t);
  const card = (c) => `<article class="cl-card"><h3><a href="/clusters/${c.id}/">${esc(c.name)}</a></h3>${c.keywords ? `<p>${esc(c.keywords.split(',').slice(0, 6).map((s) => s.trim()).join(', '))}</p>` : ''}
<div class="cl-stats"><i>${c.posts} post${c.posts === 1 ? '' : 's'}</i><i>${c.live} live</i>${c.wheel ? '<i>Question wheel ready</i>' : ''}</div></article>`;
  return shell(email, { title: 'Clusters', body: `${nav('clusters', await waitingCount(env))}
<div class="ct-head"><h1>Topic clusters</h1><p class="lede">Each cluster is a topic you want to own. Open one to see the questions people may ask around it, suggested by Claude from the cluster and the posts in it, and turn any question into a blog idea.</p></div>
${env.ANTHROPIC_API_KEY ? '' : '<p class="qw-note">To generate question wheels, add the ANTHROPIC_API_KEY secret to the content Worker. You can still add and edit clusters.</p>'}
<details class="cl-new"${cl.length ? '' : ' open'}><summary>+ New cluster</summary>${clusterForm({}, await listStores(env))}</details>
<div class="cl-grid">${cl.map(card).join('') || '<p class="muted">No clusters yet.</p>'}</div>
<script type="module" src="/assets/clusters.js"></script>` });
}
const clusterForm = (c = {}, stores = []) => `<form class="cl-form" data-cluster-form="${c.id || ''}"><label>Name<input name="name" required maxlength="120" value="${esc(c.name || '')}" placeholder="Local SEO"></label>
${stores.length ? `<label>Site<select name="store_id"><option value="">Growthopedia</option>${stores.map((x) => `<option value="${x.id}"${x.id === c.store_id ? ' selected' : ''}>${esc(x.name)} (Shopify)</option>`).join('')}</select></label>` : ''}
<label>Keywords (comma-separated)<textarea name="keywords" rows="2" maxlength="2000" placeholder="local seo, google business profile, local citations">${esc(c.keywords || '')}</textarea></label>
<label>Pillar page on growthopedia.com (optional)<input name="pillar_url" maxlength="500" value="${esc(c.pillar_url || '')}" placeholder="https://www.growthopedia.com/local-seo"></label>
<label>Notes (optional)<textarea name="notes" rows="2" maxlength="2000">${esc(c.notes || '')}</textarea></label>
<div class="row"><button class="btn btn-sm" type="submit">${c.id ? 'Save cluster' : 'Add cluster'}</button>${c.id ? '<button class="gq-link gq-x" type="button" data-cluster-delete>Delete cluster</button>' : ''}</div></form>`;

async function clusterPage(env, email, id) {
  const c = await first(env, `SELECT * FROM clusters WHERE id=?`, id);
  if (!c) throw fail('Page not found', 404);
  const posts = await all(env, `SELECT id, title, status, planned_date FROM blog_posts WHERE cluster_id=? AND status!='rejected' ORDER BY planned_date`, id);
  const q = await first(env, `SELECT * FROM cluster_questions WHERE cluster_id=?`, id);
  const existing = (await all(env, `SELECT lower(title) t FROM blog_posts WHERE status!='rejected'`)).map((r) => r.t);
  const data = { id, seed: q?.seed || c.name, wheel: q ? JSON.parse(q.data) : null, made: q?.created_at || null, hasKey: Boolean(env.ANTHROPIC_API_KEY), existing };
  return shell(email, { title: c.name, body: `${nav('clusters', await waitingCount(env))}
<p class="small"><a href="/clusters/">← All clusters</a></p>
<div class="ct-head"><h1>${esc(c.name)}</h1><p class="lede">Questions people may ask about this topic, grouped the way searchers phrase them. Suggested by Claude from the cluster’s keywords and its ${posts.length} post${posts.length === 1 ? '' : 's'}. These are ideas, not search volume data: check demand before you write.</p></div>
<div class="qw-bar"><div class="qw-seg" role="group" aria-label="View"><button type="button" data-view="wheel" aria-pressed="true">Wheel</button><button type="button" data-view="list" aria-pressed="false">List</button></div>
<div class="row" style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-sm btn-ghost" data-csv>Download CSV</button><button type="button" class="btn btn-sm" data-generate>${q ? 'Regenerate' : 'Generate questions'}</button></div></div>
<div class="qw-tabs" role="group" aria-label="Group"></div>
<div class="gq-msg" role="status" hidden></div>
<div id="qw"></div>
<details class="cl-new" style="margin-top:24px"><summary>Edit cluster</summary>${clusterForm(c, await listStores(env))}</details>
${posts.length ? `<h2 style="margin-top:28px">Posts in this cluster</h2><ul>${posts.map((p) => `<li>${p.status === 'idea' || p.status === 'topic_approved' ? esc(p.title) : `<a href="/post/${p.id}/">${esc(p.title)}</a>`} <span class="small muted">${esc(LABEL[stateOf(p, today(env))] || '')}${p.planned_date ? ` · ${esc(p.planned_date)}` : ''}</span></li>`).join('')}</ul>` : ''}
<script type="application/json" id="qw-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script type="module" src="/assets/clusters.js"></script>` });
}

const GROUPS = {
  questions: ['who', 'what', 'when', 'where', 'why', 'how', 'which', 'can', 'will', 'are'],
  prepositions: ['for', 'with', 'without', 'to', 'near', 'versus'],
  comparisons: ['vs', 'or', 'and', 'like'],
};
async function generate(env, id) {
  if (!env.ANTHROPIC_API_KEY) throw fail('Add the ANTHROPIC_API_KEY secret to the content Worker to generate questions.', 503);
  const c = await first(env, `SELECT * FROM clusters WHERE id=?`, id);
  if (!c) throw fail('Cluster not found', 404);
  const posts = await all(env, `SELECT title, primary_keyword FROM blog_posts WHERE cluster_id=? AND status!='rejected' LIMIT 60`, id);
  const prompt = `You help an SEO consultant (Growthopedia, a solo SEO and digital marketing consultant for small businesses and agencies) plan blog content.
Topic cluster: "${c.name}"
Cluster keywords: ${c.keywords || '(none)'}
Notes: ${c.notes || '(none)'}
Existing posts in this cluster: ${posts.map((p) => `${p.title}${p.primary_keyword ? ` [${p.primary_keyword}]` : ''}`).join('; ') || '(none)'}

Pick one short seed phrase (2 to 4 words) that best names this cluster as people search it. Then list realistic searches people type about it, the way an answer-the-public style tool groups them.
Return ONLY JSON, no prose, in exactly this shape:
{"seed":"...","questions":{"who":[],"what":[],"when":[],"where":[],"why":[],"how":[],"which":[],"can":[],"will":[],"are":[]},"prepositions":{"for":[],"with":[],"without":[],"to":[],"near":[],"versus":[]},"comparisons":{"vs":[],"or":[],"and":[],"like":[]}}
Rules: 3 to 6 items per question word and 2 to 4 per preposition and comparison. Every item is a full lowercase search phrase that contains the seed or a close variant. Plain wording real people use. No brand names of competitors, no made-up statistics, no years. Skip anything an existing post already answers.`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.CLAUDE_MODEL || 'claude-sonnet-5-5', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw fail(`Claude API error: ${d.error?.message || r.status}`, 502);
  const text = (d.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('');
  let out;
  try { out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { throw fail('Claude’s answer wasn’t valid JSON. Try again.', 502); }
  const clean = (L) => [...new Set((Array.isArray(L) ? L : []).map((s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ')).filter((s) => s.length > 2 && s.length < 140))].slice(0, 8);
  const wheel = { seed: String(out.seed || c.name).slice(0, 60).toLowerCase() };
  for (const [g, keys] of Object.entries(GROUPS)) wheel[g] = Object.fromEntries(keys.map((k) => [k, clean(out[g]?.[k])]));
  const total = Object.keys(GROUPS).reduce((a, g) => a + Object.values(wheel[g]).reduce((x, L) => x + L.length, 0), 0);
  if (!total) throw fail('Claude didn’t return any questions. Try again.', 502);
  await run(env, `INSERT INTO cluster_questions (cluster_id, seed, data, model) VALUES (?, ?, ?, ?) ON CONFLICT(cluster_id) DO UPDATE SET seed=excluded.seed, data=excluded.data, model=excluded.model, created_at=datetime('now')`,
    id, wheel.seed, JSON.stringify(wheel), d.model || null);
  return { ok: true, wheel, total };
}

// ---------- Shopify stores ----------
async function storesPage(env, email, url) {
  const stores = await listStores(env);
  const ok = url.searchParams.get('connected');
  const keyMissing = !env.STORE_KEY;
  const suggested = keyMissing ? [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, '0')).join('') : '';
  const card = (x) => `<div class="st-card" data-store="${x.id}"><div class="st-h"><h2>${esc(x.name)}</h2><span class="gq-chip">${x.blog_id ? 'Connected' : 'Not connected'}</span></div>
<p class="small">${esc(x.shop)}${x.domain ? ` · <a href="${esc(x.domain)}" target="_blank" rel="noopener">${esc(x.domain.replace(/^https?:\/\//, ''))}</a>` : ''}${x.blog_title ? ` · posts to the <b>${esc(x.blog_title)}</b> blog` : ''}${x.author ? ` · author ${esc(x.author)}` : ''}</p>
<div class="st-acts"><button type="button" class="btn btn-sm btn-ghost" data-st-test>Check connection</button>${x.client_id ? `<a class="btn btn-sm btn-ghost" href="/shopify/connect/${x.id}">Connect with Shopify</a>` : ''}<button type="button" class="gq-link" data-st-edit>Edit</button><button type="button" class="gq-link gq-x" data-st-del>Remove</button></div>
<div class="st-blogs" hidden><label>Blog to post to<select data-st-blog></select></label></div><p class="small" data-st-msg role="status"></p>${form(x)}</div>`;
  const form = (x) => `<form class="st-form" data-st-form="${x ? x.id : ''}"${x ? ' hidden' : ''}>
<div class="st-grid"><label>Client name<input name="name" required maxlength="80" value="${esc(x?.name || '')}" placeholder="Acme Bakery"></label>
<label>Store address<input name="shop" required value="${esc(x?.shop || '')}" placeholder="acme-bakery.myshopify.com"></label>
<label>Author name on posts<input name="author" maxlength="80" value="${esc(x?.author || '')}" placeholder="Acme Bakery"></label></div>
<div class="st-grid"><label>Client ID<input name="client_id" value="${esc(x?.client_id || '')}" autocomplete="off"></label><label>Client secret<input name="client_secret" type="password" autocomplete="off" placeholder="${x ? 'Saved; type to replace' : ''}"></label>
<label>Or an Admin API access token<input name="access_token" type="password" autocomplete="off" placeholder="shpat_… (older custom apps)"></label></div>
<button class="btn btn-sm" type="submit">${x ? 'Save' : 'Add store'}</button></form>`;
  return shell(email, { title: 'Shopify stores', body: `${nav('stores', await waitingCount(env))}
<div class="ct-head"><h1>Shopify stores</h1><p class="lede">Clients whose blog posts publish straight to their Shopify store. Set a post’s site in the Review queue, or give a cluster a store so its ideas belong to that client.</p></div>
${keyMissing ? `<p class="gq-msg err" style="display:block">First, add a secret named <b>STORE_KEY</b> to the content Worker (Cloudflare → Workers → content → Settings → Variables and Secrets) so store logins are saved encrypted. You can use this value: <code>${suggested}</code></p>` : ''}
${ok ? '<p class="gq-msg" style="display:block">Connected. Pick the blog below if the store has more than one.</p>' : ''}
${stores.map(card).join('')}
<div class="st-card"><h2>Add a store</h2>${form(null)}
<details class="st-how"><summary>How to get the Client ID and secret</summary><ol>
<li>In the <a href="https://dev.shopify.com/dashboard" target="_blank" rel="noopener">Shopify Dev Dashboard</a>, create an app (e.g. “Growthopedia Content”).</li>
<li>In its version settings, add the scopes <code>read_content</code>, <code>write_content</code> and <code>write_files</code>, and the redirect URL <code>${esc(env.APP_URL || 'https://content.growthopedia.com')}/shopify/callback</code>. Release the version.</li>
<li>Copy the Client ID and Client secret from the app’s Settings into the form above.</li>
<li>Store in your own Shopify organization: install the app on it, then Add store. Client’s store: Add store, then press <b>Connect with Shopify</b> and have the owner (or you, as their collaborator) approve it once.</li></ol>
<p class="small">Client stores outside your organization may need the app set to custom distribution for that store in the Dev Dashboard first.</p></details></div>
<script>${STORES_JS}</script>` });
}
const STORES_JS = `(()=>{const api=async(u,m,b)=>{const r=await fetch(u,{method:m,headers:{'content-type':'application/json'},body:b?JSON.stringify(b):undefined});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Something went wrong');return d};
const show=(card,t)=>{const m=card.querySelector('[data-st-msg]');if(m)m.textContent=t};
const blogs=(card,d)=>{const box=card.querySelector('.st-blogs');if(!box||!d.blogs)return;const sel=box.querySelector('select');sel.innerHTML=d.blogs.map(b=>'<option value="'+b.id+'">'+b.title.replace(/</g,'&lt;')+'</option>').join('');box.hidden=d.blogs.length<2};
document.addEventListener('submit',async e=>{const f=e.target.closest('[data-st-form]');if(!f)return;e.preventDefault();const id=f.dataset.stForm;const b=Object.fromEntries(new FormData(f));const btn=f.querySelector('button');btn.disabled=true;
try{const d=await api(id?'/api/stores/'+id:'/api/stores','POST',b);if(d.connected){location.reload()}else{alert(d.needsOauth?'Saved. This is a client store: press Connect with Shopify to approve it.':'Saved, but the connection failed: '+d.error);location.reload()}}catch(x){alert(x.message);btn.disabled=false}});
document.addEventListener('click',async e=>{const card=e.target.closest('[data-store]');if(!card)return;const id=card.dataset.store;
if(e.target.closest('[data-st-edit]')){const f=card.querySelector('form');f.hidden=!f.hidden;return}
if(e.target.closest('[data-st-test]')){show(card,'Checking…');try{const d=await api('/api/stores/'+id+'/test','POST',{});show(card,d.connected?'Connected to '+d.shopName+'.':d.error);blogs(card,d)}catch(x){show(card,x.message)}return}
const del=e.target.closest('[data-st-del]');if(del){if(del.dataset.sure!=='1'){del.dataset.sure='1';del.textContent='Yes, remove it';return}try{await api('/api/stores/'+id,'DELETE');card.remove()}catch(x){show(card,x.message)}}});
document.addEventListener('change',async e=>{const s=e.target.closest('[data-st-blog]');if(!s)return;const card=s.closest('[data-store]');try{await api('/api/stores/'+card.dataset.store+'/blog','POST',{blog_id:s.value});show(card,'Blog saved.')}catch(x){show(card,x.message)}});})();`;

// ---------- router ----------
// Returns a Response for the app's pages and APIs, or null to let index.js handle the path.
export async function handleApp(request, env, email, { blogAction, saveCluster, deleteCluster, createBlog }) {
  const url = new URL(request.url), p = url.pathname, m = request.method;
  const a = ASSETS[p];
  if (a && m === 'GET') return new Response(a[0], { headers: { 'content-type': `${a[1]}; charset=utf-8`, 'cache-control': 'private, max-age=300' } });
  const body = async () => { if (!(request.headers.get('content-type') || '').includes('application/json')) throw fail('Send JSON', 415); return request.json(); };
  try {
    let r;
    if (m === 'GET' && (p === '/' || p === '/index.html')) return await calendarPage(env, email);
    if (m === 'GET' && p === '/review/') return await reviewPage(env, email, url);
    if (m === 'GET' && p === '/clusters/') return await clustersPage(env, email);
    if (m === 'GET' && p === '/stores/') return await storesPage(env, email, url);
    if (m === 'GET' && (r = p.match(/^\/shopify\/connect\/(\d+)$/))) return Response.redirect(await oauthStart(env, Number(r[1]), env.APP_URL || url.origin), 302);
    if (m === 'GET' && p === '/shopify/callback') { await oauthCallback(env, url); return Response.redirect(new URL('/stores/?connected=1', url), 302); }
    if (m === 'POST' && p === '/api/stores') return json(await saveStore(env, null, await body()));
    if ((r = p.match(/^\/api\/stores\/(\d+)$/))) {
      if (m === 'POST') return json(await saveStore(env, Number(r[1]), await body()));
      if (m === 'DELETE') return json(await deleteStore(env, Number(r[1])));
    }
    if (m === 'POST' && (r = p.match(/^\/api\/stores\/(\d+)\/test$/))) return json(await testStore(env, Number(r[1])));
    if (m === 'POST' && (r = p.match(/^\/api\/stores\/(\d+)\/blog$/))) return json(await setBlog(env, Number(r[1]), String((await body()).blog_id || '')));
    if (m === 'POST' && (r = p.match(/^\/api\/blog\/(\d+)\/store$/))) {
      const b = await body(), sid = Number(b.store_id) || null;
      const post = await first(env, `SELECT status, shopify_article_id, site_sent_at FROM blog_posts WHERE id=?`, Number(r[1]));
      if (!post) throw fail('Post not found', 404);
      if (post.shopify_article_id || post.site_sent_at) throw fail('This post was already sent to a site. Request changes first, then move it.');
      if (sid && !(await getStore(env, sid))) throw fail('Store not found', 404);
      await run(env, `UPDATE blog_posts SET store_id=?, updated_at=datetime('now') WHERE id=?`, sid, Number(r[1]));
      return json({ ok: true });
    }
    if (m === 'GET' && (r = p.match(/^\/clusters\/(\d+)\/$/))) return await clusterPage(env, email, Number(r[1]));
    if (m === 'GET' && (r = p.match(/^\/post\/(\d+)\/$/))) return await preview(env, Number(r[1]));
    if (m === 'POST' && p === '/api/move') return json(await move(env, await body()));
    if (m === 'POST' && p === '/api/review') return json(await decide(env, await body(), blogAction));
    if (m === 'POST' && (r = p.match(/^\/api\/clusters\/(\d+)\/questions$/))) return json(await generate(env, Number(r[1])));
    if (m === 'POST' && p === '/api/ideas') {
      const b = await body();
      const title = String(b.title || '').trim();
      if (!title) throw fail('No question to add.');
      const exists = await first(env, `SELECT id FROM blog_posts WHERE lower(title)=lower(?) AND status!='rejected'`, title);
      if (exists) return json({ ok: true, id: exists.id, existed: true });
      const made = await createBlog(env, { title: title[0].toUpperCase() + title.slice(1), primary_keyword: title, cluster_id: Number(b.cluster_id) || null });
      return json({ ok: true, id: made.post?.id });
    }
    if (m === 'POST' && p === '/api/clusters') return json(await saveCluster(env, null, await body()));
    if ((r = p.match(/^\/api\/clusters\/(\d+)$/))) {
      if (m === 'POST') return json(await saveCluster(env, Number(r[1]), await body()));
      if (m === 'DELETE') return json(await deleteCluster(env, Number(r[1])));
    }
    if (m === 'GET' && (p === '/p' || p.startsWith('/p/') || p.startsWith('/kit/'))) return Response.redirect(new URL('/', url), 302);
    return null;
  } catch (e) {
    if (!e.status) console.error('app', e);
    if (p.startsWith('/api/')) return json({ error: e.message }, e.status || 500);
    return shell(email, { title: 'Not found', status: e.status || 500, body: `<div class="ct-head"><h1>${esc(e.status ? e.message : 'Something went wrong')}</h1><p><a href="/">Back to the calendar</a></p></div>` });
  }
}
