// Approved blog drafts go straight to the growthopedia.com site repo (growthopedia/growthopedia, data/posts/<slug>.json).
// The site publishes a post on its planned date: the daily scheduled run rebuilds public/ and pushes.
// Needs the GITHUB_TOKEN Worker secret (fine-grained token with Contents read/write on growthopedia/growthopedia).
const REPO = 'growthopedia/growthopedia';
const BRANCH = 'main';
const SITE = 'https://www.growthopedia.com';

export const canSendToSite = (env) => Boolean(env.GITHUB_TOKEN);
export const siteUrl = (slug) => `${SITE}/blog/${slug}`;

async function gh(env, path, init = {}) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'growthopedia-content', 'content-type': 'application/json', ...(init.headers || {}) },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw Object.assign(new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 200)}`), { status: r.status });
  return r.json();
}
const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

async function putFile(env, path, content, message) {
  const cur = await gh(env, `/contents/${path}?ref=${BRANCH}`);
  return gh(env, `/contents/${path}`, { method: 'PUT', body: JSON.stringify({ message, content: b64(content), branch: BRANCH, ...(cur?.sha ? { sha: cur.sha } : {}) }) });
}

// status "published" = live on its date; "review" = taken back (changes requested, reopened or rejected).
export async function sendToSite(env, p, status, today) {
  const path = `data/posts/${p.slug}.json`;
  const post = {
    title: p.title, slug: p.slug, seo_title: p.seo_title || p.title, meta_description: p.meta_description || '', excerpt: p.excerpt || '',
    categories: p.categories || '', tags: p.tags || '', primary_keyword: p.primary_keyword || '',
    date: p.planned_date || today, status, body_html: p.body_html || '',
  };
  const verb = status === 'published' ? `Schedule blog post for ${post.date}` : 'Take back blog post';
  await putFile(env, path, JSON.stringify(post, null, 1) + '\n', `${verb}: ${p.title} (from the content planner)`);
  return siteUrl(p.slug);
}
