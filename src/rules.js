// Content rules: Instagram post checks, blog SEO / AI-search checks, schema for the Paste kit.
// Pure functions — no database, no network — so they can be tested on their own.

export const POST_TYPES = ['image', 'carousel', 'reel', 'story'];
export const TYPE_LABEL = { image: 'Single image', carousel: 'Carousel', reel: 'Reel', story: 'Story' };

const CAPTION_MAX = 2200;
const HASHTAG_MAX = 30;

export const countHashtags = (s) => ((s || '').match(/(^|\s)#[^\s#]+/g) || []).length;

// The caption exactly as it should be pasted into Instagram.
export function fullCaption(post) {
  const cap = (post.caption || '').trim();
  const tags = (post.hashtags || '').trim();
  return [cap, tags].filter(Boolean).join('\n\n');
}

// Instagram post checks. errors block draft approval; warnings are advice.
export function checkPost(post, media) {
  const errors = [];
  const warnings = [];
  const items = (media || []).filter((m) => m.kind !== 'cover');
  const imgs = items.filter((m) => m.kind === 'image');
  const vids = items.filter((m) => m.kind === 'video');
  const type = post.type;

  if (!POST_TYPES.includes(type)) errors.push('Pick a post type.');
  if (type === 'image' && !(items.length === 1 && imgs.length === 1)) errors.push('A single-image post needs exactly 1 image.');
  if (type === 'carousel' && (items.length < 2 || items.length > 10)) errors.push(`A carousel needs 2–10 images or videos (has ${items.length}).`);
  if (type === 'reel' && !(vids.length === 1 && items.length === 1)) errors.push('A Reel needs exactly 1 video.');
  // Manual Stories can have several frames (you post them one after another).
  // Automatic posting sends one frame per Story, so it needs exactly 1.
  if (type === 'story') {
    if (post.publish_mode === 'auto' && items.length !== 1) errors.push('An automatic Story needs exactly 1 image or video.');
    else if (items.length < 1 || items.length > 10) errors.push(`A Story needs 1–10 frames (has ${items.length}).`);
  }

  const caption = fullCaption(post);
  if (type !== 'story') {
    if (!(post.caption || '').trim()) errors.push('Write a caption.');
    if (caption.length > CAPTION_MAX) errors.push(`Caption plus hashtags is ${caption.length} characters; Instagram allows ${CAPTION_MAX}.`);
    const tags = countHashtags(caption);
    if (tags > HASHTAG_MAX) errors.push(`${tags} hashtags in the caption; Instagram allows ${HASHTAG_MAX}.`);
    if (countHashtags(post.first_comment) > HASHTAG_MAX) errors.push(`First comment has more than ${HASHTAG_MAX} hashtags.`);
    if (post.primary_keyword) {
      const firstLine = (post.caption || '').split('\n')[0].toLowerCase();
      if (!firstLine.includes(post.primary_keyword.toLowerCase()))
        warnings.push(`Keyword "${post.primary_keyword}" isn't in the caption's first line (Instagram search matches on it).`);
    }
  } else if ((post.caption || '').trim()) {
    warnings.push('Stories have no caption. The caption is kept for reference only.');
  }

  if (type !== 'story' && type !== 'reel' && imgs.length && !(post.alt_text || '').trim())
    warnings.push('Add alt text: it helps accessibility and Instagram/Google search.');

  for (const m of items) {
    if (!m.width || !m.height) continue;
    const r = m.width / m.height;
    const name = m.filename || `item ${m.position + 1}`;
    if ((type === 'image' || type === 'carousel') && (r < 0.8 - 0.01 || r > 1.91 + 0.01))
      warnings.push(`${name}: ${m.width}×${m.height} is outside Instagram's feed range (4:5 to 1.91:1) and will be cropped.`);
    if ((type === 'reel' || type === 'story') && (r < 0.5 || r > 0.6))
      warnings.push(`${name}: ${m.width}×${m.height} isn't 9:16 (1080×1920 is ideal).`);
    if (m.kind === 'image' && m.size > 8 * 1024 * 1024) warnings.push(`${name} is over 8 MB; Instagram's API rejects images that large.`);
  }
  if (type === 'carousel') {
    const ratios = new Set(items.filter((m) => m.width && m.height).map((m) => (m.width / m.height).toFixed(2)));
    if (ratios.size > 1) warnings.push('Carousel items have different shapes; Instagram crops them all to the first one.');
  }
  return { errors, warnings };
}

// ---------- blog ----------

const strip = (html) => (html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const words = (s) => (s ? s.split(/\s+/).filter(Boolean).length : 0);
const has = (hay, needle) => Boolean(needle) && (hay || '').toLowerCase().includes(needle.toLowerCase());

export function headings(html, level) {
  const re = new RegExp(`<h${level}[^>]*>([\\s\\S]*?)</h${level}>`, 'gi');
  return [...(html || '').matchAll(re)].map((m) => strip(m[1]));
}

function firstParagraph(html) {
  const m = (html || '').match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  return m ? strip(m[1]) : strip((html || '').split(/<h[1-6]/i)[0]);
}

export function links(html) {
  return [...(html || '').matchAll(/<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ href: m[1].trim(), text: strip(m[2]) }));
}

export function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

export function isInternal(href, siteUrl) {
  if (/^(mailto|tel|#)/i.test(href)) return false;
  if (href.startsWith('/')) return true;
  const site = hostOf(siteUrl);
  return Boolean(site) && hostOf(href) === site;
}

// Server-side safety net for stored blog HTML (the editor already cleans pastes):
// drops scripts, embeds, inline event handlers and javascript: links.
// Allowlist: only the tags Squarespace's text block uses survive, with no attributes except a safe link href.
const ALLOWED_TAGS = new Set(['p', 'h2', 'h3', 'h4', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'blockquote', 'br']);
const RENAME = { b: 'strong', i: 'em', h1: 'h2' };
const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function cleanHtml(html) {
  return (html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|template|svg|math|noscript|textarea|select)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (tag, rawName, attrs) => {
      const closing = tag.startsWith('</');
      const name = RENAME[rawName.toLowerCase()] || rawName.toLowerCase();
      if (!ALLOWED_TAGS.has(name)) return '';
      if (closing) return name === 'br' ? '' : `</${name}>`;
      if (name !== 'a') return `<${name}>`;
      const m = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
      const href = (m ? (m[1] ?? m[2] ?? m[3]) : '').replace(/&amp;/g, '&').trim();
      return /^(https?:|mailto:|tel:|\/|#)/i.test(href) && !/^\/\//.test(href) ? `<a href="${escAttr(href)}">` : '<a>';
    })
    .replace(/<(?![a-z\/])/gi, '&lt;');
}

export const slugify =(s) => (s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 75).replace(/-+$/, '');

// SEO + AI-search checklist for a blog post.
// Each check: { id, label, ok, detail, level } where level 'error' blocks approval and 'warn' is advice.
export function checkBlog(post, ctx = {}) {
  const { cluster = null, settings = {}, clashes = [] } = ctx;
  const html = post.body_html || '';
  const text = strip(html);
  const kw = (post.primary_keyword || '').trim();
  const h2s = headings(html, 2);
  const firstP = firstParagraph(html);
  const allLinks = links(html);
  const internal = allLinks.filter((l) => isInternal(l.href, settings.site_url));
  const external = allLinks.filter((l) => /^https?:/i.test(l.href) && !isInternal(l.href, settings.site_url));
  const pillar = (cluster?.pillar_url || '').trim();
  const pillarPath = pillar ? (() => { try { return new URL(pillar).pathname.replace(/\/$/, ''); } catch { return pillar; } })() : '';
  const linksPillar = Boolean(pillarPath) && internal.some((l) => {
    const p = l.href.startsWith('/') ? l.href : (() => { try { return new URL(l.href).pathname; } catch { return ''; } })();
    return p.replace(/\/$/, '') === pillarPath;
  });
  const seoTitle = (post.seo_title || '').trim();
  const meta = (post.meta_description || '').trim();
  const slug = (post.slug || '').trim();
  const fpWords = words(firstP);
  const questionH2s = h2s.filter((h) => h.trim().endsWith('?'));
  const vague = internal.filter((l) => /^(click here|here|read more|this|link|learn more)$/i.test(l.text));

  const c = [];
  const add = (id, label, ok, detail, level = 'warn') => c.push({ id, label, ok: Boolean(ok), detail, level });

  add('title', 'Title written', post.title?.trim(), '', 'error');
  add('body', 'Body written', words(text) >= 150, `${words(text)} words`, 'error');
  add('slug', 'Post URL (slug) set', slug && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug),
    slug ? (/^[a-z0-9-]+$/.test(slug) ? `/${slug}` : 'Use lowercase letters, numbers and hyphens only') : 'Missing', 'error');
  add('seo_title', 'SEO title 30–60 characters', seoTitle.length >= 30 && seoTitle.length <= 60, `${seoTitle.length} characters`,
    seoTitle ? 'warn' : 'error');
  add('meta', 'SEO description 120–155 characters', meta.length >= 120 && meta.length <= 155, `${meta.length} characters`,
    meta ? 'warn' : 'error');
  add('excerpt', 'Excerpt written', (post.excerpt || '').trim(), '', 'error');

  add('kw', 'Primary keyword chosen', kw, kw ? `"${kw}"` : 'Missing');
  if (kw) {
    add('kw_title', 'Keyword in title', has(post.title, kw) || has(seoTitle, kw), '');
    add('kw_first', 'Keyword in first paragraph', has(firstP, kw), '');
    add('kw_h2', 'Keyword in at least one H2', h2s.some((h) => has(h, kw)), '');
    add('kw_slug', 'Keyword words in the URL', kw.toLowerCase().split(/\s+/).every((w) => slug.includes(slugify(w))), '');
    add('kw_meta', 'Keyword in SEO description', has(meta, kw), '');
  }
  add('clash', 'No other post targets this keyword', !clashes.length,
    clashes.length ? `Also targeted by: ${clashes.map((x) => x.title).join(', ')}` : '');

  add('answer_first', 'Direct answer up front (first paragraph 15–60 words)', fpWords >= 15 && fpWords <= 60,
    `First paragraph is ${fpWords} words. AI answers quote short, direct openers.`);
  add('question_h2', 'At least 2 H2s phrased as questions', questionH2s.length >= 2, `${questionH2s.length} of ${h2s.length} H2s are questions`);
  add('no_h1', 'No H1 inside the body (Squarespace makes the title the H1)', !/<h1[\s>]/i.test(html), '');

  add('internal', 'At least 2 internal links', internal.length >= 2, `${internal.length} internal`);
  if (cluster) add('pillar', `Links to the pillar page (${cluster.name})`, linksPillar, pillar || 'Add the pillar URL on the Clusters tab');
  add('anchors', 'Descriptive link text (no "click here")', !vague.length, vague.length ? `${vague.length} vague link(s)` : '');
  add('sources', 'Cites at least 1 outside source', external.length >= 1, `${external.length} outside link(s)`);
  add('featured', 'Featured image with alt text', post.featured_image_key && (post.featured_alt || '').trim(),
    !post.featured_image_key ? 'No image' : !(post.featured_alt || '').trim() ? 'Missing alt text' : '');
  add('author', 'Author bio filled in (Settings)', (settings.author_bio || '').trim(), 'Experience signals help both Google and AI answers');
  if (post.has_faq) add('faq', 'FAQ has question H2s to build schema from', questionH2s.length >= 2, '');

  return c;
}

export const blockingFailures = (checks) => checks.filter((x) => !x.ok && x.level === 'error');

// FAQ pairs: each H2 ending in "?" and the text that follows it until the next heading.
export function faqPairs(html) {
  const out = [];
  const re = /<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h[1-6][\s>]|$)/gi;
  for (const m of (html || '').matchAll(re)) {
    const q = strip(m[1]);
    const a = strip(m[2]);
    if (q.endsWith('?') && a) out.push({ q, a: a.length > 1000 ? a.slice(0, 997) + '…' : a });
  }
  return out;
}

export function postUrl(post, settings) {
  const site = (settings.site_url || '').replace(/\/$/, '');
  const base = '/' + (settings.blog_path || '/blog').replace(/^\/|\/$/g, '');
  return post.published_url || (site && post.slug ? `${site}${base}/${post.slug}` : '');
}

// JSON-LD for the Paste kit: BlogPosting with author details, plus FAQPage when the post has an FAQ.
export function schemaFor(post, settings) {
  const url = postUrl(post, settings);
  const org = {
    '@type': 'Organization',
    name: settings.org_name || 'Growthopedia',
    url: settings.site_url || undefined,
    logo: settings.logo_url || undefined,
  };
  const author = {
    '@type': 'Person',
    name: settings.author_name || undefined,
    jobTitle: settings.author_title || undefined,
    url: settings.author_url || undefined,
    worksFor: { '@type': 'Organization', name: org.name },
  };
  const graph = [{
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.meta_description || post.excerpt || undefined,
    mainEntityOfPage: url || undefined,
    datePublished: post.planned_date || undefined,
    dateModified: post.planned_date || undefined,
    author,
    publisher: org,
    keywords: post.primary_keyword || undefined,
  }];
  if (post.has_faq) {
    const pairs = faqPairs(post.body_html);
    if (pairs.length) graph.push({
      '@type': 'FAQPage',
      mainEntity: pairs.map((p) => ({ '@type': 'Question', name: p.q, acceptedAnswer: { '@type': 'Answer', text: p.a } })),
    });
  }
  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2);
  return `<script type="application/ld+json">\n${json.replace(/</g, '\\u003c')}\n</script>`;
}
