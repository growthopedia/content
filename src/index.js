// Growthopedia content planner — Cloudflare Worker
// Plans the content calendar, holds every post until you approve it, stores media in R2,
// and emails you when it's time to post (manual mode). Blog posts get a Squarespace Paste kit.

import UI from './ui.html';
import POST_PAGE from './post.html';
import KIT_PAGE from './kit.html';
import SCHEMA from '../schema.sql';
import SEED from '../seed.sql';
import { POST_TYPES, TYPE_LABEL, checkPost, checkBlog, blockingFailures, fullCaption, schemaFor, postUrl, slugify, links, isInternal, cleanHtml } from './rules.js';
import { toSql, nowSql, parseUtc, zonedToUtc, localDate } from './time.js';
import { sendEmail, emailReady } from './email.js';
import { signedInEmail } from './access.js';

let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  const statements = (SCHEMA + '\n' + SEED)
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
  // Columns added after launch. Each runs once; "duplicate column" means it's already there.
  for (const sql of [
    `ALTER TABLE posts ADD COLUMN change_note TEXT`,
    `ALTER TABLE blog_posts ADD COLUMN change_note TEXT`,
  ]) {
    try { await env.DB.prepare(sql).run(); } catch (e) { if (!/duplicate column/i.test(String(e.message || e))) throw e; }
  }
  schemaReady = true;
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const html = (body) =>
  new Response(body, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
    },
  });

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

