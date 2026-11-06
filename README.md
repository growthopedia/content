# Growthopedia Content

Content planner for the growthopedia.com blog: the same app as content.cribpicks.com. A publishing calendar (drag posts
to a new day, then save), a review queue (approve, request changes, scrap), draft previews rendered like the live site,
and topic clusters with a question wheel suggested by Claude. Approved posts go to the site repo and publish on their date.

- **App:** https://content.growthopedia.com
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
