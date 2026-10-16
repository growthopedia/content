# Setup

The app lives at **https://content.thecannizzos.com**, behind your Cloudflare Access login.
Every push to `main` redeploys it through Cloudflare Workers Builds.

Already done: the `content` Worker, the content.thecannizzos.com domain, and the D1 database (its ID is in `wrangler.jsonc`).

---

## 1. Media storage (R2)
Images and videos for posts are stored in R2.

1. Cloudflare dashboard → **R2 Object Storage** → **Create bucket**.
2. Name it exactly `content-media`. Location: Automatic. → **Create bucket**.

If Cloudflare asks you to turn on R2 first, it may ask for a payment method. Check the current free allowance on the R2 page; a feed's worth of images stays small.

## 2. Connect the GitHub repo (automatic deploys)
1. Cloudflare → **Workers & Pages** → `content` → **Settings** → **Build** → **Connect**.
2. Pick GitHub → `growthopedia/content` → branch `main`.
3. Build command: leave empty. Deploy command: `npx wrangler deploy`.
4. Save. The first deploy starts on its own. When it finishes, the workers.dev address is switched off, so the app is only reachable at content.thecannizzos.com.

## 3. Reminder emails
Nothing to do. Reminders go through Cloudflare Email Routing on thecannizzos.com, the same setup the finance dashboard
uses: from content@thecannizzos.com to jen.cannizzo@growthopedia.com (already a verified address).
Check it: open the app → **Settings** → **Send a test reminder**.

## 4. Login wall (Cloudflare Access)
If content.thecannizzos.com isn't already covered by an Access policy:

1. Cloudflare → **Zero Trust** → **Access** → **Applications** → **Add an application** → **Self-hosted**.
2. Name: `Growthopedia Content`. Domain: `content.thecannizzos.com`.
3. Policy: Allow → Include → **Emails** → your email address(es).
4. Save.

Visit https://content.thecannizzos.com in a private window. You should see the Cloudflare login before the app.

## 5. Lock it to signed-in requests (recommended)
This makes the app check Access's signed token on every request, so nothing can get in by faking a header.

1. Zero Trust → **Access** → **Applications** → `Growthopedia Content` → **Overview**: copy the **Application Audience (AUD) Tag**.
2. Send it to Claude, or put it in `wrangler.jsonc` under `ACCESS_AUD` and push. The team domain
   (`growthopedia.cloudflareaccess.com`) is already filled in. Values must go in `wrangler.jsonc`: each deploy
   replaces variables set only in the dashboard. Secrets such as `ANTHROPIC_API_KEY` are kept.

## 6. First run
Open the app:
- **Settings**: author bio, brand voice, default posting days and time. The author bio feeds the experience signals in every blog post.
- **Clusters**: one per service, each with its pillar page URL on growthopedia.com.
- **Plan** → **Import plan**: paste the month plan Claude drafts for you, or add posts one at a time.

---

## How a post moves
Idea → **you approve the topic** → draft (media + caption, or blog body) → **you approve the draft** → scheduled →
email reminder at the time → you post from your phone using the post page → **Mark as posted**.
Changing an approved post's caption, hashtags, alt text, type or media sends it back for approval.

## Limits to know
- Uploads must be under 100 MB each (Cloudflare's request limit).
- Instagram auto publishing (Phase 2) and the Canva picker and Claude drafting inside the app (Phase 3) aren't built yet.
- Squarespace has no blog API, so blog posts are always pasted in by hand from the Paste kit.
