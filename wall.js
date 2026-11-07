(function () {
  'use strict';
  const mainEl = document.querySelector('main');
  if (!mainEl) return;

  const SIT = { street: 'STREET', work: 'WORK', travel: 'TRAVEL', night: 'NIGHT', sport: 'SPORT', home: 'HOME' };
  const REASONS = [
    ['inappropriate', 'Nem megfelelő tartalom'],
    ['not_mine', 'Nem a saját képe'],
    ['spam', 'Spam'],
    ['other', 'Egyéb'],
  ];

  const CSS = `
#v-wall{max-width:760px}
#v-wall .wbar{display:flex;gap:1rem 1.6rem;align-items:center;justify-content:center;flex-wrap:wrap;margin:1rem 0;padding:.9rem 1rem;border:1px solid #490e7e55;background:rgba(14,14,14,.85);border-radius:3px}
#v-wall .wbar>div{font-family:var(--mono);text-align:left}
#v-wall .wk{display:block;font-size:.58rem;letter-spacing:2px;color:#6f6f6f}
#v-wall .wbar b{font-weight:400;font-size:.9rem;letter-spacing:2px;color:#fff}
#v-wall .btn{display:inline-block}
#v-wall .wform{display:none;text-align:left;margin:0 0 1rem;padding:1rem;border:1px solid #490e7e55;background:rgba(14,14,14,.9);border-radius:3px}
#v-wall .wform.open{display:block}
#v-wall select,.wm select{width:100%;background:rgba(10,10,10,.85);border:1px solid #490e7e55;color:#fff;padding:.75rem 1rem;font-size:.9rem;border-radius:2px;outline:none}
#v-wall input[type=file]{width:100%;color:#aaa;font-size:.8rem}
.wtabs{display:flex;justify-content:center;gap:.6rem;margin:1rem 0}
.wtabs button{background:transparent;border:1px solid #490e7e55;color:#888;padding:.5rem 1rem;font-family:var(--mono);font-size:.68rem;letter-spacing:2px;cursor:pointer;border-radius:2px}
.wtabs button.on{border-color:var(--pl);color:#fff;background:#490e7e33}
.wgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:.9rem;text-align:left}
.wp{border:1px solid #490e7e44;background:rgba(14,14,14,.9);border-radius:3px;overflow:hidden;display:flex;flex-direction:column}
.wp img{width:100%;aspect-ratio:4/5;object-fit:cover;display:block;background:#111}
.wp-meta{padding:.7rem .8rem .3rem}
.wp-who{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.wp-name{font-family:'Lacquer',cursive;font-size:1.05rem;letter-spacing:1.5px;color:#fff;word-break:break-all}
.wp-sub{font-family:var(--mono);font-size:.6rem;letter-spacing:2px;color:#6f6f6f;margin-top:.15rem}
.wp-cap{font-size:.78rem;color:#aaa;line-height:1.5;margin-top:.5rem;word-break:break-word}
.wp-act{display:flex;align-items:center;gap:.5rem;padding:.6rem .8rem .8rem;margin-top:auto}
.wp-vote{flex:1;background:transparent;border:1px solid #490e7e77;color:var(--pl);padding:.45rem .6rem;font-family:var(--mono);font-size:.72rem;letter-spacing:2px;cursor:pointer;border-radius:2px;transition:background .2s,box-shadow .2s}
.wp-vote:hover:not(:disabled){box-shadow:0 0 14px rgba(73,14,126,.6)}
.wp-vote.on{background:var(--p);color:#fff;border-color:var(--pl)}
.wp-vote:disabled{opacity:.4;cursor:not-allowed}
.wp-ico{background:transparent;border:1px solid #333;color:#777;width:34px;height:32px;cursor:pointer;border-radius:2px;margin-left:auto}
.wp-ico:hover{color:#fff;border-color:var(--pl)}
.zb{display:inline-block;font-family:var(--mono);font-size:.6rem;letter-spacing:1px;padding:.12rem .4rem;border:1px solid #7a1fd1;color:#fff;background:#490e7e88;border-radius:2px;box-shadow:0 0 8px rgba(122,31,209,.6)}
.wwin{border:1px solid var(--pl);box-shadow:0 0 28px rgba(73,14,126,.6);background:linear-gradient(135deg,rgba(30,10,52,.92),rgba(12,12,12,.92));border-radius:3px;padding:1rem;margin-bottom:1.2rem;display:flex;gap:1rem;text-align:left;align-items:center}
.wwin img{width:120px;aspect-ratio:4/5;object-fit:cover;border-radius:2px;flex:none;background:#111}
.wwin .wt{font-family:var(--mono);font-size:.62rem;letter-spacing:.3rem;color:var(--pl);display:flex;align-items:center;gap:.5rem;margin-bottom:.6rem}
.wz{width:22px;height:22px}
.wm{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;padding:1rem}
.wm-box{width:100%;max-width:340px;background:#0f0f0f;border:1px solid #490e7e88;padding:1.2rem;border-radius:3px;text-align:left}
.wm-t{font-family:var(--mono);font-size:.7rem;letter-spacing:3px;color:#fff;margin-bottom:.9rem}
.wm-row{display:flex;gap:.6rem;margin-top:1rem}
.wm-row .btn{flex:1;padding:.7rem}
.wempty{font-family:var(--mono);font-size:.74rem;letter-spacing:2px;color:#6f6f6f;padding:2rem 0;grid-column:1/-1;text-align:center}
@media(max-width:480px){.wgrid{grid-template-columns:1fr 1fr;gap:.6rem}.wwin{flex-direction:column;text-align:center}.wwin img{width:60%}}
`;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const sec = document.createElement('section');
  sec.className = 'view';
  sec.id = 'v-wall';
  sec.innerHTML = `
<div class="eyebrow">[ WALL OF THE AWAKEN ]</div>
<h2>WALL OF THE AWAKEN</h2>
<p class="lead" style="margin:.8rem 0 1rem">Mutasd meg, hogyan élsz a ZOMBIF!ED-ben. Hetente egy győztes: Z! OF THE WEEK.</p>
<div class="wbar">
  <div><span class="wk">SZAVAZÁS VÉGE</span><b id="w-time">—</b></div>
  <div><span class="wk">MÉG FELTÖLTHETŐ</span><b id="w-left">—</b></div>
  <button class="btn" id="w-toggle" type="button">Kép feltöltése</button>
</div>
<form class="wform" id="w-form" autocomplete="off">
  <label class="l" for="w-file">Kép (JPG, PNG vagy WebP)</label>
  <input type="file" id="w-file" accept="image/jpeg,image/png,image/webp" required>
  <label class="l" for="w-sit">Élethelyzet</label>
  <select id="w-sit">
    <option value="street">STREET</option><option value="work">WORK</option><option value="travel">TRAVEL</option>
    <option value="night">NIGHT</option><option value="sport">SPORT</option><option value="home">HOME</option>
  </select>
  <label class="l" for="w-cap">Felirat (opcionális, max. 140 karakter)</label>
  <input type="text" id="w-cap" maxlength="140">
  <label class="chk"><input type="checkbox" id="w-own" required><span>Én készítettem a képet vagy engem ábrázol, és hozzájárulok a megjelenítéséhez a Network tagjai számára.</span></label>
  <button class="btn" type="submit">Feltöltés</button>
</form>
<div class="wtabs">
  <button id="t-wall" class="on" type="button">FAL</button>
  <button id="t-win" type="button">Z! OF THE WEEK</button>
</div>
<div id="w-pane-wall">
  <div id="w-winner"></div>
  <div class="wgrid" id="w-grid"></div>
  <button class="btn ghost" id="w-more" type="button" style="margin:1.2rem auto 0;display:none">Továbbiak</button>
</div>
<div id="w-pane-win" style="display:none"><div class="wgrid" id="w-hall"></div></div>
<div class="msg" id="w-msg" role="status" style="text-align:center"></div>
<a class="back" data-go="/network/dashboard">← Vissza</a>`;
  mainEl.appendChild(sec);

  const $ = (s) => sec.querySelector(s);
  const S = { week: null, winner: null, posts: [], hasMore: false, busy: false, timer: null, hallLoaded: false };

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
  function flash(t, ok) { const m = $('#w-msg'); m.textContent = t || ''; m.className = 'msg' + (ok ? ' ok' : ''); }
  function badge(n) { return n ? el('span', 'zb', 'Z! ×' + n) : null; }
  function remaining(endsAt) {
    const ms = new Date(endsAt).getTime() - Date.now();
    if (!(ms > 0)) return 'LEZÁRUL';
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

  function askReason() {
    return new Promise((resolve) => {
      const ov = el('div', 'wm');
      const box = el('div', 'wm-box');
      box.appendChild(el('div', 'wm-t', 'KÉP JELENTÉSE'));
      const sel = document.createElement('select');
      REASONS.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); });
      box.appendChild(sel);
      const row = el('div', 'wm-row');
      const ok = el('button', 'btn', 'Jelentés'); ok.type = 'button';
      const no = el('button', 'btn ghost', 'Mégse'); no.type = 'button';
      ok.addEventListener('click', () => { ov.remove(); resolve(sel.value); });
      no.addEventListener('click', () => { ov.remove(); resolve(null); });
      row.append(ok, no); box.appendChild(row); ov.appendChild(box);
      document.body.appendChild(ov);
    });
  }

  function postCard(p, plain) {
    const c = el('article', 'wp');
    const img = document.createElement('img');
    img.loading = 'lazy'; img.alt = '';
    img.src = '/api/network/media?id=' + encodeURIComponent(p.imageId);
    c.appendChild(img);

    const meta = el('div', 'wp-meta');
    const who = el('div', 'wp-who');
    who.appendChild(el('span', 'wp-name', p.owner.username));
    const b = badge(p.owner.wins);
    if (b) who.appendChild(b);
    meta.appendChild(who);
    meta.appendChild(el('div', 'wp-sub', p.owner.label + ' · ' + (SIT[p.situation] || '')));
    if (p.caption) meta.appendChild(el('div', 'wp-cap', p.caption));
    c.appendChild(meta);
    if (plain) return c;

    const act = el('div', 'wp-act');
    if (p.current) {
      const v = el('button', 'wp-vote' + (p.voted ? ' on' : ''), '▲ ' + p.votes);
      v.type = 'button';
      if (p.mine) { v.disabled = true; v.title = 'A saját képedre nem szavazhatsz.'; }
      else v.addEventListener('click', () => vote(p));
      act.appendChild(v);
    }
    if (p.mine) {
      const d = el('button', 'wp-ico', '✕'); d.type = 'button'; d.title = 'Törlés';
      d.addEventListener('click', () => del(p)); act.appendChild(d);
    } else {
      const r = el('button', 'wp-ico', '⚑'); r.type = 'button'; r.title = 'Jelentés';
      r.addEventListener('click', () => report(p)); act.appendChild(r);
    }
    c.appendChild(act);
    return c;
  }

  function renderHead() {
    const w = S.week;
    if (!w) return;
    $('#w-time').textContent = remaining(w.endsAt);
    $('#w-left').textContent = w.postsLeft + ' / 3';
    $('#w-toggle').disabled = w.postsLeft <= 0;
  }
  function renderWinner() {
    const box = $('#w-winner');
    box.textContent = '';
    const w = S.winner;
    if (!w) return;
    const c = el('div', 'wwin');
    const img = document.createElement('img');
    img.alt = ''; img.src = '/api/network/media?id=' + encodeURIComponent(w.imageId);
    c.appendChild(img);
    const t = el('div', '');
    const tag = el('div', 'wt');
    tag.innerHTML = '<svg class="wz" viewBox="0 0 60 60" aria-hidden="true"><use href="#i-zmark"/></svg>';
    tag.appendChild(document.createTextNode('Z! OF THE WEEK'));
    t.appendChild(tag);
    const who = el('div', 'wp-who');
    who.appendChild(el('span', 'wp-name', w.owner.username));
    const b = badge(w.owner.wins);
    if (b) who.appendChild(b);
    t.appendChild(who);
    t.appendChild(el('div', 'wp-sub', w.owner.label + ' · ' + (SIT[w.situation] || '')));
    t.appendChild(el('div', 'wp-sub', 'HÉT: ' + w.weekStart + ' · ' + w.votes + ' SZAVAZAT'));
    if (w.caption) t.appendChild(el('div', 'wp-cap', w.caption));
    c.appendChild(t);
    box.appendChild(c);
  }
  function renderGrid() {
    const g = $('#w-grid');
    g.textContent = '';
    if (!S.posts.length) g.appendChild(el('div', 'wempty', 'MÉG NINCS KÉP A FALON.'));
    S.posts.forEach((p) => g.appendChild(postCard(p, false)));
    $('#w-more').style.display = S.hasMore ? 'inline-block' : 'none';
  }
  function renderAll() { renderHead(); renderWinner(); renderGrid(); }

  async function loadFeed() {
    const r = await api('wall/feed');
    if (r.status === 401) { location.assign('/network/login'); return; }
    if (!r.ok) { flash(r.data.error || 'A fal betöltése nem sikerült.'); return; }
    S.week = r.data.week; S.winner = r.data.winner; S.posts = r.data.posts; S.hasMore = r.data.hasMore;
    renderAll();
  }
  async function loadMore() {
    const last = S.posts[S.posts.length - 1];
    if (!last) return;
    const r = await api('wall/feed?before=' + encodeURIComponent(last.createdAt));
    if (!r.ok) return flash(r.data.error || 'Hiba történt.');
    S.posts = S.posts.concat(r.data.posts); S.hasMore = r.data.hasMore;
    renderGrid();
  }
  async function loadHall() {
    const box = $('#w-hall');
    box.textContent = '';
    const r = await api('wall/winners');
    if (!r.ok) return flash(r.data.error || 'Hiba történt.');
    if (!r.data.items.length) { box.appendChild(el('div', 'wempty', 'MÉG NINCS KIHIRDETETT GYŐZTES.')); return; }
    r.data.items.forEach((it) => {
      const c = postCard(it.post, true);
      c.appendChild(el('div', 'wp-sub', 'HÉT: ' + it.weekStart + ' · ' + it.votes + ' SZAVAZAT'));
      c.lastChild.style.padding = '0 .8rem .8rem';
      box.appendChild(c);
    });
    S.hallLoaded = true;
  }

  async function vote(p) {
    if (S.busy) return;
    S.busy = true; flash('');
    const was = p.voted;
    const r = was ? await post('wall/unvote') : await post('wall/vote', { postId: p.id });
    S.busy = false;
    if (!r.ok) return flash(r.data.error || 'Hiba történt.');
    S.posts.forEach((x) => { if (x.voted) { x.voted = false; if (x.votes != null) x.votes--; } });
    if (!was) { p.voted = true; p.votes++; S.week.myVotePostId = p.id; } else { S.week.myVotePostId = null; }
    renderGrid();
  }
  async function del(p) {
    if (!confirm('Biztosan törlöd ezt a képet?')) return;
    const r = await post('wall/delete', { postId: p.id });
    if (!r.ok) return flash(r.data.error || 'Hiba történt.');
    await loadFeed();
    flash('A kép törölve.', true);
  }
  async function report(p) {
    const reason = await askReason();
    if (!reason) return;
    const r = await post('wall/report', { postId: p.id, reason });
    flash(r.ok ? 'Köszönjük, a jelentést megkaptuk.' : (r.data.error || 'Hiba történt.'), r.ok);
  }

  function setTab(t) {
    $('#t-wall').classList.toggle('on', t === 'wall');
    $('#t-win').classList.toggle('on', t === 'win');
    $('#w-pane-wall').style.display = t === 'wall' ? 'block' : 'none';
    $('#w-pane-win').style.display = t === 'win' ? 'block' : 'none';
    if (t === 'win' && !S.hallLoaded) loadHall();
  }
  $('#t-wall').addEventListener('click', () => setTab('wall'));
  $('#t-win').addEventListener('click', () => setTab('win'));
  $('#w-more').addEventListener('click', loadMore);
  $('#w-toggle').addEventListener('click', () => {
    if (S.week && S.week.postsLeft <= 0) return flash('Ezen a héten már nem tölthetsz fel több képet.');
    $('#w-form').classList.toggle('open');
  });

  $('#w-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (S.busy) return;
    const f = $('#w-file').files[0];
    if (!f) return flash('Válassz egy képet.');
    const btn = e.target.querySelector('button[type=submit]');
    S.busy = true; btn.disabled = true; flash('Feldolgozás...', true);
    try {
      const blob = await prepareImage(f);
      const r = await fetch('/api/network/upload?purpose=wall', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'image/jpeg' }, body: blob,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Feltöltési hiba.');
      const p = await post('wall/post', { uploadId: d.id, caption: $('#w-cap').value.trim(), situation: $('#w-sit').value });
      if (!p.ok) {
        await post('wall/discard', { uploadId: d.id });
        throw new Error(p.data.error || 'Hiba történt.');
      }
      e.target.reset();
      $('#w-form').classList.remove('open');
      await loadFeed();
      flash('Kép feltöltve.', true);
    } catch (err) {
      flash(err.message || 'Hiba történt.');
    } finally {
      S.busy = false; btn.disabled = false;
    }
  });

  async function open() {
    setTab('wall');
    $('#w-form').classList.remove('open');
    flash('');
    S.hallLoaded = false;
    clearInterval(S.timer);
    S.timer = setInterval(renderHead, 30000);
    await loadFeed();
  }

  // Z! OF THE WEEK sor a SUBJECT ID oldalon
  const idStats = document.querySelector('#v-id .stats');
  if (idStats) {
    const row = el('div', 'stat');
    row.appendChild(el('span', '', 'Z! OF THE WEEK'));
    row.appendChild(document.createElement('i'));
    const b = el('b', '', '0×');
    b.id = 'i-wins';
    row.appendChild(b);
    idStats.appendChild(row);
  }
  async function fillWins() {
    const b = document.getElementById('i-wins');
    if (!b) return;
    b.textContent = '…';
    const r = await api('wall/mystats');
    b.textContent = r.ok ? r.data.wins + '×' : '—';
  }

  // A dashboardon a csempe már nem lezárt
  const ts = document.querySelector('a.tile[href="/network/wall"] .ts');
  if (ts) { ts.textContent = 'OPEN'; ts.style.color = '#3fa56b'; }

  window.NDWall = { open, fillWins };
})();
