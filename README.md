# Growthopedia Content

Content calendar for @growthopedia.co on Instagram and the growthopedia.com blog. Every topic and every draft waits for your
approval. Scheduled posts email you a reminder with a mobile post page (save media, copy caption, mark posted). Blog
posts are checked against SEO and AI-search rules and get a Squarespace Paste kit.

- **App:** https://content.thecannizzos.com
- **Setup:** see [SETUP.md](SETUP.md)
- **Spec:** the "Growthopedia Content Scheduler — Build Spec" doc

| File | What it is |
|---|---|
| `src/index.js` | Worker: API, approvals, media, reminders (cron every 5 minutes) |
| `src/rules.js` | Instagram checks, blog SEO / AI-search checks, schema for the Paste kit |
| `src/ui.html` | The app: Plan, Approve, Queue, Blog, Clusters, Settings |
| `src/post.html` | Mobile post page the reminder email links to (`/p/<id>`) |
| `src/kit.html` | Squarespace Paste kit (`/kit/<id>`) |
| `src/access.js` | Cloudflare Access token check |
| `src/email.js` | Sends reminder emails (Cloudflare Email Routing) |
| `schema.sql` | Database tables (created automatically) |
| `test/` | `npm test` |

Build phases: **1 (this)** core app, calendar, approvals, manual posting · **2** Instagram auto publishing ·
**3** Claude drafting + Canva picker in the app · **4** blog drafting, campaigns, repurposing.
