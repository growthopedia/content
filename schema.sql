-- Content planner database. The Worker runs this automatically (CREATE ... IF NOT EXISTS),
-- so you never need to run it by hand. Times are stored in UTC as 'YYYY-MM-DD HH:MM:SS'.

-- Pillar pages. Each one anchors a topic cluster.
CREATE TABLE IF NOT EXISTS clusters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                            -- e.g. "Local SEO"
  pillar_url TEXT,                               -- the pillar page on growthopedia.com
  keywords TEXT,                                 -- comma-separated target keywords for the cluster
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A blog post plus the Instagram posts that promote it.
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  blog_post_id INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Instagram posts.
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER,
  cluster_id INTEGER,
  type TEXT NOT NULL DEFAULT 'image',            -- image | carousel | reel | story
  title TEXT NOT NULL,                           -- working title (internal only)
  topic TEXT,                                    -- what the post is about / the angle
  reason TEXT,                                   -- why this topic was picked
  primary_keyword TEXT,
  caption TEXT,
  hashtags TEXT,                                 -- space-separated, e.g. "#seo #localseo"
  first_comment TEXT,
  alt_text TEXT,
  scheduled_at TEXT,                             -- planned/scheduled time (UTC)
  publish_mode TEXT NOT NULL DEFAULT 'manual',   -- manual | auto (auto arrives with Instagram publishing)
  status TEXT NOT NULL DEFAULT 'idea',
  -- idea -> topic_approved -> drafted -> draft_approved -> scheduled -> reminder_sent -> published
  -- side exits: rejected, on_hold, needs_manual, failed, changes_requested (you asked for edits)
  topic_approved_at TEXT,
  draft_approved_at TEXT,
  rejection_reason TEXT,
  change_note TEXT,                              -- what you asked to change
  reminder_sent_at TEXT,
  published_at TEXT,
  ig_media_id TEXT,
  ig_permalink TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS posts_when ON posts(scheduled_at);

-- Files attached to a post, in order. The files themselves live in R2.
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT,
  kind TEXT NOT NULL DEFAULT 'image',            -- image | video | cover
  content_type TEXT,
  size INTEGER,
  width INTEGER,
  height INTEGER,
  duration_s REAL,
  source TEXT NOT NULL DEFAULT 'upload',         -- upload | canva_chat | canva_api
  canva_design_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS media_post ON media(post_id, position);

-- Blog posts (pasted into Squarespace by hand from the Paste kit).
CREATE TABLE IF NOT EXISTS blog_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER,
  cluster_id INTEGER,
  title TEXT NOT NULL,
  topic TEXT,
  reason TEXT,
  primary_keyword TEXT,
  intent TEXT,                                   -- informational | commercial | transactional | navigational
  slug TEXT,
  seo_title TEXT,
  meta_description TEXT,
  excerpt TEXT,
  categories TEXT,
  tags TEXT,
  body_html TEXT,
  has_faq INTEGER NOT NULL DEFAULT 0,            -- 1 = add FAQ schema built from question H2s
  featured_image_key TEXT,
  featured_alt TEXT,
  planned_date TEXT,                             -- YYYY-MM-DD (local date you plan to publish)
  status TEXT NOT NULL DEFAULT 'idea',
  -- idea -> topic_approved -> drafted -> draft_approved -> published ; side exits: rejected, on_hold
  topic_approved_at TEXT,
  draft_approved_at TEXT,
  rejection_reason TEXT,
  change_note TEXT,
  reminder_sent_at TEXT,
  published_url TEXT,
  published_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS blog_status ON blog_posts(status);

-- OAuth tokens for Instagram and Canva (used from Phase 2 on).
CREATE TABLE IF NOT EXISTS tokens (
  provider TEXT PRIMARY KEY,                     -- instagram | canva
  access_token TEXT,
  refresh_token TEXT,
  expires_at TEXT,
  meta TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every publish or reminder attempt, for debugging.
CREATE TABLE IF NOT EXISTS publish_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER,
  blog_post_id INTEGER,
  step TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 1,
  detail TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- App settings edited on the Settings screen (brand voice, author, posting slots...).
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