async function authorized(request, env) {
  // Cloudflare Access signs you in before any request reaches the app (see access.js).
  const email = await signedInEmail(request, env);
  if (!email) return env.ALLOW_NO_ACCESS === 'true'; // only for local testing
  const allowed = (env.ALLOWED_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allowed.length === 0 || allowed.includes(email);
}

async function body(request) {
  // JSON only: blocks other websites from submitting forms to the app.
  if (!(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) throw bad('Send JSON', 415);
  try { return await request.json(); } catch { throw bad('Request body must be JSON'); }
}

export default {
  async fetch(request, env, ctx) {
    if (!(await authorized(request, env))) return new Response('Forbidden', { status: 403 });
    await ensureSchema(env);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      if (method === 'GET' && (path === '/' || path === '/index.html')) return html(UI);
      if (method === 'GET' && /^\/p\/\d+$/.test(path)) return html(POST_PAGE);
      if (method === 'GET' && /^\/kit\/\d+$/.test(path)) return html(KIT_PAGE);
      if (method === 'GET' && path.startsWith('/media/')) {
        let key;
        try { key = decodeURIComponent(path.slice(7)); } catch { return new Response('Not found', { status: 404 }); }
        return serveMedia(env, request, key, url);
      }

      if (path === '/api/summary') return json(await summary(env));
      if (path === '/api/calendar') return json(await calendar(env, url));
      if (path === '/api/approvals') return json(await approvals(env));
      if (path === '/api/queue') return json(await queue(env));
      if (path === '/api/options') return json(await options(env));
      if (path === '/api/settings' && method === 'GET') return json(await getSettings(env));
      if (path === '/api/settings' && method === 'POST') return json(await saveSettings(env, await body(request)));
      if (path === '/api/import' && method === 'POST') return json(await importPlan(env, await body(request)));
      if (path === '/api/test-email' && method === 'POST') return json(await testEmail(env));

      let m;
      // Instagram posts
      if (path === '/api/posts' && method === 'POST') return json(await createPost(env, await body(request)));
      if ((m = path.match(/^\/api\/posts\/(\d+)$/))) {
        const id = Number(m[1]);
        if (method === 'GET') return json(await getPost(env, id));
        if (method === 'POST') return json(await updatePost(env, id, await body(request)));
        if (method === 'DELETE') return json(await deletePost(env, id));
      }
      if ((m = path.match(/^\/api\/posts\/(\d+)\/action$/)) && method === 'POST')
        return json(await postAction(env, Number(m[1]), await body(request)));
      if ((m = path.match(/^\/api\/posts\/(\d+)\/media$/)) && method === 'POST')
        return json(await uploadMedia(env, Number(m[1]), request, url));
      if ((m = path.match(/^\/api\/posts\/(\d+)\/media\/from-url$/)) && method === 'POST')
        return json(await mediaFromUrl(env, Number(m[1]), await body(request)));
      if ((m = path.match(/^\/api\/blog\/(\d+)\/featured\/from-url$/)) && method === 'POST')
        return json(await featuredFromUrl(env, Number(m[1]), await body(request)));
      if ((m = path.match(/^\/api\/posts\/(\d+)\/media\/order$/)) && method === 'POST')
        return json(await reorderMedia(env, Number(m[1]), await body(request)));
      if ((m = path.match(/^\/api\/media\/(\d+)$/)) && method === 'DELETE')
        return json(await deleteMedia(env, Number(m[1])));

      // Blog posts
      if (path === '/api/blog' && method === 'GET') return json(await listBlog(env));
      if (path === '/api/blog' && method === 'POST') return json(await createBlog(env, await body(request)));
      if ((m = path.match(/^\/api\/blog\/(\d+)$/))) {
        const id = Number(m[1]);
        if (method === 'GET') return json(await getBlog(env, id));
        if (method === 'POST') return json(await updateBlog(env, id, await body(request)));
        if (method === 'DELETE') return json(await deleteBlog(env, id));
      }
      if ((m = path.match(/^\/api\/blog\/(\d+)\/action$/)) && method === 'POST')
        return json(await blogAction(env, Number(m[1]), await body(request)));
      if ((m = path.match(/^\/api\/blog\/(\d+)\/featured$/)) && method === 'POST')
        return json(await uploadFeatured(env, Number(m[1]), request, url));
      if ((m = path.match(/^\/api\/blog\/(\d+)\/check-links$/)) && method === 'POST')
        return json(await checkLinks(env, Number(m[1])));

      // Clusters and campaigns
      if (path === '/api/clusters' && method === 'POST') return json(await saveCluster(env, null, await body(request)));
      if ((m = path.match(/^\/api\/clusters\/(\d+)$/))) {
        if (method === 'POST') return json(await saveCluster(env, Number(m[1]), await body(request)));
        if (method === 'DELETE') return json(await deleteCluster(env, Number(m[1])));
      }
      if (path === '/api/campaigns' && method === 'POST') return json(await saveCampaign(env, null, await body(request)));
      if ((m = path.match(/^\/api\/campaigns\/(\d+)$/))) {
        if (method === 'POST') return json(await saveCampaign(env, Number(m[1]), await body(request)));
        if (method === 'DELETE') return json(await deleteCampaign(env, Number(m[1])));
      }

      if (path === '/api/run-reminders' && method === 'POST') return json(await runReminders(env));

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      if (!err.status) console.error(err);
      return json({ error: err.message || String(err) }, err.status || 500);
    }
  },

  async scheduled(event, env, ctx) {
    await ensureSchema(env);
    ctx.waitUntil(runReminders(env).catch((e) => console.error('reminder run failed', e)));
  },
};

// ---------- small helpers ----------

async function all(env, sql, ...params) {
  const r = await env.DB.prepare(sql).bind(...params).all();
  return r.results || [];
}
async function first(env, sql, ...params) {
  return env.DB.prepare(sql).bind(...params).first();
}
async function run(env, sql, ...params) {
  return env.DB.prepare(sql).bind(...params).run();
}

const tz = (env) => env.TIMEZONE || 'America/New_York';
const str = (v, max = 4000) => (v == null || v === '' ? null : String(v).slice(0, max));
const intOrNull = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

function sqlTime(v) {
  if (v == null || v === '') return null;
  const d = parseUtc(v);
  if (!d) throw bad('That date and time is not valid');
  return toSql(d);
}

function localLabel(sqlUtc, env) {
  const d = parseUtc(sqlUtc);
  if (!d) return 'no date set';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz(env), weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(d);
}

async function log(env, { post_id = null, blog_post_id = null, step, ok = true, detail = '' }) {
  await run(env, `INSERT INTO publish_log (post_id, blog_post_id, step, ok, detail) VALUES (?, ?, ?, ?, ?)`,
    post_id, blog_post_id, step, ok ? 1 : 0, String(detail).slice(0, 2000));
}

// ---------- settings ----------

const DEFAULT_SETTINGS = {
  site_url: 'https://www.growthopedia.com',
  blog_path: '/blog',
  org_name: 'Growthopedia',
  logo_url: 'https://images.squarespace-cdn.com/content/v1/64642150deeb795976e61797/8e10d82e-0cbc-4749-a6ad-d7391405c81d/image0.png?format=300w',
  instagram_handle: 'growthopedia.co',
  author_name: 'Jen Cannizzo',
  author_title: 'Founder, Growthopedia',
  author_url: '',
  author_bio: '',
  default_time: '11:30',
  default_days: 'Mon,Tue,Thu,Fri',
  audience: '',
  tone: '',
  avoid: '',
  cta: '',
  link_in_bio: '',
};
const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

async function getSettings(env) {
  const rows = await all(env, `SELECT key, value FROM settings`);
  const saved = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const out = {};
  for (const k of SETTING_KEYS) out[k] = saved[k] ?? DEFAULT_SETTINGS[k];
  out._last_reminder_run = saved._last_reminder_run || null;
  return out;
}

async function saveSettings(env, b) {
  const stmts = [];
  for (const k of SETTING_KEYS) {
    if (b[k] === undefined) continue;
    stmts.push(env.DB.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
      .bind(k, String(b[k]).slice(0, 4000)));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return getSettings(env);
}

async function setMeta(env, key, value) {
  await run(env, `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value);
}

// ---------- overview ----------

async function summary(env) {
  const [toApprove, waiting, attention, scheduled, blogsDue, settings] = await Promise.all([
    first(env, `SELECT (SELECT COUNT(*) FROM posts WHERE status IN ('idea','drafted','changes_requested'))
                     + (SELECT COUNT(*) FROM blog_posts WHERE status IN ('idea','drafted','changes_requested')) n`),
    first(env, `SELECT COUNT(*) n FROM posts WHERE status='reminder_sent'`),
    first(env, `SELECT COUNT(*) n FROM posts WHERE status IN ('needs_manual','failed')`),
    first(env, `SELECT COUNT(*) n FROM posts WHERE status='scheduled'`),
    first(env, `SELECT COUNT(*) n FROM blog_posts WHERE status='draft_approved' AND planned_date <= ?`, localDate(new Date(), tz(env))),
    getSettings(env),
  ]);
  return {
    toApprove: toApprove.n,
    waiting: waiting.n,
    attention: attention.n,
    scheduled: scheduled.n,
    blogsDue: blogsDue.n,
    emailReady: emailReady(env),
    mediaReady: Boolean(env.MEDIA),
    notifyEmail: env.NOTIFY_EMAIL || '',
    authorBioSet: Boolean((settings.author_bio || '').trim()),
    lastReminderRun: settings._last_reminder_run,
    timezone: tz(env),
    instagramHandle: settings.instagram_handle,
    defaultTime: settings.default_time,
    defaultDays: settings.default_days,
  };
}

async function options(env) {
  const [clusters, campaigns] = await Promise.all([
    all(env, `SELECT * FROM clusters ORDER BY name COLLATE NOCASE`),
    all(env, `SELECT c.*, b.title blog_title FROM campaigns c LEFT JOIN blog_posts b ON b.id=c.blog_post_id ORDER BY c.id DESC`),
  ]);
  return { clusters, campaigns, postTypes: POST_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] })) };
}

async function firstThumbs(env, ids) {
  if (!ids.length) return {};
  const rows = await all(env,
    `SELECT post_id, r2_key, kind FROM media WHERE post_id IN (${ids.map(() => '?').join(',')}) AND kind != 'cover' ORDER BY post_id, position`,
    ...ids);
  const out = {};
  for (const r of rows) (out[r.post_id] ||= []).push({ key: r.r2_key, kind: r.kind });
  return out;
}

async function keywordClashes(env) {
  return all(env,
    `SELECT lower(trim(primary_keyword)) keyword, COUNT(*) n, group_concat(id) ids, group_concat(title, ' | ') titles
       FROM blog_posts
      WHERE status NOT IN ('rejected') AND primary_keyword IS NOT NULL AND trim(primary_keyword) != ''
      GROUP BY lower(trim(primary_keyword)) HAVING COUNT(*) > 1`);
}

async function calendar(env, url) {
  const p = url.searchParams;
  const from = sqlTime(p.get('from'));
  const to = sqlTime(p.get('to'));
  const fromDate = p.get('from_date');
  const toDate = p.get('to_date');
  if (!from || !to || !isDate(fromDate) || !isDate(toDate)) throw bad('from, to, from_date and to_date are required');

  const [posts, blogs, unPosts, unBlogs, clusters, clashes] = await Promise.all([
    all(env, `SELECT p.id, p.type, p.title, p.status, p.scheduled_at, p.cluster_id, p.campaign_id, p.publish_mode, p.primary_keyword
                FROM posts p WHERE p.scheduled_at >= ? AND p.scheduled_at < ? AND p.status != 'rejected'
               ORDER BY p.scheduled_at`, from, to),
    all(env, `SELECT id, title, status, planned_date, cluster_id, campaign_id, primary_keyword
                FROM blog_posts WHERE planned_date >= ? AND planned_date <= ? AND status != 'rejected'
               ORDER BY planned_date`, fromDate, toDate),
    all(env, `SELECT id, type, title, status, cluster_id, primary_keyword FROM posts
               WHERE scheduled_at IS NULL AND status NOT IN ('rejected','published') ORDER BY id DESC LIMIT 100`),
    all(env, `SELECT id, title, status, cluster_id, primary_keyword FROM blog_posts
               WHERE planned_date IS NULL AND status NOT IN ('rejected','published') ORDER BY id DESC LIMIT 100`),
    all(env, `SELECT c.id, c.name, c.pillar_url,
                (SELECT COUNT(*) FROM posts p WHERE p.cluster_id=c.id AND p.status!='rejected' AND p.scheduled_at >= ? AND p.scheduled_at < ?) posts,
                (SELECT COUNT(*) FROM blog_posts b WHERE b.cluster_id=c.id AND b.status!='rejected' AND b.planned_date >= ? AND b.planned_date <= ?) blogs
                FROM clusters c ORDER BY c.name COLLATE NOCASE`, from, to, fromDate, toDate),
    keywordClashes(env),
  ]);
  const thumbs = await firstThumbs(env, posts.map((x) => x.id));
  for (const x of posts) x.thumb = thumbs[x.id]?.[0] || null;
  const noCluster = posts.filter((x) => !x.cluster_id).length + blogs.filter((x) => !x.cluster_id).length;
  return { posts, blogs, unscheduled: { posts: unPosts, blogs: unBlogs }, coverage: clusters, noCluster, clashes };
}

async function approvals(env) {
  const [posts, blogs, clusters, settings, clashes] = await Promise.all([
    all(env, `SELECT p.*, c.name cluster_name FROM posts p LEFT JOIN clusters c ON c.id=p.cluster_id
               WHERE p.status IN ('idea','drafted','changes_requested') ORDER BY p.scheduled_at IS NULL, p.scheduled_at, p.id`),
    all(env, `SELECT b.*, c.name cluster_name FROM blog_posts b LEFT JOIN clusters c ON c.id=b.cluster_id
               WHERE b.status IN ('idea','drafted','changes_requested') ORDER BY b.planned_date IS NULL, b.planned_date, b.id`),
    all(env, `SELECT * FROM clusters`),
    getSettings(env),
    keywordClashes(env),
  ]);
  const media = await mediaFor(env, posts.filter((p) => p.status === 'drafted').map((p) => p.id));
  for (const p of posts) {
    p.media = media[p.id] || [];
    if (p.status === 'drafted') p.checks = checkPost(p, p.media);
  }
  const byId = Object.fromEntries(clusters.map((c) => [c.id, c]));
  for (const b of blogs) {
    if (b.status !== 'drafted') { b.body_html = undefined; continue; }
    const checks = checkBlog(b, { cluster: byId[b.cluster_id], settings, clashes: clashesFor(b, clashes) });
    b.failing = checks.filter((x) => !x.ok).map((x) => ({ label: x.label, level: x.level }));
    b.body_html = undefined;
  }
  return { posts, blogs };
}

async function queue(env) {
  const today = localDate(new Date(), tz(env));
  const [attention, waiting, scheduled, ready, readyBlogs, blogsDue, recent, recentBlogs] = await Promise.all([
    all(env, `SELECT * FROM posts WHERE status IN ('needs_manual','failed') ORDER BY scheduled_at`),
    all(env, `SELECT * FROM posts WHERE status='reminder_sent' ORDER BY scheduled_at`),
    all(env, `SELECT * FROM posts WHERE status='scheduled' ORDER BY scheduled_at`),
    all(env, `SELECT * FROM posts WHERE status='draft_approved' ORDER BY scheduled_at IS NULL, scheduled_at`),
    all(env, `SELECT id, title, planned_date, status FROM blog_posts WHERE status='draft_approved' AND (planned_date IS NULL OR planned_date > ?) ORDER BY planned_date`, today),
    all(env, `SELECT id, title, planned_date, status FROM blog_posts WHERE status='draft_approved' AND planned_date <= ? ORDER BY planned_date`, today),
    all(env, `SELECT * FROM posts WHERE status='published' AND published_at >= datetime('now','-30 days') ORDER BY published_at DESC`),
    all(env, `SELECT id, title, planned_date, published_url, published_at FROM blog_posts WHERE status='published' AND published_at >= datetime('now','-30 days') ORDER BY published_at DESC`),
  ]);
  const ids = [...attention, ...waiting, ...scheduled, ...ready, ...recent].map((p) => p.id);
  const thumbs = await firstThumbs(env, ids);
  for (const p of [...attention, ...waiting, ...scheduled, ...ready, ...recent]) p.thumb = thumbs[p.id]?.[0] || null;
  return { attention, waiting, scheduled, ready, readyBlogs, blogsDue, recent, recentBlogs };
}

// ---------- Instagram posts ----------

const POST_FIELDS = ['campaign_id', 'cluster_id', 'type', 'title', 'topic', 'reason', 'primary_keyword',
  'caption', 'hashtags', 'first_comment', 'alt_text', 'scheduled_at', 'publish_mode'];
// Changing any of these after the draft was approved sends it back for approval.
const POST_CONTENT = ['type', 'caption', 'hashtags', 'first_comment', 'alt_text'];
const APPROVED_POST_STATES = ['draft_approved', 'scheduled', 'reminder_sent', 'needs_manual', 'failed'];

function normPostField(k, v, env) {
  switch (k) {
    case 'campaign_id': case 'cluster_id': return intOrNull(v);
    case 'type':
      if (!POST_TYPES.includes(v)) throw bad('Unknown post type');
      return v;
    case 'title': {
      const t = str(v, 200);
      if (!t) throw bad('Give the post a working title');
      return t;
    }
    case 'scheduled_at': return sqlTime(v);
    case 'publish_mode':
      if (v === 'auto') throw bad('Auto publishing arrives with Instagram publishing (Phase 2). Use Manual for now.');
      if (v !== 'manual') throw bad('Unknown publish mode');
      return v;
    case 'caption': return str(v, 5000);
    default: return str(v, 2000);
  }
}

async function createPost(env, b) {
  const vals = {};
  for (const k of POST_FIELDS) if (b[k] !== undefined) vals[k] = normPostField(k, b[k], env);
  if (!vals.title) throw bad('Give the post a working title');
  vals.type ||= 'image';
  vals.publish_mode ||= 'manual';
  const approve = b.approve_topic === true;
  const cols = Object.keys(vals);
  const r = await run(env,
    `INSERT INTO posts (${cols.join(', ')}, status, topic_approved_at) VALUES (${cols.map(() => '?').join(', ')}, ?, ?)`,
    ...cols.map((k) => vals[k]), approve ? 'topic_approved' : 'idea', approve ? nowSql() : null);
  return getPost(env, r.meta.last_row_id);
}

async function mediaFor(env, ids) {
  if (!ids.length) return {};
  const rows = await all(env, `SELECT * FROM media WHERE post_id IN (${ids.map(() => '?').join(',')}) ORDER BY post_id, position, id`, ...ids);
  const out = {};
  for (const r of rows) (out[r.post_id] ||= []).push(r);
  return out;
}

async function loadPost(env, id) {
  const p = await first(env, `SELECT * FROM posts WHERE id=?`, id);
  if (!p) throw bad('Post not found', 404);
  return p;
}

async function getPost(env, id) {
  const p = await first(env,
    `SELECT p.*, c.name cluster_name, c.pillar_url, k.name campaign_name
       FROM posts p LEFT JOIN clusters c ON c.id=p.cluster_id LEFT JOIN campaigns k ON k.id=p.campaign_id WHERE p.id=?`, id);
  if (!p) throw bad('Post not found', 404);
  const media = (await mediaFor(env, [id]))[id] || [];
  const settings = await getSettings(env);
  return {
    post: p,
    media,
    checks: checkPost(p, media),
    fullCaption: fullCaption(p),
    typeLabel: TYPE_LABEL[p.type],
    whenLabel: localLabel(p.scheduled_at, env),
    handle: settings.instagram_handle,
  };
}

// Edits to an approved post's content send it back for approval.
async function revertPostApproval(env, id) {
  const r = await run(env,
    `UPDATE posts SET status='drafted', draft_approved_at=NULL, reminder_sent_at=NULL, attempts=0, error=NULL, updated_at=datetime('now')
      WHERE id=? AND status IN (${APPROVED_POST_STATES.map(() => '?').join(',')})`, id, ...APPROVED_POST_STATES);
  const held = await run(env, `UPDATE posts SET draft_approved_at=NULL WHERE id=? AND status='on_hold' AND draft_approved_at IS NOT NULL`, id);
  return r.meta.changes > 0 || held.meta.changes > 0;
}

async function updatePost(env, id, b) {
  const p = await loadPost(env, id);
  if (p.status === 'published') throw bad('Published posts can’t be edited.');
  const sets = [];
  const params = [];
  let contentChanged = false;
  let timeChanged = false;
  const next = {};
  for (const k of POST_FIELDS) {
    if (b[k] === undefined) continue;
    const v = normPostField(k, b[k], env);
    if ((v ?? null) === (p[k] ?? null)) continue;
    next[k] = v;
    sets.push(`${k}=?`);
    params.push(v);
    if (POST_CONTENT.includes(k)) contentChanged = true;
    if (k === 'scheduled_at') timeChanged = true;
  }
  if (!sets.length) return { ...(await getPost(env, id)), reverted: false };

  let reverted = false;
  if (contentChanged && APPROVED_POST_STATES.includes(p.status)) {
    sets.push(`status='drafted'`, `draft_approved_at=NULL`, `reminder_sent_at=NULL`, `attempts=0`, `error=NULL`);
    reverted = true;
  } else if (contentChanged && p.status === 'on_hold' && p.draft_approved_at) {
    sets.push(`draft_approved_at=NULL`); // reopening later needs a fresh approval
    reverted = true;
  } else if (timeChanged && ['scheduled', 'reminder_sent', 'needs_manual', 'failed'].includes(p.status)) {
    const when = parseUtc(next.scheduled_at);
    if (!when) sets.push(`status='draft_approved'`);
    else if (when.getTime() < Date.now() + 60_000) throw bad('Pick a time in the future, or unschedule the post first.');
    else sets.push(`status='scheduled'`, `reminder_sent_at=NULL`, `attempts=0`, `error=NULL`);
  }
  sets.push(`updated_at=datetime('now')`);
  await run(env, `UPDATE posts SET ${sets.join(', ')} WHERE id=?`, ...params, id);
  return { ...(await getPost(env, id)), reverted };
}

async function postAction(env, id, b) {
  const p = await loadPost(env, id);
  const media = (await mediaFor(env, [id]))[id] || [];
  const action = b.action;
  const set = async (sql, ...params) => run(env, `UPDATE posts SET ${sql}, updated_at=datetime('now') WHERE id=?`, ...params, id);
  const need = (states, what) => {
    if (!states.includes(p.status)) throw bad(`Can’t ${what} a post that is ${p.status.replace('_', ' ')}.`);
  };

  switch (action) {
    case 'approve_topic':
      need(['idea'], 'approve the topic of');
      await set(`status='topic_approved', topic_approved_at=datetime('now'), rejection_reason=NULL`);
      break;
    case 'submit_draft': {
      need(['topic_approved', 'changes_requested'], 'submit');
      const { errors } = checkPost(p, media);
      if (errors.length) throw bad(`Fix before submitting: ${errors.join(' ')}`);
      await set(`status='drafted'`);
      break;
    }
    case 'approve_draft': {
      need(['drafted'], 'approve the draft of');
      const { errors } = checkPost(p, media);
      if (errors.length) throw bad(`Fix before approving: ${errors.join(' ')}`);
      await set(`status='draft_approved', draft_approved_at=datetime('now'), rejection_reason=NULL, change_note=NULL`);
      break;
    }
    case 'request_changes': {
      need(['drafted', ...APPROVED_POST_STATES], 'request changes to');
      const note = str(b.note, 2000);
      if (!note) throw bad('Say what to change.');
      await set(`status='changes_requested', change_note=?, draft_approved_at=NULL, reminder_sent_at=NULL, attempts=0, error=NULL`, note);
      break;
    }
    case 'schedule': {
      need(['draft_approved'], 'schedule');
      if (!p.draft_approved_at) throw bad('Approve the draft first.');
      const when = parseUtc(p.scheduled_at);
      if (!when) throw bad('Set a date and time first.');
      if (when.getTime() < Date.now() + 60_000) throw bad('That time has passed. Pick a time in the future.');
      if (p.publish_mode !== 'manual') throw bad('Auto publishing arrives in Phase 2. Switch to Manual.');
      await set(`status='scheduled', reminder_sent_at=NULL, attempts=0, error=NULL`);
      break;
    }
    case 'unschedule':
      need(['scheduled', 'reminder_sent', 'needs_manual', 'failed'], 'unschedule');
      await set(`status='draft_approved', reminder_sent_at=NULL, attempts=0, error=NULL`);
      break;
    case 'back_to_draft':
      need(['drafted', 'changes_requested', ...APPROVED_POST_STATES], 'reopen');
      await set(`status='topic_approved', draft_approved_at=NULL, reminder_sent_at=NULL, attempts=0, error=NULL`);
      break;
    case 'remind_now':
      need(['scheduled', 'reminder_sent', 'needs_manual', 'failed'], 'send a reminder for');
      await sendPostReminder(env, p);
      await set(`status='reminder_sent', reminder_sent_at=datetime('now'), error=NULL`);
      break;
    case 'mark_posted': {
      need(['draft_approved', 'scheduled', 'reminder_sent', 'needs_manual', 'failed'], 'mark as posted');
      const link = str(b.permalink, 500);
      if (link && !/^https:\/\/(www\.)?instagram\.com\//i.test(link)) throw bad('That isn’t an instagram.com link.');
      await set(`status='published', published_at=datetime('now'), ig_permalink=COALESCE(?, ig_permalink), error=NULL`, link);
      await log(env, { post_id: id, step: 'marked_posted', detail: link || '' });
      break;
    }
    case 'reject':
      if (p.status === 'published') throw bad('Published posts can’t be rejected.');
      await set(`status='rejected', rejection_reason=?`, str(b.reason, 1000));
      break;
    case 'hold':
      if (['published', 'rejected'].includes(p.status)) throw bad(`Can’t put a ${p.status} post on hold.`);
      await set(`status='on_hold'`);
      break;
    case 'reopen': {
      need(['on_hold', 'rejected'], 'reopen');
      const back = p.status === 'rejected' ? 'idea'
        : p.draft_approved_at ? 'draft_approved' : p.topic_approved_at ? 'topic_approved' : 'idea';
      if (p.status === 'rejected') await set(`status='idea', topic_approved_at=NULL, draft_approved_at=NULL, rejection_reason=NULL`);
      else await set(`status=?`, back);
      break;
    }
    default:
      throw bad('Unknown action');
  }
  return getPost(env, id);
}

async function deletePost(env, id) {
  const p = await loadPost(env, id);
  if (p.status === 'published') throw bad('Published posts are kept as a record. Reject or keep it instead.');
  const media = await all(env, `SELECT r2_key FROM media WHERE post_id=?`, id);
  if (media.length && env.MEDIA) await env.MEDIA.delete(media.map((m) => m.r2_key));
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM media WHERE post_id=?`).bind(id),
    env.DB.prepare(`DELETE FROM posts WHERE id=?`).bind(id),
  ]);
  return { ok: true };
}

