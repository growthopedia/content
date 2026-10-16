// Reminder emails through Cloudflare Email Routing — the same setup the finance dashboard uses
// (Email Routing on thecannizzos.com, jen.cannizzo@growthopedia.com verified as a destination).

const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });

export const emailReady = (env) => Boolean(env.SEND_EMAIL && env.EMAIL_FROM && env.NOTIFY_EMAIL);

function b64(s) {
  let bin = '';
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}
const encodeHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

export async function sendEmail(env, { to, subject, text }) {
  if (!emailReady(env)) throw fail('Email isn’t set up: needs the SEND_EMAIL binding, EMAIL_FROM and NOTIFY_EMAIL in wrangler.jsonc.', 503);
  const { EmailMessage } = await import('cloudflare:email');
  const from = env.EMAIL_FROM;
  const addr = (from.match(/<(.+)>/) || [, from])[1].trim();
  const raw = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject.replace(/[\r\n]+/g, ' '))}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    `Message-ID: <${crypto.randomUUID()}@${addr.split('@')[1]}>`,
    `Date: ${new Date().toUTCString()}`,
    '',
    b64(text.replace(/\r?\n/g, '\r\n')).replace(/.{76}/g, '$&\r\n'),
  ].join('\r\n');
  try {
    await env.SEND_EMAIL.send(new EmailMessage(addr, to, raw));
  } catch (e) {
    throw fail(`Email failed: ${e.message || e}`, 502);
  }
  return true;
}
