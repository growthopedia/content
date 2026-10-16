-- One-time starter content: topic clusters from growthopedia.com's services and a brand voice drawn from the site.
-- Runs once (guarded by the _seed_v1 marker). Only fills settings that are still blank, so nothing you typed is overwritten.
-- Edit everything afterwards on the Clusters and Settings tabs.

INSERT INTO clusters (name, pillar_url, keywords)
SELECT 'SEO Services', 'https://www.growthopedia.com/seo-services', 'seo services albany ny, technical seo, on-page seo, keyword research, ecommerce seo, off-page seo'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = '_seed_v1') AND NOT EXISTS (SELECT 1 FROM clusters WHERE lower(name) = 'seo services');

INSERT INTO clusters (name, pillar_url, keywords)
SELECT 'Local SEO', 'https://www.growthopedia.com/local-seo', 'local seo albany, google business profile optimization, citation management, review management, local link building, location pages'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = '_seed_v1') AND NOT EXISTS (SELECT 1 FROM clusters WHERE lower(name) = 'local seo');

INSERT INTO clusters (name, pillar_url, keywords)
SELECT 'Generative Engine Optimization', 'https://www.growthopedia.com/generative-engine-optimization', 'generative engine optimization, ai search optimization, google ai overviews, chatgpt citations, llm visibility, schema markup, content structure for ai'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = '_seed_v1') AND NOT EXISTS (SELECT 1 FROM clusters WHERE lower(name) = 'generative engine optimization');

INSERT INTO clusters (name, pillar_url, keywords)
SELECT 'SEO & UX Audits', 'https://www.growthopedia.com/audits', 'technical seo audit, backlink audit, e-e-a-t audit, ai citation audit, keyword gap analysis, cro audit'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = '_seed_v1') AND NOT EXISTS (SELECT 1 FROM clusters WHERE lower(name) = 'seo & ux audits');

INSERT INTO clusters (name, pillar_url, keywords)
SELECT 'Content Marketing', 'https://www.growthopedia.com/content-marketing', 'content marketing strategy, blog writing services, editorial calendar, content for seo'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = '_seed_v1') AND NOT EXISTS (SELECT 1 FROM clusters WHERE lower(name) = 'content marketing');

INSERT INTO clusters (name, pillar_url, keywords)
SELECT 'Conversion Optimization', 'https://www.growthopedia.com/cro-services', 'conversion rate optimization, a/b testing, landing page optimization, form optimization, ux optimization'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = '_seed_v1') AND NOT EXISTS (SELECT 1 FROM clusters WHERE lower(name) = 'conversion optimization');

INSERT INTO clusters (name, pillar_url, keywords)
SELECT 'Website Development', 'https://www.growthopedia.com/website-development', 'squarespace seo, website redesign seo, website migration seo, page speed optimization, ux ui web design'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = '_seed_v1') AND NOT EXISTS (SELECT 1 FROM clusters WHERE lower(name) = 'website development');

INSERT INTO clusters (name, pillar_url, keywords)
SELECT 'White-Label Marketing', 'https://www.growthopedia.com/white-label-marketing', 'white label seo, seo outsourcing for agencies, white label geo, agency fulfillment partner'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = '_seed_v1') AND NOT EXISTS (SELECT 1 FROM clusters WHERE lower(name) = 'white-label marketing');

INSERT INTO settings (key, value)
SELECT 'audience', 'Capital Region small and mid-size businesses that want to be found on Google, in Maps and in AI answers, growing brands that need SEO done properly, and marketing agencies that need white-label SEO and GEO they can resell.'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = '_seed_v1')
ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value IS NULL OR trim(settings.value) = '';

INSERT INTO settings (key, value)
SELECT 'tone', 'Plain-spoken expert. Lead with the answer, then explain. Specific over clever: steps, numbers, real examples from client work (no client names without permission). Confident without hype. Short sentences. Talk to one business owner as you. Write as Jen in first person on Instagram and as Growthopedia (we) on the blog. A little warmth, no fluff.'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = '_seed_v1')
ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value IS NULL OR trim(settings.value) = '';

INSERT INTO settings (key, value)
SELECT 'avoid', 'Guaranteed rankings or #1 on Google. Skyrocket, game-changer, unlock, supercharge, synergy, cutting-edge. Results claims without a number or source. Jargon without a one-line explanation (spell out GEO, E-E-A-T, CRO on first use). Fear-based urgency. Emojis in blog posts.'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = '_seed_v1')
ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value IS NULL OR trim(settings.value) = '';

INSERT INTO settings (key, value)
SELECT 'cta', 'Book a free call at growthopedia.com/contact. No pitch, no commitment.'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = '_seed_v1')
ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value IS NULL OR trim(settings.value) = '';

INSERT INTO settings (key, value)
SELECT 'link_in_bio', 'Full guide at the link in bio.'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = '_seed_v1')
ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value IS NULL OR trim(settings.value) = '';

INSERT INTO settings (key, value)
SELECT 'author_url', 'https://www.growthopedia.com/about'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = '_seed_v1')
ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value IS NULL OR trim(settings.value) = '';

INSERT INTO settings (key, value)
SELECT 'author_bio', 'Jen Cannizzo is the founder of Growthopedia, an Albany, NY SEO and digital marketing agency. Before starting Growthopedia she worked at DEPT, a global digital agency. She leads SEO, generative engine optimization (GEO) and content strategy for local businesses, national brands and agency partners, and builds SEO-ready Squarespace sites.'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = '_seed_v1')
ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value IS NULL OR trim(settings.value) = '';

INSERT OR IGNORE INTO settings (key, value) VALUES ('_seed_v1', datetime('now'));
