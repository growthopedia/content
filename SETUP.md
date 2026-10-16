# Setup

The app lives at **https://content.thecannizzos.com**, behind your Cloudflare Access login.
Every push to `main` redeploys it through Cloudflare Workers Builds, the same way as the outreach app.

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

## 3. Reminder emails (Gmail)
Reminders come from hello@growthopedia.com to jen.cannizzo@growthopedia.com, using the same Google login as the outreach app.
Cloudflare hides secret values after they're saved, so make a fresh token. In Terminal:

```
cd ~/outreach
git pull
python3 tools/get_gmail_token.py PASTE_CLIENT_ID PASTE_CLIENT_SECRET
```

The Client ID and Client secret are in console.cloud.google.com → APIs & Services → Credentials → the OAuth client you made for outreach.
A browser opens. Sign in as **hello@growthopedia.com** and allow. Terminal prints the token. The outreach app keeps working with its own token.

Then Cloudflare → Workers & Pages → `content` → **Settings** → **Variables and Secrets** → **Add**, type **Secret**, three times:

| Name | Value |
|---|---|
| `GMAIL_CLIENT_ID` | Client ID |
| `GMAIL_CLIENT_SECRET` | Client secret |
| `GMAIL_REFRESH_TOKEN` | the token Terminal printed |

Check it: open the app → **Settings** → **Send a test reminder**.

## 4. Login wall (Cloudflare Access)
If content.thecannizzos.com isn't already covered by an Access policy:

1. Cloudflare → **Zero Trust** → **Access** → **Applications** → **Add an application** → **Self-hosted**.
2. Name: `Growthopedia Content`. Domain: `content.thecannizzos.com`.
3. Policy: Allow → Include → **Emails** → your email address(es). Same as the outreach app.
4. Save.

Visit https://content.thecannizzos.com in a private window. You should see the Cloudflare login before the app.

## 5. Lock it to signed-in requests (recommended)
This makes the app check Access's signed token on every request, so nothing can get in by faking a header.

1. Zero Trust → **Access** → **Applications** → `Growthopedia Content` → **Overview**: copy the **Application Audience (AUD) Tag**.
2. Zero Trust → **Settings** → **Custom Pages** (or Team & Resources): your team domain looks like `yourteam.cloudflareaccess.com`.
3. Send both to Claude, or put them in `wrangler.jsonc` under `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` and push.
   They must go in `wrangler.jsonc`. Each deploy replaces variables set only in the dashboard.

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
