// Growthopedia Content calendar (same as content.cribpicks.com): drag posts between days or use the date picker, then save.
const D = JSON.parse(document.getElementById('ct-data').textContent);
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const items = D.items.map((x) => ({ ...x, orig: x.date }));
const byK = Object.fromEntries(items.map((x) => [x.k, x]));
const moved = () => items.filter((x) => x.date !== x.orig);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const iso = (d) => d.toISOString().slice(0, 10);
const nice = (s) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

let show = { approved: true, review: false, planned: false };
try { show = { ...show, ...JSON.parse(localStorage.getItem('ct-show') || '{}') }; } catch { /* private window */ }
for (const cb of document.querySelectorAll('[data-show]')) cb.checked = Boolean(show[cb.dataset.show]);
const group = (st) => (st === 'published' || st === 'scheduled' ? 'approved' : st === 'planned' ? 'planned' : 'review');
const visible = (x) => show[group(x.status)];
const canMove = (x) => D.canSave && x.status !== 'published';

let [vy, vm] = (/^#(\d{4})-(\d{2})$/.exec(location.hash) || [0, ...D.today.split('-')]).slice(1).map(Number);
vm -= 1;

function render() {
  $('#ct-title').textContent = `${MONTHS[vm]} ${vy}`;
  const first = new Date(Date.UTC(vy, vm, 1));
  const start = new Date(first); start.setUTCDate(1 - first.getUTCDay());
  const last = new Date(Date.UTC(vy, vm + 1, 0));
  const end = new Date(last); end.setUTCDate(last.getUTCDate() + (6 - last.getUTCDay()));
  const byDay = {};
  for (const x of items) if (visible(x)) (byDay[x.date] ||= []).push(x);
  let html = `<div class="ct-dow" aria-hidden="true">${DOW.map((d) => `<div>${d}</div>`).join('')}</div>`;
  for (let d = new Date(start); d <= end;) {
    html += '<div class="ct-week">';
    for (let i = 0; i < 7; i++, d.setUTCDate(d.getUTCDate() + 1)) {
      const day = iso(d), list = byDay[day] || [];
      const cls = ['ct-day', d.getUTCMonth() !== vm && 'other', day < D.today && 'past', day === D.today && 'today', !list.length && 'empty'].filter(Boolean).join(' ');
      html += `<div class="${cls}" data-day="${day}"><div class="ct-num"><span>${d.getUTCDate()}</span><small>${DOW[d.getUTCDay()]}</small></div>${list.map(chip).join('')}</div>`;
    }
    html += '</div>';
  }
  $('#ct-cal').innerHTML = html;
  const n = moved().length;
  $('.ct-save').hidden = !n;
  $('[data-n]').textContent = `${n} unsaved change${n === 1 ? '' : 's'}`;
}
const chip = (x) => `<button type="button" class="ct-chip st-${x.status}${canMove(x) ? '' : ' locked'}${x.date !== x.orig ? ' moved' : ''}" data-k="${esc(x.k)}"${canMove(x) ? ' draggable="true"' : ''} aria-label="${esc(x.title)}, ${esc(D.labels[x.status])}"><span>${esc(x.title)}</span><small>${esc(D.labels[x.status])}${x.menu ? ` · ${esc(x.menu)}` : ''}</small></button>`;

function msg(text, err) { const m = $('.ct-msg[role=status]'); m.textContent = text; m.className = `ct-msg${err ? ' err' : ''}`; m.hidden = !text; }

function moveTo(k, to) {
  const x = byK[k];
  if (!x || !canMove(x)) return;
  if (to < D.today) { msg('Pick today or a later day. Days that have passed can\'t take a post.', true); return; }
  x.date = to;
  msg('');
  render();
}

// Drag and drop (mouse and trackpad). Phones use the date picker in the post's details.
const cal = $('#ct-cal');
let dragK = null;
cal.addEventListener('dragstart', (e) => { const c = e.target.closest('.ct-chip[draggable]'); if (!c) return; dragK = c.dataset.k; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragK); c.classList.add('dragging'); });
cal.addEventListener('dragend', () => { dragK = null; cal.querySelectorAll('.over,.nope,.dragging').forEach((el) => el.classList.remove('over', 'nope', 'dragging')); });
cal.addEventListener('dragover', (e) => {
  const day = e.target.closest('.ct-day'); if (!day || !dragK) return;
  const ok = day.dataset.day >= D.today;
  cal.querySelectorAll('.over,.nope').forEach((el) => el !== day && el.classList.remove('over', 'nope'));
  day.classList.toggle('over', ok); day.classList.toggle('nope', !ok);
  if (ok) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
});
cal.addEventListener('drop', (e) => { const day = e.target.closest('.ct-day'); if (!day || !dragK) return; e.preventDefault(); moveTo(dragK, day.dataset.day); });

