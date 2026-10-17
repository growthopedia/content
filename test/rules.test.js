import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPost, checkBlog, faqPairs, schemaFor, slugify, cleanHtml, countHashtags, blockingFailures } from '../src/rules.js';
import { zonedToUtc, localDate, toSql } from '../src/time.js';

const img = (w, h, i = 0) => ({ kind: 'image', width: w, height: h, position: i, size: 1000, filename: `i${i}.jpg` });

test('single image needs exactly one image and a caption', () => {
  assert.equal(checkPost({ type: 'image', caption: '' }, []).errors.length, 2);
  assert.deepEqual(checkPost({ type: 'image', caption: 'Hi', alt_text: 'x' }, [img(1080, 1350)]).errors, []);
});

test('carousel needs 2-10 items and warns on mixed shapes', () => {
  assert.match(checkPost({ type: 'carousel', caption: 'x' }, [img(1080, 1350)]).errors.join(), /2–10/);
  const r = checkPost({ type: 'carousel', caption: 'x', alt_text: 'a' }, [img(1080, 1350, 0), img(1080, 1080, 1)]);
  assert.equal(r.errors.length, 0);
  assert.ok(r.warnings.some((w) => /different shapes/.test(w)));
});

test('caption and hashtag limits', () => {
  const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ');
  assert.equal(countHashtags(tags), 31);
  assert.ok(checkPost({ type: 'image', caption: 'x', hashtags: tags }, [img(1080, 1080)]).errors.some((e) => /hashtags/.test(e)));
  assert.ok(checkPost({ type: 'image', caption: 'x'.repeat(2201) }, [img(1080, 1080)]).errors.some((e) => /2200/.test(e)));
});

test('reel needs one video; story has no caption requirement', () => {
  assert.ok(checkPost({ type: 'reel', caption: 'x' }, [img(1080, 1920)]).errors.length);
  assert.equal(checkPost({ type: 'reel', caption: 'x' }, [{ kind: 'video', width: 1080, height: 1920, position: 0 }]).errors.length, 0);
  assert.equal(checkPost({ type: 'story' }, [img(1080, 1920)]).errors.length, 0);
  assert.equal(checkPost({ type: 'story', publish_mode: 'manual' }, [img(1080, 1920, 0), img(1080, 1920, 1)]).errors.length, 0);
  assert.equal(checkPost({ type: 'story', publish_mode: 'auto' }, [img(1080, 1920, 0), img(1080, 1920, 1)]).errors.length, 1);
  assert.equal(checkPost({ type: 'story' }, []).errors.length, 1);
});

test('keyword-in-first-line warning', () => {
  const r = checkPost({ type: 'image', caption: 'Hello\nlocal seo tips', primary_keyword: 'local SEO', alt_text: 'a' }, [img(1080, 1080)]);
  assert.ok(r.warnings.some((w) => /first line/.test(w)));
});

const goodBlog = {
  title: 'Google Business Profile optimization: a 2026 guide',
  primary_keyword: 'google business profile optimization',
  slug: 'google-business-profile-optimization',
  seo_title: 'Google Business Profile Optimization Guide (2026)',
  meta_description: 'Google business profile optimization in plain steps: categories, photos, reviews and posts that help local businesses show up in Maps and AI answers.',
  excerpt: 'Ten fixes that move your profile up in Maps.',
  featured_image_key: 'blog/1/x.jpg',
  featured_alt: 'A Google Business Profile on a phone',
  body_html: `<p>Google business profile optimization means filling every field, choosing exact categories, and earning steady reviews so Google trusts your listing.</p>
    <h2>What is google business profile optimization?</h2><p>${'word '.repeat(80)}</p>
    <h2>How long does it take to see results?</h2><p>${'word '.repeat(80)} <a href="/local-seo">our local SEO services</a> and <a href="https://www.growthopedia.com/blog/gbp-posts">GBP posts guide</a> per <a href="https://support.google.com/business">Google</a>.</p>`,
};

test('a well-formed blog post passes every check', () => {
  const checks = checkBlog(goodBlog, {
    cluster: { name: 'Local SEO', pillar_url: 'https://www.growthopedia.com/local-seo' },
    settings: { site_url: 'https://www.growthopedia.com', author_bio: 'Founder' },
  });
  const failing = checks.filter((c) => !c.ok);
  assert.deepEqual(failing.map((c) => c.id), []);
});

test('blog with missing fields is blocked', () => {
  const checks = checkBlog({ title: 'X', body_html: '<p>short</p>' }, { settings: {} });
  const ids = blockingFailures(checks).map((c) => c.id);
  for (const id of ['body', 'slug', 'seo_title', 'meta', 'excerpt']) assert.ok(ids.includes(id), id);
});

test('H1 in body and vague anchors are flagged', () => {
  const checks = checkBlog({ ...goodBlog, body_html: goodBlog.body_html + '<h1>Oops</h1><a href="/x">click here</a>' }, { settings: { site_url: 'https://www.growthopedia.com' } });
  assert.equal(checks.find((c) => c.id === 'no_h1').ok, false);
  assert.equal(checks.find((c) => c.id === 'anchors').ok, false);
});

test('FAQ pairs and schema', () => {
  const pairs = faqPairs(goodBlog.body_html);
  assert.equal(pairs.length, 2);
  const s = schemaFor({ ...goodBlog, has_faq: 1, planned_date: '2026-11-04' }, { site_url: 'https://www.growthopedia.com', blog_path: '/blog', author_name: 'Jen' });
  assert.match(s, /FAQPage/);
  assert.match(s, /https:\/\/www\.growthopedia\.com\/blog\/google-business-profile-optimization/);
  assert.ok(!/<\/script>[\s\S]*<\/script>/.test(s));
});

test('slugify and cleanHtml', () => {
  assert.equal(slugify('  Café & SEO: Tips!! '), 'cafe-and-seo-tips');
  const dirty = '<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><iframe src="y"></iframe>';
  const clean = cleanHtml(dirty);
  assert.ok(!/script|onclick|javascript|iframe/i.test(clean), clean);
  assert.match(clean, /<p>Hi<\/p>/);
  const tricky = cleanHtml('<img/onerror=alert(1) src=x><a href=javascript:alert(2)>x</a><a href="https://ok.com/a?b=1&amp;c=2" onclick="y">ok</a><svg onload=alert(3)></svg><b>bold</b><h1>T</h1>');
  assert.ok(!/img|onerror|javascript|onclick|svg|onload/i.test(tricky), tricky);
  assert.match(tricky, /<a href="https:\/\/ok\.com\/a\?b=1&amp;c=2">ok<\/a>/);
  assert.match(tricky, /<strong>bold<\/strong><h2>T<\/h2>/);
});

test('time zone conversion handles daylight saving', () => {
  assert.equal(toSql(zonedToUtc('2026-07-01', '11:30', 'America/New_York')), '2026-07-01 15:30:00');
  assert.equal(toSql(zonedToUtc('2026-12-01', '11:30', 'America/New_York')), '2026-12-01 16:30:00');
  assert.equal(toSql(zonedToUtc('2026-11-01', '09:00', 'America/New_York')), '2026-11-01 14:00:00'); // day DST ends
  assert.equal(localDate(new Date('2026-11-04T03:00:00Z'), 'America/New_York'), '2026-11-03');
});

