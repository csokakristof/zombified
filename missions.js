(function () {
  'use strict';
  const mainEl = document.querySelector('main');
  if (!mainEl) return;

  const CSS = `
#v-missions{max-width:620px}
#v-missions .ms-count{font-family:var(--mono);font-size:.7rem;letter-spacing:3px;color:var(--pl);margin:.6rem 0 1.2rem}
.ms{border:1px solid #490e7e44;background:rgba(14,14,14,.9);border-radius:3px;overflow:hidden;margin-bottom:1rem;text-align:left}
.ms-open{border-color:#490e7e99}
.ms-ended{opacity:.6}
.ms-cover{position:relative;aspect-ratio:16/7;background:#111}
.ms-cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity .35s ease}
.ms-cover img.ld{opacity:1}
.ms-body{padding:1rem 1.1rem 1.1rem}
.ms-head{display:flex;justify-content:space-between;gap:.8rem;align-items:flex-start;flex-wrap:wrap}
.ms-title{font-family:'Lacquer',cursive;font-size:1.3rem;letter-spacing:2px;color:#fff;font-weight:400;word-break:break-word}
.ms-chips{display:flex;gap:.4rem;flex-wrap:wrap}
.chip{font-family:var(--mono);font-size:.58rem;letter-spacing:2px;padding:.15rem .45rem;border:1px solid #490e7e88;color:var(--pl);border-radius:2px}
.chip.st-open{border-color:#3fa56b;color:#3fa56b}
.chip.st-done{background:var(--p);color:#fff;border-color:var(--pl)}
.chip.st-ended{border-color:#444;color:#777}
.ms-time{font-family:var(--mono);font-size:.62rem;letter-spacing:2px;color:#6f6f6f;margin-top:.4rem}
.ms-desc{font-size:.84rem;color:#aaa;line-height:1.7;margin-top:.7rem;white-space:pre-wrap;word-break:break-word}
.ms-act{margin-top:1rem}
#v-missions .ms-form{display:flex;gap:.5rem;flex-wrap:wrap;margin:0}
#v-missions .ms-form input[type=text]{flex:1;min-width:160px}
#v-missions .ms-form input[type=file]{width:100%;color:#aaa;font-size:.8rem}
#v-missions .ms-form .btn{width:auto;margin:0;padding:.7rem 1.2rem;display:inline-block}
.ms-ok{font-family:var(--mono);font-size:.7rem;letter-spacing:3px;color:#3fa56b}
.ms-wait{font-family:var(--mono);font-size:.7rem;letter-spacing:3px;color:var(--pl)}
.ms-rej{font-family:var(--mono);font-size:.68rem;letter-spacing:1px;color:#e05;margin-bottom:.6rem;word-break:break-word}
.ms-end{font-family:var(--mono);font-size:.68rem;letter-spacing:2px;color:#777}
.ms-reward{margin-top:.7rem;border:1px dashed #7a1fd1;padding:.7rem .8rem;background:#490e7e22}
.ms-reward .wk{display:block;font-family:var(--mono);font-size:.58rem;letter-spacing:2px;color:#6f6f6f}
.ms-reward b{display:block;font-weight:400;color:#fff;letter-spacing:1px;margin-top:.25rem;word-break:break-word}
.ms-sk{height:150px;background:#111;border:1px solid #490e7e22;border-radius:3px;margin-bottom:1rem;animation:wsk 1.6s ease-in-out infinite}
`;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const sec = document.createElement('section');
  sec.className = 'view';
  sec.id = 'v-missions';
  sec.innerHTML = `
<div class="eyebrow">[ MISS<b class="bang">!</b>ONS ]</div>
<h2>MISS<b class="bang">!</b>ONS</h2>
<p class="lead" style="margin:.8rem 0 .4rem">Küldetések, feladványok, rejtett nyomok. Teljesítsd őket, és gyűjtsd a jelvényeket.</p>
<div class="ms-count" id="m-count"></div>
<div id="m-list"></div>
<div class="msg" id="m-msg" role="status" style="text-align:center"></div>
<a class="back" data-go="/network/dashboard">← Vissza</a>`;
  mainEl.appendChild(sec);

  const $ = (s) => sec.querySelector(s);
  const S = { items: [], loaded: false, pending: null, fetchedAt: 0, busy: false };

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
  const post = (path, body) => api(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  function flash(t, ok) { const m = $('#m-msg'); m.textContent = t || ''; m.className = 'msg' + (ok ? ' ok' : ''); }
  function remaining(endsAt) {
    const ms = new Date(endsAt).getTime() - Date.now();
    if (!(ms > 0)) return 'LEJÁRT';
    const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    return (d ? d + 'n ' : '') + h + 'ó ' + (m % 60) + 'p';
  }

  // Kép előkészítése feltöltés előtt: méretezés + újrakódolás (a metaadatok ekkor törlődnek)
  async function prepareImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Csak JPG, PNG vagy WebP kép tölthető fel.');
    if (file.size > 30 * 1024 * 1024) throw new Error('A kép túl nagy (max. 30 MB).');
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

  function timeText(m) {
    if (m.state === 'done') return 'TELJESÍTVE';
    if (m.state === 'ended') return 'LEJÁRT';
    return m.endsAt ? 'LEJÁR: ' + remaining(m.endsAt) : 'NINCS HATÁRIDŐ';
  }

  function riddleForm(m) {
    const form = document.createElement('form');
    form.className = 'ms-form';
    form.autocomplete = 'off';
    const inp = document.createElement('input');
    inp.type = 'text'; inp.maxLength = 100; inp.placeholder = 'A válaszod'; inp.required = true;
    const btn = el('button', 'btn', 'Beküld');
    btn.type = 'submit';
    const note = el('div', 'msg', m.attemptsLeft != null ? 'MÉG ' + m.attemptsLeft + ' PRÓBA' : '');
    note.style.width = '100%';
    note.style.margin = '.3rem 0 0';
    form.append(inp, btn, note);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (S.busy) return;
      S.busy = true; btn.disabled = true;
      const r = await post('missions/answer', { missionId: m.id, answer: inp.value });
      S.busy = false; btn.disabled = false;
      if (!r.ok) { note.className = 'msg'; note.textContent = r.data.error || 'Hiba történt.'; return; }
      if (r.data.correct) { await load(); return; }
      m.attemptsLeft = r.data.attemptsLeft;
      note.className = 'msg';
      note.textContent = 'NEM JÓ VÁLASZ. MÉG ' + r.data.attemptsLeft + ' PRÓBA.';
      inp.value = '';
    });
    return form;
  }

  function photoForm(m) {
    const form = document.createElement('form');
    form.className = 'ms-form';
    const file = document.createElement('input');
    file.type = 'file'; file.accept = 'image/jpeg,image/png,image/webp'; file.required = true;
    const btn = el('button', 'btn', 'Kép beküldése');
    btn.type = 'submit';
    const note = el('div', 'msg', '');
    note.style.width = '100%';
    note.style.margin = '.3rem 0 0';
    form.append(file, btn, note);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (S.busy || !file.files[0]) return;
      S.busy = true; btn.disabled = true;
      note.className = 'msg ok'; note.textContent = 'Feldolgozás...';
      try {
        const blob = await prepareImage(file.files[0]);
        const u = await fetch('/api/network/upload?purpose=mission', {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'image/jpeg' }, body: blob,
        });
        const d = await u.json().catch(() => ({}));
        if (!u.ok) throw new Error(d.error || 'Feltöltési hiba.');
        const r = await post('missions/submit', { missionId: m.id, uploadId: d.id });
        if (!r.ok) {
          await post('missions/discard', { uploadId: d.id });
          throw new Error(r.data.error || 'Hiba történt.');
        }
        S.busy = false;
        await load();
        return;
      } catch (err) {
        note.className = 'msg';
        note.textContent = err.message || 'Hiba történt.';
      }
      S.busy = false; btn.disabled = false;
    });
    return form;
  }

  function actionArea(m) {
    const box = el('div', 'ms-act');
    if (m.state === 'done') {
      box.appendChild(el('div', 'ms-ok', 'TELJESÍTVE'));
      if (m.reward) {
        const r = el('div', 'ms-reward');
        r.appendChild(el('span', 'wk', 'JUTALOM'));
        r.appendChild(el('b', '', m.reward));
        box.appendChild(r);
      }
      return box;
    }
    if (m.state === 'ended') {
      box.appendChild(el('div', 'ms-end', m.mine && m.mine.status === 'pending' ? 'LEJÁRT (a beküldésed elbírálásra vár)' : 'Ez a küldetés lejárt.'));
      return box;
    }
    if (m.kind === 'riddle') {
      if (m.attemptsLeft === 0) { box.appendChild(el('div', 'ms-end', 'Elfogytak a próbálkozásaid.')); return box; }
      box.appendChild(riddleForm(m));
      return box;
    }
    if (m.mine && m.mine.status === 'pending') { box.appendChild(el('div', 'ms-wait', 'ELBÍRÁLÁS ALATT')); return box; }
    if (m.mine && m.mine.status === 'rejected') {
      box.appendChild(el('div', 'ms-rej', 'ELUTASÍTVA' + (m.mine.note ? ': ' + m.mine.note : '') + ' — újra beküldheted.'));
    }
    box.appendChild(photoForm(m));
    return box;
  }

  function card(m) {
    const c = el('article', 'ms ms-' + m.state);
    if (m.coverUrl) {
      const cov = el('div', 'ms-cover');
      const img = document.createElement('img');
      img.alt = ''; img.decoding = 'async';
      const done = () => img.classList.add('ld');
      img.addEventListener('load', done); img.addEventListener('error', done);
      img.src = m.coverUrl;
      cov.appendChild(img);
      c.appendChild(cov);
    }
    const body = el('div', 'ms-body');
    const head = el('div', 'ms-head');
    head.appendChild(el('h3', 'ms-title', m.title));
    const chips = el('div', 'ms-chips');
    chips.appendChild(el('span', 'chip', m.kind === 'photo' ? 'FOTÓ' : 'REJTVÉNY'));
    chips.appendChild(el('span', 'chip st-' + m.state, { open: 'OPEN', done: 'DONE', ended: 'ENDED' }[m.state]));
    head.appendChild(chips);
    body.appendChild(head);
    body.appendChild(el('div', 'ms-time', timeText(m)));
    if (m.description) body.appendChild(el('p', 'ms-desc', m.description));
    body.appendChild(actionArea(m));
    c.appendChild(body);
    return c;
  }

  function render() {
    const box = $('#m-list');
    box.textContent = '';
    if (!S.loaded) { for (let i = 0; i < 3; i++) box.appendChild(el('div', 'ms-sk')); $('#m-count').textContent = ''; return; }
    const done = S.items.filter((m) => m.state === 'done').length;
    $('#m-count').textContent = 'TELJESÍTVE: ' + done;
    if (!S.items.length) { box.appendChild(el('div', 'wempty', 'MÉG NINCS AKTÍV KÜLDETÉS.')); return; }
    S.items.forEach((m) => box.appendChild(card(m)));
  }

  function load(silent) {
    if (S.pending) return S.pending;
    S.pending = (async () => {
      const r = await api('missions/list');
      if (r.status === 401) { if (!silent) location.assign('/network/login'); return; }
      if (!r.ok) { if (!silent) flash(r.data.error || 'A küldetések betöltése nem sikerült.'); return; }
      S.items = r.data.items; S.loaded = true; S.fetchedAt = Date.now();
      render();
    })().finally(() => { S.pending = null; });
    return S.pending;
  }

  async function open() {
    flash('');
    render(); // a korábban betöltött lista azonnal látszik (vagy a vázlap)
    await load();
    if (!S.loaded) flash('A küldetések betöltése nem sikerült.');
  }

  // Útvonal regisztrálása a network.html-ben
  window.NDRoutes = window.NDRoutes || {};
  window.NDRoutes['/network/missions'] = { view: 'missions', open };

  // MISS!ONS jelvény a SUBJECT ID oldalon
  const idStats = document.querySelector('#v-id .stats');
  if (idStats) {
    const row = el('div', 'stat');
    row.appendChild(el('span', '', 'MISS!ONS'));
    row.appendChild(document.createElement('i'));
    const b = el('b', '', '0×');
    b.id = 'i-miss';
    row.appendChild(b);
    idStats.appendChild(row);
  }
  async function fillCount() {
    const b = document.getElementById('i-miss');
    if (!b) return;
    b.textContent = '…';
    const r = await api('missions/mystats');
    b.textContent = r.ok ? r.data.completed + '×' : '—';
  }
  const idView = document.getElementById('v-id');
  if (idView) {
    new MutationObserver(() => { if (idView.classList.contains('on')) fillCount(); })
      .observe(idView, { attributes: true, attributeFilter: ['class'] });
  }

  // A dashboardon a csempe már nem lezárt
  const ts = document.querySelector('a.tile[href="/network/missions"] .ts');
  if (ts) { ts.textContent = 'OPEN'; ts.style.color = '#3fa56b'; }
})();