// ---------- media (R2) ----------

const MAX_UPLOAD = 100 * 1024 * 1024; // Cloudflare's request size limit on the Free plan
const safeName = (s) => (s || 'file').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+/, '').slice(-80) || 'file';

function requireMedia(env) {
  if (!env.MEDIA) throw bad('Media storage (R2) isn’t connected. See SETUP.md step 1.', 503);
}

async function uploadMedia(env, postId, request, url) {
  requireMedia(env);
  const p = await loadPost(env, postId);
  if (p.status === 'published') throw bad('Published posts can’t be changed.');
  const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^(image\/(jpeg|png|webp|heic|heif|gif)|video\/(mp4|quicktime))$/.test(type))
    throw bad('Upload JPG, PNG, WebP or HEIC images, or MP4/MOV videos.');
  const size = Number(request.headers.get('content-length') || 0);
  if (!size) throw bad('Empty upload');
  if (size > MAX_UPLOAD) throw bad('Files must be under 100 MB.');
  const q = url.searchParams;
  const filename = safeName(q.get('filename'));
  const kind = q.get('kind') === 'cover' ? 'cover' : type.startsWith('video/') ? 'video' : 'image';
  const key = `posts/${postId}/${crypto.randomUUID()}-${filename}`;
  await env.MEDIA.put(key, request.body, { httpMetadata: { contentType: type } });
  const pos = await first(env, `SELECT COALESCE(MAX(position), -1) + 1 n FROM media WHERE post_id=?`, postId);
  const source = ['upload', 'canva_chat', 'canva_api'].includes(q.get('source')) ? q.get('source') : 'upload';
  await run(env,
    `INSERT INTO media (post_id, position, r2_key, filename, kind, content_type, size, width, height, duration_s, source, canva_design_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    postId, pos.n, key, filename, kind, type, size, intOrNull(q.get('width')), intOrNull(q.get('height')),
    q.get('duration') ? Number(q.get('duration')) || null : null, source, str(q.get('canva_design_id'), 100));
  const reverted = await revertPostApproval(env, postId);
  return { ...(await getPost(env, postId)), reverted };
}

// ---------- pull files from Canva export links ----------
// Canva export links are short-lived downloads; the Worker fetches them and stores the file in R2,
// so nothing has to be downloaded and re-uploaded by hand.

function allowedSource(u) {
  let url;
  try { url = new URL(u); } catch { throw bad('That link is not valid.'); }
  if (url.protocol !== 'https:') throw bad('Only https links are allowed.');
  const host = url.hostname.toLowerCase();
  if (!(host === 'canva.com' || host.endsWith('.canva.com') || host.endsWith('.amazonaws.com')))
    throw bad('Only Canva export links can be imported.');
  return url.toString();
}

// Width and height from the first bytes of a PNG or JPEG.
export function imageSize(bytes) {
  const b = bytes;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
    const dv = new DataView(b.buffer, b.byteOffset);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      const len = (b[i + 2] << 8) + b[i + 3];
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf))
        return { height: (b[i + 5] << 8) + b[i + 6], width: (b[i + 7] << 8) + b[i + 8] };
      i += 2 + len;
    }
  }
  return {};
}

async function fetchExport(u) {
  const r = await fetch(allowedSource(u), { redirect: 'follow' });
  if (!r.ok) throw bad(`Couldn't download that file (${r.status}). Export links expire, so export again.`, 502);
  const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > MAX_UPLOAD) throw bad('File is over 100 MB.');
  return { type, buf };
}

