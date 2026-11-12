// Client Shopify stores: approved blog posts for a store go straight to its Shopify blog, scheduled for the post's
// planned date (or live now if the date has passed). Taking a post back (changes requested, reopened, scrapped)
// hides the article again. Posts with no store go to growthopedia.com as before (site.js).
//
// Connecting a store (Stores page): name + shop address, then one of
//   - Client ID + Client secret of an app made in the Shopify Dev Dashboard (scopes read_content, write_content,
//     write_files). For a store in your own Shopify organization the app gets 24-hour tokens by itself (client
//     credentials grant). For a client's store, press "Connect with Shopify": the store owner approves the app once and
//     Shopify returns a long-lived token (authorization code grant). Redirect URL: <APP_URL>/shopify/callback
//   - or an Admin API access token (shpat_...) from an older custom app made in the store's admin.
// Tokens and secrets are encrypted in D1 with the STORE_KEY Worker secret (any long random string).
const API = '2026-07';
const SCOPES = 'read_content,write_content,write_files';

export const STORE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS stores (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, shop TEXT NOT NULL UNIQUE,
    client_id TEXT, secret_enc TEXT, token_enc TEXT, token_expires TEXT, oauth_state TEXT,
    blog_id TEXT, blog_title TEXT, blog_handle TEXT, domain TEXT, author TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
];
export const STORE_COLUMNS = [
  `ALTER TABLE blog_posts ADD COLUMN store_id INTEGER`,
  `ALTER TABLE blog_posts ADD COLUMN shopify_article_id TEXT`,
  `ALTER TABLE clusters ADD COLUMN store_id INTEGER`,
];

const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const first = (env, sql, ...p) => env.DB.prepare(sql).bind(...p).first();
const all = async (env, sql, ...p) => (await env.DB.prepare(sql).bind(...p).all()).results;
const run = (env, sql, ...p) => env.DB.prepare(sql).bind(...p).run();

