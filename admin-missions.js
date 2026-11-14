(function () {
  'use strict';
  const app = document.getElementById('app');
  if (!app) return;

  const style = document.createElement('style');
  style.textContent = `
.am-form{display:none;margin:0 0 1rem;padding:1rem;border:1px solid #490e7e55;border-radius:3px;background:#0b0b0b}
.am-form.open{display:block}
.am-form label{display:block;font-family:'Courier New',Courier,monospace;font-size:.64rem;letter-spacing:2px;color:#888;margin:.8rem 0 .3rem}
.am-form input[type=text],.am-form input[type=number],.am-form input[type=datetime-local],.am-form select,.am-form textarea{width:100%;background:#0a0a0a;border:1px solid #490e7e55;color:#fff;padding:.55rem .7rem;font-size:.85rem;border-radius:2px;outline:none;font-family:inherit}
.am-form textarea{resize:vertical}
.am-form .row{display:flex;gap:.6rem;margin-top:1rem;flex-wrap:wrap}
.am-item{border:1px solid #490e7e33;background:#0b0b0b;border-radius:2px;padding:.7rem .8rem;margin-bottom:.6rem;font-family:'Courier New',Courier,monospace;font-size:.68rem;letter-spacing:1px;color:#999;line-height:1.7}
.am-item b{color:#fff;font-weight:400;letter-spacing:2px}
.am-item .btn{margin-top:.5rem;padding:.4rem .8rem}
`;
  document.head.appendChild(style);

  const STATUS = { draft: 'VÁZLAT', active: 'AKTÍV', archived: 'ARCHIVÁLT' };
  let role = null, items = [], busy = false;

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
  const localVal = (iso) => {
    if (!iso) return '';
    const d = new Date(iso), p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  };

  async function prepareImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Csak JPG, PNG vagy WebP kép tölthető fel.');
    const url = URL.createObjectURL(file);
    const img = new Image();
    try {
      await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('A fájl nem érvényes kép.')); img.src = url; });
    } finally { URL.revokeObjectURL(url); }
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    for (const q of [0.85, 0.7, 0.55]) {
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size <= 3900000) return blob;
    }
    throw new Error('A kép feldolgozás után is túl nagy.');
  }

  // ---- Panelek ----
  const audit = document.getElementById('audit-panel');
  const p1 = el('div', 'panel'); p1.id = 'am-panel';
  p1.appendChild(el('h2', '', 'MISSIONS'));
  const bar = el('div', '');
  const newBtn = el('button', 'btn', 'Új küldetés'); newBtn.type = 'button';
  bar.appendChild(newBtn);
  p1.appendChild(bar);
  const formWrap = el('div', '');
  formWrap.innerHTML = `
<form class="am-form" id="am-form" autocomplete="off">
  <input type="hidden" id="am-id">
  <label for="am-title">CÍM</label><input type="text" id="am-title" maxlength="80" required>
  <label for="am-kind">TÍPUS</label>
  <select id="am-kind"><option value="photo">FOTÓ (admin bírálja)</option><option value="riddle">REJTVÉNY (automatikus)</option></select>
  <label for="am-desc">LEÍRÁS</label><textarea id="am-desc" rows="4" maxlength="1000"></textarea>
  <label for="am-status">ÁLLAPOT</label>
  <select id="am-status"><option value="draft">Vázlat (rejtett)</option><option value="active">Aktív</option><option value="archived">Archivált</option></select>
  <label for="am-start">KEZDET (opcionális)</label><input type="datetime-local" id="am-start">
  <label for="am-end">VÉGE (opcionális)</label><input type="datetime-local" id="am-end">
  <label for="am-reward">JUTALOM SZÖVEGE (a teljesítő látja)</label><input type="text" id="am-reward" maxlength="200">
  <div id="am-riddle">
    <label for="am-answer">HELYES VÁLASZ (szerkesztésnél üresen hagyva a régi marad)</label><input type="text" id="am-answer" maxlength="100">
    <label for="am-max">MAX. PRÓBÁLKOZÁS</label><input type="number" id="am-max" min="1" max="50" value="5">
  </div>
  <label for="am-cover">BORÍTÓKÉP (opcionális)</label><input type="file" id="am-cover" accept="image/jpeg,image/png,image/webp">
  <label><input type="checkbox" id="am-rmcover"> Meglévő borítókép eltávolítása</label>
  <div class="row"><button class="btn" type="submit">Mentés</button><button class="btn danger" type="button" id="am-cancel">Mégse</button></div>
  <div class="msg" id="am-msg" role="status"></div>
</form>`;
  p1.appendChild(formWrap);
  const listBox = el('div', ''); listBox.id = 'am-list';
  p1.appendChild(listBox);

  const p2 = el('div', 'panel'); p2.id = 'am-pending';
  p2.appendChild(el('h2', '', 'MISSIONS: ELBÍRÁLÁSRA VÁRÓ FOTÓK'));
  const pendBox = el('div', 'list'); pendBox.id = 'am-pend-list';
  p2.appendChild(pendBox);

  app.insertBefore(p1, audit);
  app.insertBefore(p2, audit);

  const $ = (s) => document.querySelector(s);
  function msg(t, ok) { const m = $('#am-msg'); m.textContent = t || ''; m.className = 'msg' + (ok ? ' ok' : ''); }
  function syncKind() { $('#am-riddle').style.display = $('#am-kind').value === 'riddle' ? 'block' : 'none'; }
  $('#am-kind').addEventListener('change', syncKind);

  function openForm(m) {
    $('#am-form').classList.add('open');
    $('#am-id').value = m ? m.id : '';
    $('#am-title').value = m ? m.title : '';
    $('#am-kind').value = m ? m.kind : 'photo';
    $('#am-kind').disabled = !!m; // a típus utólag nem módosítható
    $('#am-desc').value = m ? m.description : '';
    $('#am-status').value = m ? m.status : 'draft';
    $('#am-start').value = m ? localVal(m.startsAt) : '';
    $('#am-end').value = m ? localVal(m.endsAt) : '';
    $('#am-reward').value = m ? m.rewardText : '';
    $('#am-answer').value = '';
    $('#am-max').value = m ? m.maxAttempts : 5;
    $('#am-cover').value = '';
    $('#am-rmcover').checked = false;
    msg('');
    syncKind();
    $('#am-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function closeForm() { $('#am-form').classList.remove('open'); }
  newBtn.addEventListener('click', () => openForm(null));
  $('#am-cancel').addEventListener('click', closeForm);

  $('#am-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true; msg('Mentés...', true);
    try {
      let coverUploadId = null;
      const f = $('#am-cover').files[0];
      if (f) {
        const blob = await prepareImage(f);
        const r = await fetch('/api/network/upload?purpose=mission', {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'image/jpeg' }, body: blob,
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Képfeltöltési hiba.');
        coverUploadId = d.id;
      }
      const iso = (v) => { if (!v) return null; const d = new Date(v); if (Number.isNaN(d.getTime())) throw new Error('Érvénytelen dátum.'); return d.toISOString(); };
      const r2 = await postJson('missions/admin-save', {
        id: $('#am-id').value || null,
        title: $('#am-title').value,
        kind: $('#am-kind').value,
        description: $('#am-desc').value,
        status: $('#am-status').value,
        startsAt: iso($('#am-start').value),
        endsAt: iso($('#am-end').value),
        rewardText: $('#am-reward').value,
        answer: $('#am-answer').value,
        maxAttempts: $('#am-max').value,
        coverUploadId,
        removeCover: $('#am-rmcover').checked,
      });
      if (!r2.ok) throw new Error(r2.data.error || 'Hiba történt.');
      msg('Mentve.', true);
      await reload();
      closeForm();
    } catch (err) {
      msg(err.message || 'Hiba történt.');
    } finally { busy = false; }
  });

  function renderList() {
    listBox.textContent = '';
    if (!items.length) { listBox.appendChild(el('div', 'am-item', 'Még nincs küldetés.')); return; }
    items.forEach((m) => {
      const c = el('div', 'am-item');
      const t = el('div', '');
      t.appendChild(el('b', '', m.title));
      c.appendChild(t);
      c.appendChild(el('div', '', (m.kind === 'photo' ? 'FOTÓ' : 'REJTVÉNY') + ' · ' + (STATUS[m.status] || m.status)
        + (m.kind === 'riddle' ? ' · VÁLASZ: ' + (m.hasAnswer ? 'BEÁLLÍTVA' : 'HIÁNYZIK') : '')));
      c.appendChild(el('div', '', 'BEKÜLDÉS: ' + m.counts.pending + ' függő · ' + m.counts.approved + ' jóváhagyott · ' + m.counts.rejected + ' elutasított'));
      if (m.startsAt || m.endsAt) {
        c.appendChild(el('div', '', (m.startsAt ? 'KEZDET: ' + new Date(m.startsAt).toLocaleString('hu-HU') : '')
          + (m.endsAt ? '  VÉGE: ' + new Date(m.endsAt).toLocaleString('hu-HU') : '')));
      }
      if (role === 'super_admin') {
        const b = el('button', 'btn', 'Szerkesztés'); b.type = 'button';
        b.addEventListener('click', () => openForm(m));
        c.appendChild(b);
      }
      listBox.appendChild(c);
    });
  }

  async function review(id, decision) {
    let note = '';
    if (decision === 'reject') {
      note = window.prompt('Indoklás a tagnak (opcionális):');
      if (note === null) return;
    }
    const r = await postJson('missions/admin-review', { submissionId: id, decision, note });
    if (!r.ok) { alert(r.data.error || 'Hiba történt.'); return; }
    await Promise.all([loadPending(), reload()]);
  }
  async function loadPending() {
    const r = await api('missions/admin-pending');
    pendBox.textContent = '';
    if (!r.ok) return;
    if (!r.data.items.length) { pendBox.appendChild(el('div', 'card', 'Nincs elbírálásra váró fotó.')); return; }
    r.data.items.forEach((it) => {
      const c = el('div', 'card');
      const img = document.createElement('img');
      img.loading = 'lazy'; img.alt = '';
      img.src = '/api/network/media?id=' + encodeURIComponent(it.imageId);
      c.appendChild(img);
      c.appendChild(el('div', '', it.mission));
      c.appendChild(el('div', '', it.member));
      c.appendChild(el('div', '', new Date(it.createdAt).toLocaleString('hu-HU')));
      const ok = el('button', 'btn', 'Jóváhagy'); ok.type = 'button';
      ok.addEventListener('click', () => review(it.id, 'approve'));
      const no = el('button', 'btn danger', 'Elutasít'); no.type = 'button';
      no.addEventListener('click', () => review(it.id, 'reject'));
      c.append(ok, no);
      pendBox.appendChild(c);
    });
  }

  async function reload() {
    const r = await api('missions/admin-list');
    if (!r.ok) return;
    role = r.data.role; items = r.data.items;
    newBtn.style.display = role === 'super_admin' ? '' : 'none';
    renderList();
  }

  (async function init() {
    const r = await api('missions/admin-list');
    if (!r.ok) { p1.remove(); p2.remove(); return; } // nem admin
    role = r.data.role; items = r.data.items;
    newBtn.style.display = role === 'super_admin' ? '' : 'none';
    renderList();
    loadPending();
  })();
})();