async function mediaFromUrl(env, postId, b) {
  requireMedia(env);
  const p = await loadPost(env, postId);
  if (p.status === 'published') throw bad('Published posts can’t be changed.');
  const urls = Array.isArray(b.urls) ? b.urls : b.url ? [b.url] : [];
  if (!urls.length || urls.length > 10) throw bad('Send 1–10 links.');
  if (b.replace) {
    const old = await all(env, `SELECT r2_key FROM media WHERE post_id=?`, postId);
    if (old.length) await env.MEDIA.delete(old.map((x) => x.r2_key));
    await run(env, `DELETE FROM media WHERE post_id=?`, postId);
  }
  for (const [i, u] of urls.entries()) {
    const { type, buf } = await fetchExport(u);
    if (!/^(image\/(jpeg|png)|video\/mp4)$/.test(type)) throw bad(`Link ${i + 1} isn't a JPG, PNG or MP4 (got ${type || 'unknown'}).`);
    const ext = type === 'video/mp4' ? 'mp4' : type === 'image/png' ? 'png' : 'jpg';
    const filename = safeName(`${b.name || 'canva'}-${i + 1}.${ext}`);
    const key = `posts/${postId}/${crypto.randomUUID()}-${filename}`;
    await env.MEDIA.put(key, buf, { httpMetadata: { contentType: type } });
    const size = type.startsWith('image/') ? imageSize(buf) : {};
    const pos = await first(env, `SELECT COALESCE(MAX(position), -1) + 1 n FROM media WHERE post_id=?`, postId);
    await run(env,
      `INSERT INTO media (post_id, position, r2_key, filename, kind, content_type, size, width, height, source, canva_design_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'canva_chat', ?)`,
      postId, pos.n, key, filename, type.startsWith('video/') ? 'video' : 'image', type, buf.length,
      size.width || null, size.height || null, str(b.canva_design_id, 100));
  }
  const reverted = await revertPostApproval(env, postId);
  return { ...(await getPost(env, postId)), reverted };
}

