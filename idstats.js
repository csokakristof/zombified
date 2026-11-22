(function () {
  'use strict';
  const idView = document.getElementById('v-id');
  const stats = idView && idView.querySelector('.stats');
  if (!stats) return;
  const dash = document.getElementById('v-dashboard');

  // A wall.js és a missions.js által beszúrt, késve töltődő sorok cseréje
  ['i-wins', 'i-miss'].forEach((id) => {
    const b = document.getElementById(id);
    if (b && b.parentElement) b.parentElement.remove();
  });

  function addRow(label, id) {
    const r = document.createElement('div');
    r.className = 'stat';
    const s = document.createElement('span');
    s.textContent = label;
    const i = document.createElement('i');
    const b = document.createElement('b');
    b.id = id;
    b.textContent = '—';
    r.append(s, i, b);
    stats.appendChild(r);
    return b;
  }
  const winsEl = addRow('Z! OF THE WEEK', 's-wins');
  const missEl = addRow('MISS!ONS', 's-miss');

  const C = { wins: null, done: null, total: null, at: 0, pending: null };

  function paint() {
    winsEl.textContent = C.wins == null ? '—' : C.wins + '×';
    missEl.textContent = C.total == null ? '—' : C.done + '/' + C.total;
  }

  async function api(path) {
    const r = await fetch('/api/network/' + path, { credentials: 'same-origin' });
    let data = {};
    try { data = await r.json(); } catch (e) {}
    return { ok: r.ok, data };
  }

  function refresh() {
    if (C.pending) return C.pending;
    C.pending = (async () => {
      const [w, m] = await Promise.all([api('wall/mystats'), api('missions/list')]);
      if (w.ok) C.wins = w.data.wins;
      if (m.ok) {
        C.total = m.data.items.length;
        C.done = m.data.items.filter((x) => x.state === 'done').length;
      }
      C.at = Date.now();
      paint();
    })().finally(() => { C.pending = null; });
    return C.pending;
  }

  function watch(el, fn) {
    if (!el) return;
    new MutationObserver(() => { if (el.classList.contains('on')) fn(); })
      .observe(el, { attributes: true, attributeFilter: ['class'] });
    if (el.classList.contains('on')) fn();
  }

  // A dashboard megjelenésekor a háttérben előre betöltjük a számokat
  watch(dash, () => { if (Date.now() - C.at > 30000) refresh(); });

  // A kártya megnyitásakor azonnal a legutóbbi érték látszik, és csendben frissül
  watch(idView, () => { paint(); refresh(); });

  // Kijelentkezéskor vagy belépés előtt a megjegyzett értékek törlődnek
  const reset = () => { C.wins = C.done = C.total = null; C.at = 0; paint(); };
  watch(document.getElementById('v-landing'), reset);
  watch(document.getElementById('v-login'), reset);
})();
