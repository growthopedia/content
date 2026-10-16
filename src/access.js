// Cloudflare Access sign-in check.
// When ACCESS_TEAM_DOMAIN and ACCESS_AUD are set (SETUP.md step 5), every request must carry a valid,
// signed Access token — a forged email header alone is rejected. Without them, the app trusts the
// email header Access adds, the same as the outreach app.

let certCache = { team: null, keys: null, exp: 0 };

const b64urlToBytes = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const decodeJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function certs(team) {
  if (certCache.team === team && certCache.keys && Date.now() < certCache.exp) return certCache.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error(`Access certs ${r.status}`);
  const data = await r.json();
  certCache = { team, keys: data.keys || [], exp: Date.now() + 3600_000 };
  return certCache.keys;
}

async function verifyJwt(token, team, aud) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try { header = decodeJson(parts[0]); payload = decodeJson(parts[1]); } catch { return null; }
  if (header.alg !== 'RS256') return null;
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) return null;
  if (payload.nbf && payload.nbf > now + 60) return null;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return null;
  const jwk = (await certs(team)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  return ok ? payload : null;
}

export async function signedInEmail(request, env) {
  const team = (env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
  const aud = (env.ACCESS_AUD || '').trim();
  if (team && aud) {
    const payload = await verifyJwt(request.headers.get('cf-access-jwt-assertion'), team, aud).catch(() => null);
    return payload ? String(payload.email || payload.common_name || 'service').toLowerCase() : null;
  }
  return (request.headers.get('cf-access-authenticated-user-email') || '').toLowerCase() || null;
}