async function featuredFromUrl(env, id, b) {
  requireMedia(env);
  const p = await loadBlog(env, id);
  if (p.status === 'published') throw bad('Published posts can’t be changed here.');
  const { type, buf } = await fetchExport(b.url);
  if (!/^image\/(jpeg|png)$/.test(type)) throw bad(`That link isn't a JPG or PNG (got ${type || 'unknown'}).`);
  const key = `blog/${id}/${crypto.randomUUID()}-${safeName(`${b.name || 'featured'}.${type === 'image/png' ? 'png' : 'jpg'}`)}`;
  await env.MEDIA.put(key, buf, { httpMetadata: { contentType: type } });
  if (p.featured_image_key) await env.MEDIA.delete(p.featured_image_key);
  await run(env, `UPDATE blog_posts SET featured_image_key=?, updated_at=datetime('now') WHERE id=?`, key, id);
  let reverted = false;
  if (p.status === 'draft_approved') {
    await run(env, `UPDATE blog_posts SET status='drafted', draft_approved_at=NULL, reminder_sent_at=NULL WHERE id=?`, id);
    reverted = true;
  } else if (p.status === 'on_hold' && p.draft_approved_at) {
    await run(env, `UPDATE blog_posts SET draft_approved_at=NULL WHERE id=?`, id);
    reverted = true;
  }
  return { ...(await getBlog(env, id)), reverted };
}

async function reorderMedia(env, postId, b) {
  const p = await loadPost(env, postId);
  if (p.status === 'published') throw bad('Published posts can’t be changed.');
  const ids = (b.ids || []).map(Number);
  const existing = await all(env, `SELECT id FROM media WHERE post_id=?`, postId);
  const have = new Set(existing.map((r) => r.id));
  if (ids.length !== have.size || !ids.every((i) => have.has(i))) throw bad('Media list is out of date. Reload and try again.');
  await env.DB.batch(ids.map((mid, i) => env.DB.prepare(`UPDATE media SET position=? WHERE id=?`).bind(i, mid)));
  const reverted = await revertPostApproval(env, postId);
  return { ...(await getPost(env, postId)), reverted };
}

async function deleteMedia(env, id) {
  const m = await first(env, `SELECT * FROM media WHERE id=?`, id);
  if (!m) throw bad('File not found', 404);
  const p = await loadPost(env, m.post_id);
  if (p.status === 'published') throw bad('Published posts can’t be changed.');
  if (env.MEDIA) await env.MEDIA.delete(m.r2_key);
  await run(env, `DELETE FROM media WHERE id=?`, id);
  const rest = await all(env, `SELECT id FROM media WHERE post_id=? ORDER BY position, id`, m.post_id);
  if (rest.length) await env.DB.batch(rest.map((r, i) => env.DB.prepare(`UPDATE media SET position=? WHERE id=?`).bind(i, r.id)));
  const reverted = await revertPostApproval(env, m.post_id);
  return { ...(await getPost(env, m.post_id)), reverted };
}

// Streams a file from R2. Supports byte ranges, which iPhone Safari needs to play video.
async function serveMedia(env, request, key, url) {
  requireMedia(env);
  if (!/^(posts|blog)\/\d+\/[a-zA-Z0-9._-]+$/.test(key)) return new Response('Not found', { status: 404 });
  const rangeHeader = request.headers.get('range');
  let range;
  const rm = rangeHeader && rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (rm) {
    if (rm[1] === '' && rm[2] !== '') range = { suffix: Number(rm[2]) };
    else if (rm[1] !== '') {
      if (rm[2] !== '' && Number(rm[2]) < Number(rm[1])) return new Response('Bad range', { status: 416 });
      range = rm[2] !== '' ? { offset: Number(rm[1]), length: Number(rm[2]) - Number(rm[1]) + 1 } : { offset: Number(rm[1]) };
    }
  }
  if (range) {
    // Turn every range into offset + length so the Content-Range header is always right.
    const head = await env.MEDIA.head(key);
    if (!head) return new Response('Not found', { status: 404 });
    const size = head.size;
    let start = range.suffix !== undefined ? Math.max(0, size - range.suffix) : range.offset;
    let len = range.suffix !== undefined ? size - start : range.length ?? size - start;
    if (start >= size) return new Response('Range not satisfiable', { status: 416, headers: { 'content-range': `bytes */${size}` } });
    len = Math.min(len, size - start);
    range = { offset: start, length: len };
  }
  const obj = await env.MEDIA.get(key, range ? { range } : undefined);
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'private, max-age=3600');
  if (url.searchParams.get('download') === '1') {
    headers.set('content-disposition', `attachment; filename="${key.split('/').pop().replace(/^[0-9a-f-]{36}-/, '')}"`);
  }
  if (range) {
    const start = range.offset;
    const len = range.length;
    headers.set('content-range', `bytes ${start}-${start + len - 1}/${obj.size}`);
    headers.set('content-length', String(len));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('content-length', String(obj.size));
  return new Response(obj.body, { headers });
}

// ---------- blog posts ----------

const BLOG_FIELDS = ['campaign_id', 'cluster_id', 'title', 'topic', 'reason', 'primary_keyword', 'intent', 'slug', 'seo_title',
  'meta_description', 'excerpt', 'categories', 'tags', 'body_html', 'has_faq', 'featured_alt', 'planned_date', 'notes'];
const BLOG_CONTENT = ['title', 'primary_keyword', 'slug', 'seo_title', 'meta_description', 'excerpt', 'categories', 'tags',
  'body_html', 'has_faq', 'featured_alt'];
const INTENTS = ['informational', 'commercial', 'transactional', 'navigational'];

