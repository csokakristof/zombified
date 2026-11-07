(function () {
  'use strict';
  const app = document.getElementById('app');
  if (!app) return;

  const WHY = { inappropriate: 'Nem megfelelő', not_mine: 'Nem a sajátja', spam: 'Spam', other: 'Egyéb' };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  async function api(path, opt) {
    const r = await fetch('/api/network/' + path, { credentials: 'same-origin', ...(opt || {}) });
    let data = {};
    try { data = await r.json(); } catch (e) {}
    return { ok: r.ok, status: r.status, data };
  }
  const postJson = (path, body) => api(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  async function act(path, postId, confirmText) {
    if (confirmText && !confirm(confirmText)) return;
    const r = await postJson(path, { postId });
    if (!r.ok) { alert(r.data.error || 'Hiba történt.'); return; }
    load();
  }

  async function load() {
    const r = await api('admin/wall/reports');
    if (!r.ok) return; // nem admin vagy hiba: nem jelenítünk meg semmit

    let panel = document.getElementById('wall-panel');
    if (!panel) {
      panel = el('div', 'panel');
      panel.id = 'wall-panel';
      panel.appendChild(el('h2', '', 'WALL: JELENTETT KÉPEK'));
      const list = el('div', 'list');
      list.id = 'wall-reports';
      panel.appendChild(list);
      app.insertBefore(panel, document.getElementById('audit-panel'));
    }
    const list = document.getElementById('wall-reports');
    list.textContent = '';
    if (!r.data.items.length) { list.appendChild(el('div', 'card', 'Nincs jelentett kép.')); return; }

    r.data.items.forEach((it) => {
      const c = el('div', 'card');
      const img = document.createElement('img');
      img.loading = 'lazy'; img.alt = '';
      img.src = '/api/network/media?id=' + encodeURIComponent(it.imageId);
      c.appendChild(img);
      c.appendChild(el('div', '', it.owner + ' · ' + it.situation));
      c.appendChild(el('div', '', 'JELENTÉS: ' + it.reports + ' (' + it.reasons.map((x) => WHY[x] || x).join(', ') + ')'));
      if (it.caption) c.appendChild(el('div', '', it.caption));
      const rm = el('button', 'btn danger', 'Eltávolítás'); rm.type = 'button';
      rm.addEventListener('click', () => act('admin/wall/remove', it.postId, 'Biztosan eltávolítod ezt a képet? Ha ez egy hét győztese volt, a győzelem is visszavonódik.'));
      const ds = el('button', 'btn', 'Jelentések elvetése'); ds.type = 'button';
      ds.addEventListener('click', () => act('admin/wall/dismiss', it.postId, null));
      c.append(rm, ds);
      list.appendChild(c);
    });
  }
  load();
})();