// Click a post: details, links and a date picker.
const pop = $('#ct-pop');
cal.addEventListener('click', (e) => {
  const c = e.target.closest('.ct-chip'); if (!c) return;
  const x = byK[c.dataset.k];
  $('[data-pop]', pop).innerHTML = `<h3>${esc(x.title)}</h3>
<p><span class="ct-pill st-${x.status}">${esc(D.labels[x.status])}</span>${x.menu ? ` · ${esc(x.menu)}${x.sub ? ` · ${esc(x.sub)}` : ''}` : ''}</p>
<p>${x.status === 'published' ? 'Published' : x.status === 'scheduled' ? 'Publishes' : 'Planned for'} ${esc(nice(x.date))}${x.status !== 'published' && x.date < D.today ? ' (date has passed)' : ''}${x.date !== x.orig ? ` <small>(was ${esc(nice(x.orig))}, not saved yet)</small>` : ''}</p>
<div class="ct-acts">${x.preview ? `<a class="btn btn-sm" href="${esc(x.preview)}" target="_blank" rel="noopener">Preview</a>` : ''}${x.live ? `<a class="btn btn-sm btn-ghost" href="${esc(x.live)}" target="_blank" rel="noopener">View on the site</a>` : ''}${x.status === 'review' || x.status === 'changes' ? '<a class="btn btn-sm btn-ghost" href="/review/">Review queue</a>' : ''}</div>
${canMove(x) ? `<label>Move to<span class="ct-row"><input type="date" min="${D.today}" value="${x.date}" data-to><button type="button" class="btn btn-sm" data-move="${esc(x.k)}">Move</button></span></label>` : `<p class="small muted">${x.status === 'published' ? 'Published posts keep their date.' : 'This post can\'t be moved.'}</p>`}`;
  pop.showModal();
});
pop.addEventListener('click', (e) => {
  if (e.target === pop) { pop.close(); return; }
  const b = e.target.closest('[data-move]'); if (!b) return;
  const to = $('[data-to]', pop).value;
  if (!to) return;
  pop.close();
  moveTo(b.dataset.move, to);
  const [y, mo] = to.split('-').map(Number);
  if (y !== vy || mo - 1 !== vm) { vy = y; vm = mo - 1; render(); }
});

document.addEventListener('click', (e) => {
  const n = e.target.closest('[data-nav]');
  if (n) {
    const step = Number(n.dataset.nav);
    if (step === 0) [vy, vm] = [Number(D.today.slice(0, 4)), Number(D.today.slice(5, 7)) - 1];
    else { vm += step; if (vm < 0) { vm = 11; vy--; } if (vm > 11) { vm = 0; vy++; } }
    history.replaceState(null, '', `#${vy}-${String(vm + 1).padStart(2, '0')}`);
    render();
  }
  if (e.target.closest('[data-undo]')) { for (const x of items) x.date = x.orig; msg(''); render(); }
  if (e.target.closest('[data-save]')) save(e.target.closest('[data-save]'));
});
document.addEventListener('change', (e) => {
  const cb = e.target.closest('[data-show]'); if (!cb) return;
  show[cb.dataset.show] = cb.checked;
  try { localStorage.setItem('ct-show', JSON.stringify(show)); } catch { /* private window */ }
  render();
});

async function save(btn) {
  const moves = moved().map((x) => ({ k: x.k, to: x.date }));
  if (!moves.length) return;
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const r = await fetch('/api/move', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nb': '1' }, body: JSON.stringify({ moves }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
    for (const x of items) x.orig = x.date;
    msg(`Saved ${d.count} change${d.count === 1 ? '' : 's'}.${d.site ? ' Approved posts publish on their new date with the site\'s daily update.' : ''}`);
  } catch (err) { msg(err.message, true); }
  btn.disabled = false; btn.textContent = 'Save changes';
  render();
}
window.addEventListener('beforeunload', (e) => { if (moved().length) { e.preventDefault(); e.returnValue = ''; } });
render();