function normBlogField(k, v) {
  switch (k) {
    case 'campaign_id': case 'cluster_id': return intOrNull(v);
    case 'title': {
      const t = str(v, 200);
      if (!t) throw bad('Give the blog post a title');
      return t;
    }
    case 'intent':
      if (v && !INTENTS.includes(v)) throw bad('Unknown search intent');
      return v || null;
    case 'slug': {
      const s = str(v, 120);
      return s ? slugify(s) : null;
    }
    case 'has_faq': return v ? 1 : 0;
    case 'planned_date':
      if (v && !isDate(v)) throw bad('Planned date must be YYYY-MM-DD');
      return v || null;
    case 'body_html': return str(cleanHtml(v), 200_000);
    default: return str(v, 4000);
  }
}

async function loadBlog(env, id) {
  const b = await first(env, `SELECT * FROM blog_posts WHERE id=?`, id);
  if (!b) throw bad('Blog post not found', 404);
  return b;
}

function clashesFor(post, clashes) {
  const kw = (post.primary_keyword || '').trim().toLowerCase();
  const c = clashes.find((x) => x.keyword === kw);
  if (!c) return [];
  const ids = String(c.ids).split(',').map(Number);
  const titles = String(c.titles).split(' | ');
  return ids.map((id, i) => ({ id, title: titles[i] })).filter((x) => x.id !== post.id);
}

async function blogContext(env, b) {
  const [cluster, settings, clashes] = await Promise.all([
    b.cluster_id ? first(env, `SELECT * FROM clusters WHERE id=?`, b.cluster_id) : null,
    getSettings(env),
    keywordClashes(env),
  ]);
  return { cluster, settings, clashes: clashesFor(b, clashes) };
}

async function getBlog(env, id) {
  const b = await first(env,
    `SELECT b.*, c.name cluster_name, k.name campaign_name FROM blog_posts b
       LEFT JOIN clusters c ON c.id=b.cluster_id LEFT JOIN campaigns k ON k.id=b.campaign_id WHERE b.id=?`, id);
  if (!b) throw bad('Blog post not found', 404);
  const ctx = await blogContext(env, b);
  const campaignPosts = b.campaign_id
    ? await all(env, `SELECT id, type, title, status, scheduled_at FROM posts WHERE campaign_id=? ORDER BY scheduled_at`, b.campaign_id)
    : [];
  return {
    post: b,
    checks: checkBlog(b, ctx),
    schema: schemaFor(b, ctx.settings),
    url: postUrl(b, ctx.settings),
    cluster: ctx.cluster,
    campaignPosts,
    settings: { site_url: ctx.settings.site_url, blog_path: ctx.settings.blog_path },
  };
}

async function listBlog(env) {
  const rows = await all(env,
    `SELECT b.*, c.name cluster_name FROM blog_posts b LEFT JOIN clusters c ON c.id=b.cluster_id
      ORDER BY CASE b.status WHEN 'published' THEN 1 WHEN 'rejected' THEN 2 ELSE 0 END, b.planned_date IS NULL, b.planned_date, b.id DESC`);
  const [clusters, settings, clashes] = await Promise.all([all(env, `SELECT * FROM clusters`), getSettings(env), keywordClashes(env)]);
  const byId = Object.fromEntries(clusters.map((c) => [c.id, c]));
  return rows.map((b) => {
    const checks = checkBlog(b, { cluster: byId[b.cluster_id], settings, clashes: clashesFor(b, clashes) });
    const { body_html, ...rest } = b;
    return { ...rest, passed: checks.filter((x) => x.ok).length, total: checks.length, blocking: blockingFailures(checks).length };
  });
}

async function createBlog(env, b) {
  const vals = {};
  for (const k of BLOG_FIELDS) if (b[k] !== undefined) vals[k] = normBlogField(k, b[k]);
  if (!vals.title) throw bad('Give the blog post a title');
  vals.slug ||= slugify(vals.primary_keyword || vals.title);
  const approve = b.approve_topic === true;
  const cols = Object.keys(vals);
  const r = await run(env,
    `INSERT INTO blog_posts (${cols.join(', ')}, status, topic_approved_at) VALUES (${cols.map(() => '?').join(', ')}, ?, ?)`,
    ...cols.map((k) => vals[k]), approve ? 'topic_approved' : 'idea', approve ? nowSql() : null);
  const id = r.meta.last_row_id;
  if (vals.campaign_id) await run(env, `UPDATE campaigns SET blog_post_id=COALESCE(blog_post_id, ?) WHERE id=?`, id, vals.campaign_id);
  return getBlog(env, id);
}

