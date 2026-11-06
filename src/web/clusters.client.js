// Clusters: add / edit / delete clusters, and the question wheel (Claude-suggested searches around a cluster).
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (path, method, body) => {
  const r = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong');
  return d;
};
const msg = (t, err) => { const m = $('.gq-msg[role=status]'); if (!m) { if (err) alert(t); return; } m.textContent = t; m.classList.toggle('err', Boolean(err)); m.hidden = !t; };

// Cluster forms (new on the list page, edit on a cluster page).
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-cluster-form]'); if (!f) return;
  e.preventDefault();
  const id = f.dataset.clusterForm, b = Object.fromEntries(new FormData(f));
  try { const d = await api(id ? `/api/clusters/${id}` : '/api/clusters', 'POST', b); location.href = `/clusters/${id || d.id}/`; } catch (x) { msg(x.message, true); }
});
document.addEventListener('click', async (e) => {
  const del = e.target.closest('[data-cluster-delete]'); if (!del) return;
  const f = del.closest('[data-cluster-form]');
  if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = 'Yes, delete it (its posts stay)'; return; }
  try { await api(`/api/clusters/${f.dataset.clusterForm}`, 'DELETE'); location.href = '/clusters/'; } catch (x) { msg(x.message, true); }
});

// ---------- question wheel ----------
const dataEl = document.getElementById('qw-data');
if (dataEl) {
  const D = JSON.parse(dataEl.textContent);
  const GROUPS = [['questions', 'Questions'], ['prepositions', 'Prepositions'], ['comparisons', 'Comparisons']];
  const COLORS = ['#1f3a2b', '#d9a12f', '#d46a4c', '#6f7f64', '#3f6f8f', '#c9736b', '#7a5a12', '#2c4d3a', '#9a3f25', '#5f8a55'];
  const added = new Set(D.existing || []);
  let view = 'wheel', group = 'questions';
  const box = $('#qw'), tabs = $('.qw-tabs');

  const items = (g) => Object.entries(D.wheel?.[g] || {}).filter(([, L]) => L.length);
  const btnAdd = (q) => `<button type="button" class="qw-add" data-add="${esc(q)}"${added.has(q.toLowerCase()) ? ' disabled>Added' : '>+ Idea'}</button>`;

  function wheelSvg(g) {
    const groups = items(g);
    const total = groups.reduce((a, [, L]) => a + L.length, 0);
    if (!total) return '<p class="muted">Nothing in this group.</p>';
    const S = 1200, C = S / 2, gap = 0.6, slots = total + groups.length * gap;
    let k = 0, out = '';
    const pt = (r, a) => [C + r * Math.cos(a), C + r * Math.sin(a)];
    groups.forEach(([word, L], gi) => {
      const col = COLORS[gi % COLORS.length];
      const a0 = ((k + gap / 2) / slots) * 2 * Math.PI - Math.PI / 2;
      const angs = L.map((_, i) => ((k + gap / 2 + i + 0.5) / slots) * 2 * Math.PI - Math.PI / 2);
      const mid = (angs[0] + angs[angs.length - 1]) / 2;
      const [hx, hy] = pt(190, mid);
      out += `<line x1="${C}" y1="${C}" x2="${hx}" y2="${hy}" stroke="${col}" stroke-width="2" opacity=".55"/>`;
      L.forEach((q, i) => {
        const a = angs[i], [x1, y1] = pt(232, a), [tx, ty] = pt(246, a);
        const deg = (a * 180) / Math.PI, left = Math.cos(a) < 0;
        out += `<path d="M${hx} ${hy} Q${pt(212, a).join(' ')} ${x1} ${y1}" fill="none" stroke="${col}" stroke-width="1.5" opacity=".45"/>`;
        out += `<g class="q" data-add-wheel="${esc(q)}" tabindex="0" role="button" aria-label="Add as a blog idea: ${esc(q)}"><circle cx="${x1}" cy="${y1}" r="4" fill="${col}"/><text x="${tx}" y="${ty}" font-size="15" fill="#1d2a22" dominant-baseline="middle" text-anchor="${left ? 'end' : 'start'}" transform="rotate(${left ? deg + 180 : deg} ${tx} ${ty})">${esc(q.length > 58 ? q.slice(0, 56) + '…' : q)}${added.has(q.toLowerCase()) ? ' ✓' : ''}</text></g>`;
      });
      out += `<g><circle cx="${hx}" cy="${hy}" r="34" fill="${col}"/><text x="${hx}" y="${hy}" font-size="15" font-weight="800" fill="#fffdf8" text-anchor="middle" dominant-baseline="middle">${esc(word)}</text></g>`;
      k += L.length + gap;
      void a0;
    });
    const seed = D.wheel.seed || D.seed;
    out += `<circle cx="${C}" cy="${C}" r="98" fill="#f3df9a" stroke="#1f3a2b" stroke-width="3"/><text x="${C}" y="${C}" font-family="Young Serif, Georgia, serif" font-size="${seed.length > 18 ? 18 : 22}" fill="#1d2a22" text-anchor="middle" dominant-baseline="middle">${esc(seed)}</text>`;
    return `<svg viewBox="0 0 ${S} ${S}" role="img" aria-label="Question wheel for ${esc(seed)}">${out}</svg>`;
  }
  function listHtml(g) {
    const groups = items(g);
    if (!groups.length) return '<p class="muted">Nothing in this group.</p>';
    return `<div class="qw-list">${groups.map(([word, L]) => `<section class="qw-group"><h3>${esc(word)}</h3><ul>${L.map((q) => `<li><span>${esc(q)}</span>${btnAdd(q)}</li>`).join('')}</ul></section>`).join('')}</div>`;
  }
  function render() {
    if (!D.wheel) {
      tabs.innerHTML = '';
      box.innerHTML = `<div class="qw-empty"><h2 style="margin-top:0">No questions yet</h2><p class="muted">${D.hasKey ? 'Generate questions for this cluster. Claude reads the cluster’s keywords and its posts.' : 'Add the ANTHROPIC_API_KEY secret to the content Worker to generate questions.'}</p></div>`;
      return;
    }
    tabs.innerHTML = GROUPS.map(([g, l]) => `<button type="button" data-group="${g}" aria-pressed="${g === group}">${l} <small>${items(g).reduce((a, [, L]) => a + L.length, 0)}</small></button>`).join('');
    box.innerHTML = `${view === 'wheel' ? `<div class="qw-wheel">${wheelSvg(group)}</div><p class="small muted">Click a question to add it as a blog idea.</p>` : listHtml(group)}<p class="small muted">Suggested by Claude${D.made ? ` on ${esc(D.made.slice(0, 10))}` : ''}. Not search volume data.</p>`;
  }
  const addIdea = async (q, el) => {
    if (added.has(q.toLowerCase())) return;
    try { const d = await api('/api/ideas', 'POST', { title: q, cluster_id: D.id }); added.add(q.toLowerCase()); msg(d.existed ? `"${q}" is already in the planner.` : `Added "${q}" as a blog idea.`); render(); } catch (x) { msg(x.message, true); }
    void el;
  };
  document.addEventListener('click', async (e) => {
    const v = e.target.closest('[data-view]'); if (v) { view = v.dataset.view; document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b === v))); render(); return; }
    const g = e.target.closest('[data-group]'); if (g) { group = g.dataset.group; render(); return; }
    const a = e.target.closest('[data-add]'); if (a) { addIdea(a.dataset.add, a); return; }
    const w = e.target.closest('[data-add-wheel]'); if (w) { addIdea(w.dataset.addWheel, w); return; }
    if (e.target.closest('[data-csv]')) {
      if (!D.wheel) return;
      const rows = [['group', 'word', 'search']];
      for (const [gk] of GROUPS) for (const [word, L] of items(gk)) for (const q of L) rows.push([gk, word, q]);
      const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const u = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      Object.assign(document.createElement('a'), { href: u, download: `${(D.wheel.seed || 'questions').replace(/\W+/g, '-')}.csv` }).click();
      setTimeout(() => URL.revokeObjectURL(u), 1000);
      return;
    }
    const gen = e.target.closest('[data-generate]');
    if (gen) {
      gen.disabled = true; const t = gen.textContent; gen.textContent = 'Asking Claude…'; msg('');
      try { const d = await api(`/api/clusters/${D.id}/questions`, 'POST', {}); D.wheel = d.wheel; D.made = new Date().toISOString(); msg(`${d.total} questions ready.`); render(); gen.textContent = 'Regenerate'; }
      catch (x) { msg(x.message, true); gen.textContent = t; }
      gen.disabled = false;
    }
  });
  document.addEventListener('keydown', (e) => { const w = e.target.closest?.('[data-add-wheel]'); if (w && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); addIdea(w.dataset.addWheel, w); } });
  render();
}
