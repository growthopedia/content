// Time helpers. The database stores UTC as 'YYYY-MM-DD HH:MM:SS'; people think in Eastern time.

export const toSql = (d) => new Date(d).toISOString().replace('T', ' ').slice(0, 19);

export const nowSql = () => toSql(Date.now());

// Parse a stored or submitted time. Accepts ISO strings and 'YYYY-MM-DD HH:MM:SS' (treated as UTC).
export function parseUtc(s) {
  if (!s) return null;
  const str = String(s).trim();
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(str) ? str.replace(' ', 'T') + 'Z' : str;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t);
}

function parts(date, tz) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
}

// Milliseconds the zone is ahead of UTC at that instant (negative for New York).
export function tzOffsetMs(date, tz) {
  const p = parts(date, tz);
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - Math.floor(date.getTime() / 1000) * 1000;
}

// '2026-11-03', '11:30' in America/New_York -> Date (UTC instant).
export function zonedToUtc(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '09:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm || 0, 0);
  let t = guess - tzOffsetMs(new Date(guess), tz);
  t = guess - tzOffsetMs(new Date(t), tz); // second pass handles daylight-saving edges
  return new Date(t);
}

// The local calendar date ('YYYY-MM-DD') of an instant in a zone.
export function localDate(date, tz) {
  const p = parts(date, tz);
  return `${p.year}-${p.month}-${p.day}`;
}