async function updateBlog(env, id, b) {
  const p = await loadBlog(env, id);
  if (p.status === 'published' && Object.keys(b).some((k) => BLOG_CONTENT.includes(k)))
    throw bad('This post is published. Edit it in Squarespace; change notes or the live URL here.');
  const sets = [];
  const params = [];
  let contentChanged = false;
  for (const k of BLOG_FIELDS) {
    if (b[k] === undefined) continue;
    const v = normBlogField(k, b[k]);
    if ((v ?? null) === (p[k] ?? null)) continue;
    sets.push(`${k}=?`);
    params.push(v);
    if (BLOG_CONTENT.includes(k)) contentChanged = true;
  }
  if (b.published_url !== undefined && p.status === 'published') {
    const u = str(b.published_url, 500);
    if (u && !/^https?:\/\//i.test(u)) throw bad('The live URL must start with https://');
    sets.push('published_url=?');
    params.push(u);
  }
  let reverted = false;
  if (contentChanged && p.status === 'draft_approved') {
    sets.push(`status='drafted'`, `draft_approved_at=NULL`, `reminder_sent_at=NULL`);
    reverted = true;
  } else if (contentChanged && p.status === 'on_hold' && p.draft_approved_at) {
    sets.push(`draft_approved_at=NULL`);
    reverted = true;
  }
  // A new publish date means a new reminder; saving without changing the date doesn't.
  if (b.planned_date !== undefined && (normBlogField('planned_date', b.planned_date) ?? null) !== (p.planned_date ?? null)
      && p.status === 'draft_approved' && !reverted) sets.push(`reminder_sent_at=NULL`);
  if (sets.length) {
    sets.push(`updated_at=datetime('now')`);
    await run(env, `UPDATE blog_posts SET ${sets.join(', ')} WHERE id=?`, ...params, id);
    if (b.campaign_id) await run(env, `UPDATE campaigns SET blog_post_id=COALESCE(blog_post_id, ?) WHERE id=?`, id, intOrNull(b.campaign_id));
  }
  return { ...(await getBlog(env, id)), reverted };
}

async function blogAction(env, id, b) {
  const p = await loadBlog(env, id);
  const set = async (sql, ...params) => run(env, `UPDATE blog_posts SET ${sql}, updated_at=datetime('now') WHERE id=?`, ...params, id);
  const need = (states, what) => {
    if (!states.includes(p.status)) throw bad(`Can’t ${what} a post that is ${p.status.replace('_', ' ')}.`);
  };
  switch (b.action) {
    case 'approve_topic':
      need(['idea'], 'approve the topic of');
      await set(`status='topic_approved', topic_approved_at=datetime('now'), rejection_reason=NULL`);
      break;
    case 'submit_draft':
    case 'approve_draft': {
      const submitting = b.action === 'submit_draft';
      need(submitting ? ['topic_approved', 'changes_requested'] : ['drafted'], submitting ? 'submit' : 'approve the draft of');
      const blocking = blockingFailures(checkBlog(p, await blogContext(env, p)));
      if (blocking.length) throw bad(`Fix before ${submitting ? 'submitting' : 'approving'}: ${blocking.map((x) => x.label).join('; ')}.`);
      if (submitting) await set(`status='drafted'`);
      else await set(`status='draft_approved', draft_approved_at=datetime('now'), rejection_reason=NULL, reminder_sent_at=NULL, change_note=NULL`);
      break;
    }
    case 'request_changes': {
      need(['drafted', 'draft_approved'], 'request changes to');
      const note = str(b.note, 2000);
      if (!note) throw bad('Say what to change.');
      await set(`status='changes_requested', change_note=?, draft_approved_at=NULL, reminder_sent_at=NULL`, note);
      break;
    }
    case 'back_to_draft':
      need(['drafted', 'draft_approved', 'changes_requested'], 'reopen');
      await set(`status='topic_approved', draft_approved_at=NULL, reminder_sent_at=NULL`);
      break;
    case 'mark_published': {
      need(['draft_approved'], 'mark as published');
      const u = str(b.url, 500);
      if (!u || !/^https?:\/\//i.test(u)) throw bad('Paste the live post URL (starting with https://).');
      await set(`status='published', published_url=?, published_at=datetime('now')`, u);
      await log(env, { blog_post_id: id, step: 'marked_published', detail: u });
      break;
    }
    case 'reject':
      need(['idea', 'topic_approved', 'drafted', 'draft_approved', 'changes_requested', 'on_hold'], 'reject');
      await set(`status='rejected', rejection_reason=?`, str(b.reason, 1000));
      break;
    case 'hold':
      need(['idea', 'topic_approved', 'drafted', 'draft_approved', 'changes_requested'], 'hold');
      await set(`status='on_hold'`);
      break;
    case 'reopen': {
      need(['on_hold', 'rejected'], 'reopen');
      if (p.status === 'rejected') await set(`status='idea', topic_approved_at=NULL, draft_approved_at=NULL, rejection_reason=NULL`);
      else await set(`status=?`, p.draft_approved_at ? 'draft_approved' : p.topic_approved_at ? 'topic_approved' : 'idea');
      break;
    }
    default:
      throw bad('Unknown action');
  }
  return getBlog(env, id);
}

async function deleteBlog(env, id) {
  const p = await loadBlog(env, id);
  if (p.status === 'published') throw bad('Published posts are kept as a record.');
  if (p.featured_image_key && env.MEDIA) await env.MEDIA.delete(p.featured_image_key);
  await env.DB.batch([
    env.DB.prepare(`UPDATE campaigns SET blog_post_id=NULL WHERE blog_post_id=?`).bind(id),
    env.DB.prepare(`DELETE FROM blog_posts WHERE id=?`).bind(id),
  ]);
  return { ok: true };
}

async function uploadFeatured(env, id, request, url) {
  requireMedia(env);
  const p = await loadBlog(env, id);
  if (p.status === 'published') throw bad('Published posts can’t be changed here.');
  const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^image\/(jpeg|png|webp)$/.test(type)) throw bad('Upload a JPG, PNG or WebP image.');
  const size = Number(request.headers.get('content-length') || 0);
  if (!size) throw bad('Empty upload');
  if (size > 20 * 1024 * 1024) throw bad('Keep featured images under 20 MB (Squarespace’s limit).');
  const key = `blog/${id}/${crypto.randomUUID()}-${safeName(url.searchParams.get('filename'))}`;
  await env.MEDIA.put(key, request.body, { httpMetadata: { contentType: type } });
  if (p.featured_image_key) await env.MEDIA.delete(p.featured_image_key);
  await run(env, `UPDATE blog_posts SET featured_image_key=?, updated_at=datetime('now') WHERE id=?`, key, id);
  let reverted = false;
  if (p.status === 'draft_approved') {
    await run(env, `UPDATE blog_posts SET status='drafted', draft_approved_at=NULL, reminder_sent_at=NULL WHERE id=?`, id);
    reverted = true;
  } else if (p.status === 'on_hold' && p.draft_approved_at) {
    await run(env, `UPDATE blog_posts SET draft_approved_at=NULL WHERE id=?`, id);
    reverted = true;
  }
  return { ...(await getBlog(env, id)), reverted };
}

// Fetches each internal link to confirm it's live (Squarespace returns 404 for missing pages).
async function checkLinks(env, id) {
  const p = await loadBlog(env, id);
  const settings = await getSettings(env);
  const site = (settings.site_url || '').replace(/\/$/, '');
  const internal = links(p.body_html).filter((l) => isInternal(l.href, settings.site_url));
  const unique = [...new Map(internal.map((l) => [l.href, l])).values()].slice(0, 25);
  const results = await Promise.all(unique.map(async (l) => {
    const target = l.href.startsWith('/') ? `${site}${l.href}` : l.href;
    try {
      let r = await fetch(target, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(8000) });
      if (r.status === 405 || r.status === 403) r = await fetch(target, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
      return { href: l.href, text: l.text, status: r.status, ok: r.ok };
    } catch (e) {
      return { href: l.href, text: l.text, status: 0, ok: false, error: e.name === 'TimeoutError' ? 'Timed out' : 'Could not reach' };
    }
  }));
  return { results, checkedAt: nowSql() };
}

// ---------- clusters & campaigns ----------

async function saveCluster(env, id, b) {
  const name = str(b.name, 120);
  if (!name) throw bad('Name the cluster (for example, the service it covers).');
  const pillar = str(b.pillar_url, 500);
  if (pillar && !/^https?:\/\//i.test(pillar)) throw bad('Pillar URL must start with https://');
  if (id) {
    const r = await run(env, `UPDATE clusters SET name=?, pillar_url=?, keywords=?, notes=? WHERE id=?`,
      name, pillar, str(b.keywords, 2000), str(b.notes, 2000), id);
    if (!r.meta.changes) throw bad('Cluster not found', 404);
    return { ok: true, id };
  }
  const r = await run(env, `INSERT INTO clusters (name, pillar_url, keywords, notes) VALUES (?, ?, ?, ?)`,
    name, pillar, str(b.keywords, 2000), str(b.notes, 2000));
  return { ok: true, id: r.meta.last_row_id };
}

async function deleteCluster(env, id) {
  await env.DB.batch([
    env.DB.prepare(`UPDATE posts SET cluster_id=NULL WHERE cluster_id=?`).bind(id),
    env.DB.prepare(`UPDATE blog_posts SET cluster_id=NULL WHERE cluster_id=?`).bind(id),
    env.DB.prepare(`DELETE FROM clusters WHERE id=?`).bind(id),
  ]);
  return { ok: true };
}

async function saveCampaign(env, id, b) {
  const name = str(b.name, 160);
  if (!name) throw bad('Name the campaign.');
  const blogId = intOrNull(b.blog_post_id);
  if (id) {
    await run(env, `UPDATE campaigns SET name=?, blog_post_id=?, notes=? WHERE id=?`, name, blogId, str(b.notes, 2000), id);
    return { ok: true, id };
  }
  const r = await run(env, `INSERT INTO campaigns (name, blog_post_id, notes) VALUES (?, ?, ?)`, name, blogId, str(b.notes, 2000));
  return { ok: true, id: r.meta.last_row_id };
}

async function deleteCampaign(env, id) {
  await env.DB.batch([
    env.DB.prepare(`UPDATE posts SET campaign_id=NULL WHERE campaign_id=?`).bind(id),
    env.DB.prepare(`UPDATE blog_posts SET campaign_id=NULL WHERE campaign_id=?`).bind(id),
    env.DB.prepare(`DELETE FROM campaigns WHERE id=?`).bind(id),
  ]);
  return { ok: true };
}

// ---------- plan import ----------
// Lets Claude (in chat) hand over a proposed month as JSON. Everything arrives as an idea for you to approve.
// { "items": [ { "kind": "blog" | "instagram", "title": "...", "type": "carousel", "date": "2026-11-04", "time": "11:30",
//                "cluster": "Local SEO", "keyword": "...", "intent": "informational", "topic": "...", "reason": "...",
//                "campaign": "GBP guide" } ] }

async function importPlan(env, b) {
  const items = Array.isArray(b.items) ? b.items : Array.isArray(b) ? b : null;
  if (!items) throw bad('Paste JSON with an "items" list.');
  if (items.length > 200) throw bad('Import up to 200 items at a time.');
  const settings = await getSettings(env);
  const clusterIds = new Map((await all(env, `SELECT id, name FROM clusters`)).map((c) => [c.name.toLowerCase(), c.id]));
  const campaignIds = new Map((await all(env, `SELECT id, name FROM campaigns`)).map((c) => [c.name.toLowerCase(), c.id]));
  const errors = [];
  let posts = 0;
  let blogs = 0;
  let newClusters = 0;
  let newCampaigns = 0;

  const clusterId = async (name) => {
    const n = str(name, 120);
    if (!n) return null;
    if (!clusterIds.has(n.toLowerCase())) {
      const r = await run(env, `INSERT INTO clusters (name) VALUES (?)`, n);
      clusterIds.set(n.toLowerCase(), r.meta.last_row_id);
      newClusters++;
    }
    return clusterIds.get(n.toLowerCase());
  };
  const campaignId = async (name) => {
    const n = str(name, 160);
    if (!n) return null;
    if (!campaignIds.has(n.toLowerCase())) {
      const r = await run(env, `INSERT INTO campaigns (name) VALUES (?)`, n);
      campaignIds.set(n.toLowerCase(), r.meta.last_row_id);
      newCampaigns++;
    }
    return campaignIds.get(n.toLowerCase());
  };

  for (const [i, it] of items.entries()) {
    try {
      if (!it || typeof it !== 'object') throw bad('not an object');
      const title = str(it.title, 200);
      if (!title) throw bad('missing title');
      if (it.date && !isDate(it.date)) throw bad('date must be YYYY-MM-DD');
      if (it.time && !/^\d{1,2}:\d{2}$/.test(it.time)) throw bad('time must be HH:MM');
      const kind = (it.kind || '').toLowerCase();
      if (kind === 'blog') {
        const intent = INTENTS.includes(it.intent) ? it.intent : null;
        const r = await run(env,
          `INSERT INTO blog_posts (title, topic, reason, primary_keyword, intent, slug, planned_date, cluster_id, campaign_id,
                                   seo_title, meta_description, excerpt, categories, tags, body_html, has_faq, featured_alt, notes, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idea')`,
          title, str(it.topic), str(it.reason), str(it.keyword, 200), intent, slugify(it.slug || it.keyword || title),
          it.date || null, await clusterId(it.cluster), await campaignId(it.campaign),
          str(it.seo_title, 200), str(it.meta_description, 400), str(it.excerpt, 1000), str(it.categories, 300), str(it.tags, 500),
          str(cleanHtml(it.body_html), 200_000), it.has_faq ? 1 : 0, str(it.featured_alt, 500), str(it.notes, 4000));
        if (it.campaign) await run(env, `UPDATE campaigns SET blog_post_id=COALESCE(blog_post_id, ?) WHERE id=?`, r.meta.last_row_id, await campaignId(it.campaign));
        blogs++;
      } else if (kind === 'instagram' || kind === 'post' || POST_TYPES.includes(kind)) {
        const type = POST_TYPES.includes(it.type) ? it.type : POST_TYPES.includes(kind) ? kind : 'image';
        const when = it.date ? toSql(zonedToUtc(it.date, it.time || settings.default_time || '11:30', tz(env))) : null;
        await run(env,
          `INSERT INTO posts (type, title, topic, reason, primary_keyword, scheduled_at, cluster_id, campaign_id, caption, hashtags,
                              first_comment, alt_text, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idea')`,
          type, title, str(it.topic), str(it.reason), str(it.keyword, 200), when,
          await clusterId(it.cluster), await campaignId(it.campaign), str(it.caption, 5000), str(it.hashtags, 2000),
          str(it.first_comment, 2000), str(it.alt_text, 2000));
        posts++;
      } else {
        throw bad('kind must be "blog" or "instagram"');
      }
    } catch (e) {
      errors.push({ index: i, title: it?.title || '', error: e.message });
    }
  }
  return { ok: true, posts, blogs, newClusters, newCampaigns, errors };
}

// ---------- reminders (cron) ----------

async function sendPostReminder(env, p) {
  const to = env.NOTIFY_EMAIL;
  if (!to) throw bad('NOTIFY_EMAIL is not set.');
  const settings = await getSettings(env);
  const caption = fullCaption(p);
  const lines = [
    `Time to post on Instagram (@${settings.instagram_handle}).`,
    '',
    `${TYPE_LABEL[p.type]}: ${p.title}`,
    `Scheduled for ${localLabel(p.scheduled_at, env)}`,
    '',
    'Open the post page to save the media, copy the caption, and mark it posted:',
    `${env.APP_URL}/p/${p.id}`,
  ];
  if (p.type !== 'story' && caption) lines.push('', 'Caption preview:', caption.length > 400 ? caption.slice(0, 400) + '…' : caption);
  await sendEmail(env, { to, subject: `Post now: ${p.title} (${TYPE_LABEL[p.type]})`, text: lines.join('\n') });
  await log(env, { post_id: p.id, step: 'reminder_sent', detail: to });
}

async function sendBlogReminder(env, b) {
  const to = env.NOTIFY_EMAIL;
  if (!to) throw bad('NOTIFY_EMAIL is not set.');
  const text = [
    'A blog post is ready to publish on Squarespace.',
    '',
    b.title,
    `Planned for ${b.planned_date}`,
    '',
    'Open the Paste kit (every field in order, with copy buttons):',
    `${env.APP_URL}/kit/${b.id}`,
    '',
    'After it’s live, paste the URL into the kit to mark it published.',
  ].join('\n');
  await sendEmail(env, { to, subject: `Publish today: ${b.title}`, text });
  await log(env, { blog_post_id: b.id, step: 'reminder_sent', detail: to });
}

const MAX_REMINDER_ATTEMPTS = 12; // about an hour of retries at one run every 5 minutes

export async function runReminders(env) {
  const now = nowSql();
  const out = { posts: 0, blogs: 0, failed: 0 };
  const due = await all(env,
    `SELECT * FROM posts WHERE status='scheduled' AND scheduled_at <= ? ORDER BY scheduled_at LIMIT 25`, now);
  for (const p of due) {
    // Claim the post so two overlapping runs can't email twice.
    const claim = await run(env, `UPDATE posts SET attempts=attempts+1 WHERE id=? AND status='scheduled' AND attempts=?`, p.id, p.attempts);
    if (!claim.meta.changes) continue;
    try {
      await sendPostReminder(env, p);
      const next = p.publish_mode === 'manual' ? 'reminder_sent' : 'needs_manual';
      await run(env, `UPDATE posts SET status=?, reminder_sent_at=datetime('now'), error=NULL, updated_at=datetime('now') WHERE id=?`, next, p.id);
      out.posts++;
    } catch (e) {
      out.failed++;
      const giveUp = p.attempts + 1 >= MAX_REMINDER_ATTEMPTS;
      await run(env, `UPDATE posts SET error=?, status=?, updated_at=datetime('now') WHERE id=?`,
        `Reminder email failed: ${e.message}`, giveUp ? 'needs_manual' : 'scheduled', p.id);
      await log(env, { post_id: p.id, step: 'reminder_failed', ok: false, detail: e.message });
    }
  }

  const today = localDate(new Date(), tz(env));
  const blogs = await all(env,
    `SELECT * FROM blog_posts WHERE status='draft_approved' AND planned_date <= ? AND reminder_sent_at IS NULL LIMIT 10`, today);
  for (const b of blogs) {
    const claim = await run(env, `UPDATE blog_posts SET reminder_sent_at=datetime('now') WHERE id=? AND reminder_sent_at IS NULL`, b.id);
    if (!claim.meta.changes) continue;
    try {
      await sendBlogReminder(env, b);
      out.blogs++;
    } catch (e) {
      out.failed++;
      await run(env, `UPDATE blog_posts SET reminder_sent_at=NULL WHERE id=?`, b.id); // try again next run
      await log(env, { blog_post_id: b.id, step: 'reminder_failed', ok: false, detail: e.message });
    }
  }
  await setMeta(env, '_last_reminder_run', new Date().toISOString());
  return out;
}

async function testEmail(env) {
  if (!env.NOTIFY_EMAIL) throw bad('NOTIFY_EMAIL is not set in wrangler.jsonc.');
  await sendEmail(env, {
    to: env.NOTIFY_EMAIL,
    subject: 'Test: Growthopedia Content reminders work',
    text: `This is a test from ${env.APP_URL}. Post reminders will arrive like this one.`,
  });
  return { ok: true, to: env.NOTIFY_EMAIL };
}