// ---------- secrets ----------
async function key(env) {
  if (!env.STORE_KEY) throw fail('Add the STORE_KEY secret to the content Worker first (see the Stores page).');
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.STORE_KEY));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function enc(env, text) {
  if (!text) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), new TextEncoder().encode(text)));
  return `${b64(iv)}.${b64(ct)}`;
}
async function dec(env, s) {
  if (!s) return null;
  const [iv, ct] = s.split('.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(env), unb64(ct)));
}

export const normShop = (s) => {
  let x = String(s || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (x && !x.includes('.')) x = `${x}.myshopify.com`;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(x)) throw fail('Use the store’s myshopify.com address, e.g. acme-bakery.myshopify.com (Shopify admin → Settings → Domains).');
  return x;
};

// ---------- tokens ----------
async function token(env, s) {
  if (s.token_enc && (!s.token_expires || Date.parse(s.token_expires) > Date.now() + 60_000)) return dec(env, s.token_enc);
  if (!s.client_id || !s.secret_enc) throw fail(`${s.name} isn’t connected. Open Stores and connect it.`);
  // Client credentials: only works for stores in the same Shopify organization as the app.
  const r = await fetch(`https://${s.shop}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: s.client_id, client_secret: await dec(env, s.secret_enc) }),
  }).catch(() => { throw fail(`Couldn’t reach ${s.shop}. Check the store address.`, 502); });
  const t = await r.text();
  let d = {}; try { d = JSON.parse(t); } catch { /* text error */ }
  if (!r.ok || !d.access_token) {
    if (/shop_not_permitted/i.test(t)) throw fail(`${s.name} is outside your Shopify organization, so it needs a one-time approval: press “Connect with Shopify” on the Stores page.`, 409);
    throw fail(`Shopify didn’t give a token for ${s.name}: ${(d.error_description || d.error || t).toString().slice(0, 160)}`, 502);
  }
  const exp = new Date(Date.now() + (Number(d.expires_in) || 86399) * 1000).toISOString();
  await run(env, `UPDATE stores SET token_enc=?, token_expires=?, updated_at=datetime('now') WHERE id=?`, await enc(env, d.access_token), exp, s.id);
  return d.access_token;
}

export async function gql(env, s, query, variables = {}) {
  const r = await fetch(`https://${s.shop}/admin/api/${API}/graphql.json`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-access-token': await token(env, s) },
    body: JSON.stringify({ query, variables }),
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) throw fail(`Shopify refused the connection to ${s.name} (${r.status}). Reconnect it on the Stores page; the app needs read_content, write_content and write_files.`, 502);
  if (!r.ok || d.errors) throw fail(`Shopify: ${JSON.stringify(d.errors || d).slice(0, 220)}`, 502);
  return d.data;
}
const userErr = (x) => { const e = x?.userErrors || []; if (e.length) throw fail(`Shopify: ${e.map((u) => u.message).join('; ')}`, 502); };

// Shop name, domain and blogs: proves the connection works and fills the blog picker.
export async function shopInfo(env, s) {
  const d = await gql(env, s, `{ shop { name primaryDomain { url } } blogs(first: 25) { nodes { id title handle } } }`);
  return { name: d.shop.name, domain: d.shop.primaryDomain?.url || `https://${s.shop}`, blogs: d.blogs.nodes };
}

// ---------- store records ----------
export const listStores = (env) => all(env, `SELECT id, name, shop, client_id, blog_id, blog_title, blog_handle, domain, author, token_enc IS NOT NULL AS has_token, token_expires FROM stores ORDER BY name`);
export const getStore = (env, id) => first(env, `SELECT * FROM stores WHERE id=?`, id);

export async function saveStore(env, id, b) {
  const name = String(b.name || '').trim().slice(0, 80);
  if (!name) throw fail('Give the store a name.');
  const shop = normShop(b.shop);
  const cid = String(b.client_id || '').trim().slice(0, 100) || null;
  const secret = String(b.client_secret || '').trim();
  const tok = String(b.access_token || '').trim();
  const author = String(b.author || '').trim().slice(0, 80) || null;
  if (!id && !tok && !(cid && secret)) throw fail('Add the Client ID and Client secret, or an Admin API access token.');
  if (id) {
    const cur = await getStore(env, id);
    if (!cur) throw fail('Store not found', 404);
    await run(env, `UPDATE stores SET name=?, shop=?, client_id=COALESCE(?, client_id), secret_enc=COALESCE(?, secret_enc), token_enc=CASE WHEN ? IS NOT NULL THEN ? WHEN ? IS NOT NULL THEN NULL ELSE token_enc END, token_expires=CASE WHEN ? IS NOT NULL THEN NULL WHEN ? IS NOT NULL THEN NULL ELSE token_expires END, author=?, updated_at=datetime('now') WHERE id=?`,
      name, shop, cid, secret ? await enc(env, secret) : null, tok || null, tok ? await enc(env, tok) : null, secret || null, tok || null, secret || null, author, id);
  } else {
    const x = await run(env, `INSERT INTO stores (name, shop, client_id, secret_enc, token_enc, author) VALUES (?, ?, ?, ?, ?, ?)`, name, shop, cid, secret ? await enc(env, secret) : null, tok ? await enc(env, tok) : null, author);
    id = x.meta.last_row_id;
  }
  return testStore(env, id);
}

export async function testStore(env, id) {
  const s = await getStore(env, id);
  try {
    const info = await shopInfo(env, s);
    const pick = info.blogs.find((x) => x.id === s.blog_id) || info.blogs[0];
    await run(env, `UPDATE stores SET domain=?, blog_id=?, blog_title=?, blog_handle=?, updated_at=datetime('now') WHERE id=?`, info.domain, pick?.id || null, pick?.title || null, pick?.handle || null, id);
    return { ok: true, id, connected: true, shopName: info.name, blogs: info.blogs };
  } catch (e) {
    return { ok: true, id, connected: false, needsOauth: e.status === 409, error: e.message };
  }
}

export async function setBlog(env, id, blogId) {
  const s = await getStore(env, id);
  const info = await shopInfo(env, s);
  const b = info.blogs.find((x) => x.id === blogId);
  if (!b) throw fail('That blog isn’t on this store.');
  await run(env, `UPDATE stores SET blog_id=?, blog_title=?, blog_handle=?, updated_at=datetime('now') WHERE id=?`, b.id, b.title, b.handle, id);
  return { ok: true };
}

export async function deleteStore(env, id) {
  const live = await first(env, `SELECT COUNT(*) n FROM blog_posts WHERE store_id=? AND shopify_article_id IS NOT NULL`, id);
  await env.DB.batch([
    env.DB.prepare(`UPDATE blog_posts SET store_id=NULL WHERE store_id=? AND shopify_article_id IS NULL`).bind(id),
    env.DB.prepare(`DELETE FROM stores WHERE id=?`).bind(id),
  ]);
  return { ok: true, note: live?.n ? `${live.n} post(s) already on Shopify stay there.` : '' };
}

// ---------- OAuth (authorization code grant) for client stores outside your organization ----------
export async function oauthStart(env, id, appUrl) {
  const s = await getStore(env, id);
  if (!s?.client_id) throw fail('Add the Client ID and Client secret first.');
  const state = crypto.randomUUID();
  await run(env, `UPDATE stores SET oauth_state=? WHERE id=?`, state, id);
  const q = new URLSearchParams({ client_id: s.client_id, scope: SCOPES, redirect_uri: `${appUrl}/shopify/callback`, state });
  return `https://${s.shop}/admin/oauth/authorize?${q}`;
}
async function hmacOk(secret, params) {
  const given = params.get('hmac') || '';
  const msg = [...params.entries()].filter(([k]) => k !== 'hmac' && k !== 'signature').sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)))].map((x) => x.toString(16).padStart(2, '0')).join('');
  return sig.length === given.length && sig === given.toLowerCase();
}
export async function oauthCallback(env, url) {
  const q = url.searchParams;
  const s = await first(env, `SELECT * FROM stores WHERE oauth_state=?`, q.get('state') || '-');
  if (!s) throw fail('This Shopify approval link expired. Press “Connect with Shopify” again.');
  if (normShop(q.get('shop')) !== s.shop) throw fail('Shopify sent back a different store.');
  const secret = await dec(env, s.secret_enc);
  if (!(await hmacOk(secret, q))) throw fail('Shopify’s signature didn’t check out. Try connecting again.');
  const r = await fetch(`https://${s.shop}/admin/oauth/access_token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: s.client_id, client_secret: secret, code: q.get('code') }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw fail(`Shopify didn’t give a token: ${(d.error_description || d.error || r.status).toString().slice(0, 160)}`, 502);
  await run(env, `UPDATE stores SET token_enc=?, token_expires=NULL, oauth_state=NULL, updated_at=datetime('now') WHERE id=?`, await enc(env, d.access_token), s.id);
  await testStore(env, s.id);
  return s.id;
}

// ---------- publishing ----------
// The featured image: Shopify needs to fetch it, but this app is behind a login, so upload the bytes to Shopify Files.
async function uploadImage(env, s, p) {
  if (!p.featured_image_key || !env.MEDIA) return null;
  const obj = await env.MEDIA.get(p.featured_image_key);
  if (!obj) return null;
  const type = obj.httpMetadata?.contentType || 'image/jpeg';
  const filename = p.featured_image_key.split('/').pop();
  const st = await gql(env, s, `mutation($input:[StagedUploadInput!]!){ stagedUploadsCreate(input:$input){ stagedTargets{ url resourceUrl parameters{ name value } } userErrors{ message } } }`,
    { input: [{ filename, mimeType: type, resource: 'IMAGE', httpMethod: 'POST' }] });
  userErr(st.stagedUploadsCreate);
  const t = st.stagedUploadsCreate.stagedTargets[0];
  const form = new FormData();
  for (const x of t.parameters) form.append(x.name, x.value);
  form.append('file', new Blob([await obj.arrayBuffer()], { type }), filename);
  const up = await fetch(t.url, { method: 'POST', body: form });
  if (!up.ok) throw fail(`Image upload to Shopify failed (${up.status}).`, 502);
  const fc = await gql(env, s, `mutation($files:[FileCreateInput!]!){ fileCreate(files:$files){ files{ id ... on MediaImage { image { url } } } userErrors{ message } } }`,
    { files: [{ originalSource: t.resourceUrl, contentType: 'IMAGE', alt: p.featured_alt || p.title }] });
  userErr(fc.fileCreate);
  const fid = fc.fileCreate.files[0]?.id;
  for (let i = 0; i < 8; i++) { // Shopify processes the file for a few seconds before it has a URL
    const f = await gql(env, s, `query($id:ID!){ node(id:$id){ ... on MediaImage { fileStatus image { url } } } }`, { id: fid });
    if (f.node?.image?.url) return f.node.image.url;
    if (f.node?.fileStatus === 'FAILED') break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

// Publish (or update) the article, visible from the planned date at 9am in the app's time zone.
export async function sendToShopify(env, p, { tz = 'America/New_York', zonedToUtc } = {}) {
  const s = await getStore(env, p.store_id);
  if (!s) throw fail('The store for this post was removed. Pick another store or none.');
  if (!s.blog_id) throw fail(`${s.name} has no blog picked. Open Stores and pick one.`);
  const now = new Date();
  const when = p.planned_date && zonedToUtc ? zonedToUtc(p.planned_date, "09:00", tz) : now;
  const publishDate = (when > now ? when : now).toISOString();
  let image = null, imgNote = '';
  try { const u = await uploadImage(env, s, p); if (u) image = { url: u, altText: p.featured_alt || p.title }; } catch (e) { imgNote = ` (image skipped: ${e.message})`; }
  const article = {
    title: p.title, body: p.body_html || '', summary: p.excerpt ? `<p>${p.excerpt.replace(/</g, '&lt;')}</p>` : undefined,
    handle: p.slug || undefined, tags: String(p.tags || '').split(',').map((x) => x.trim()).filter(Boolean),
    author: { name: s.author || 'Staff' }, isPublished: true, publishDate,
    ...(image ? { image } : {}),
    metafields: [
      ...(p.seo_title ? [{ namespace: 'global', key: 'title_tag', type: 'single_line_text_field', value: p.seo_title }] : []),
      ...(p.meta_description ? [{ namespace: 'global', key: 'description_tag', type: 'single_line_text_field', value: p.meta_description }] : []),
    ],
  };
  let a;
  if (p.shopify_article_id) {
    const d = await gql(env, s, `mutation($id:ID!,$article:ArticleUpdateInput!){ articleUpdate(id:$id, article:$article){ article{ id handle } userErrors{ message } } }`, { id: p.shopify_article_id, article });
    userErr(d.articleUpdate); a = d.articleUpdate.article;
  } else {
    const d = await gql(env, s, `mutation($article:ArticleCreateInput!){ articleCreate(article:$article){ article{ id handle } userErrors{ message } } }`, { article: { ...article, blogId: s.blog_id } });
    userErr(d.articleCreate); a = d.articleCreate.article;
  }
  const url = `${(s.domain || `https://${s.shop}`).replace(/\/$/, '')}/blogs/${s.blog_handle || 'news'}/${a.handle}`;
  return { id: a.id, url, note: imgNote };
}

// Take it back: hide the article (kept in Shopify as hidden, so nothing is lost).
export async function hideOnShopify(env, p) {
  if (!p.shopify_article_id || !p.store_id) return;
  const s = await getStore(env, p.store_id);
  if (!s) return;
  const d = await gql(env, s, `mutation($id:ID!){ articleUpdate(id:$id, article:{ isPublished:false }){ article{ id } userErrors{ message } } }`, { id: p.shopify_article_id });
  userErr(d.articleUpdate);
}
