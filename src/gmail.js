// Gmail: sends reminder emails from hello@growthopedia.com to you.
// Uses the same Google login (GMAIL_* secrets) as the outreach app.

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
let tokenCache = { token: null, exp: 0 };

const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });

export const gmailReady = (env) => Boolean(env.GMAIL_REFRESH_TOKEN && env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET);

async function accessToken(env) {
  if (tokenCache.token && Date.now() < tokenCache.exp - 60_000) return tokenCache.token;
  if (!gmailReady(env)) throw fail('Gmail is not connected yet. Add the GMAIL_* secrets in Cloudflare (see SETUP.md).', 503);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await r.json();
  if (!r.ok) throw fail(`Gmail sign-in failed: ${data.error_description || data.error}`, 502);
  tokenCache = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

function b64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
const b64url = (bytes) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const encodeHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(new TextEncoder().encode(s))}?=`);

export async function sendEmail(env, { to, subject, text }) {
  const token = await accessToken(env);
  const headers = [
    `From: ${encodeHeader(env.SENDER_NAME || 'Growthopedia Content')} <${env.SENDER_EMAIL}>`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  const raw = b64url(new TextEncoder().encode(`${headers.join('\r\n')}\r\n\r\n${text.replace(/\r?\n/g, '\r\n')}`));
  const r = await fetch(`${GMAIL}/messages/send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw fail(`Gmail error: ${data.error?.message || r.status}`, 502);
  return data.id;
}
