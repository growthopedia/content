// Review queue: approve, request changes or scrap, one post or several at once (same as content.cribpicks.com).
const $ = (s, el = document) => el.querySelector(s);
const msg = (t, err) => { const m = $('.gq-msg[role=status]'); if (!m) return; m.textContent = t; m.classList.toggle('err', Boolean(err)); m.hidden = false; m.scrollIntoView({ block: 'nearest' }); };
const picked = () => [...document.querySelectorAll('[data-pick]:checked')].map((x) => Number(x.closest('tr').dataset.id));
const syncBulk = () => { const b = $('.gq-bulk'); if (!b) return; const n = picked().length; b.hidden = !n; $('[data-pick-n]', b).textContent = `${n} selected`; };
const LABEL = { approve: 'Scheduled', changes: 'Changes requested', scrap: 'Scrapped' };
const CLS = { approve: 'gq-scheduled', changes: 'gq-changes', scrap: 'gq-scrapped' };
const mark = (ids, d) => {
  for (const id of ids) {
    const tr = document.querySelector(`tr[data-id="${id}"]`); if (!tr) continue;
    tr.className = CLS[d]; tr.querySelector('.gq-chip').textContent = LABEL[d];
    const sel = tr.querySelector('.gq-sel'); if (sel) sel.innerHTML = '';
    tr.querySelectorAll('[data-gq],[data-gq-open],.gq-form').forEach((x) => x.remove());
  }
  syncBulk();
};
const send = async (ids, decision, note, btn) => {
  if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Saving…'; }
  try {
    const r = await fetch('/api/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids, decision, note }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Something went wrong');
    mark(d.ids, decision);
    const verb = decision === 'approve' ? 'Approved' : decision === 'scrap' ? 'Scrapped' : 'Sent for changes';
    msg(`${verb}: ${d.count} post${d.count === 1 ? '' : 's'}.${decision === 'approve' ? ' Each publishes on its date.' : ''}${d.errors?.length ? ` Not saved: ${d.errors.join(' ')}` : ''}`, Boolean(d.errors?.length));
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = btn.dataset.label; }
  } catch (x) { msg(x.message, true); if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; } }
};
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-pick-all]')) { document.querySelectorAll('[data-pick]').forEach((x) => { x.checked = e.target.checked; }); syncBulk(); }
  if (e.target.matches('[data-pick]')) syncBulk();
});
document.addEventListener('click', async (e) => {
  const t = e.target, tr = t.closest('tr[data-id]');
  if (t.matches('[data-gq-open]') && tr) { const f = tr.querySelector(`[data-form="${t.dataset.gqOpen}"]`); tr.querySelectorAll('.gq-form').forEach((x) => { if (x !== f) x.hidden = true; }); f.hidden = !f.hidden; if (!f.hidden) f.querySelector('[data-note]')?.focus(); return; }
  if (t.matches('[data-gq]') && tr) { const d = t.dataset.gq; const note = tr.querySelector(`[data-form="${d}"] [data-note]`)?.value.trim() || ''; if (d === 'changes' && !note) { msg('Write what to change first.', true); return; } await send([Number(tr.dataset.id)], d, note, t); return; }
  if (t.matches('[data-gq-bulk]')) {
    const ids = picked(); if (!ids.length) return;
    const d = t.dataset.gqBulk;
    if (d === 'scrap' && t.dataset.sure !== '1') { t.dataset.sure = '1'; t.textContent = `Yes, scrap ${ids.length}`; return; }
    await send(ids, d, '', t);
  }
});
