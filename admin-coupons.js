(function () {
  'use strict';
  const app = document.getElementById('app');
  if (!app) return;

  const style = document.createElement('style');
  style.textContent = `
.ac-form{display:none;margin:0 0 1rem;padding:1rem;border:1px solid #490e7e55;border-radius:3px;background:#0b0b0b}
.ac-form.open{display:block}
.ac-form label{display:block;font-family:'Courier New',Courier,monospace;font-size:.64rem;letter-spacing:2px;color:#888;margin:.8rem 0 .3rem}
.ac-form input[type=text],.ac-form input[type=number],.ac-form input[type=datetime-local],.ac-form select,.ac-form textarea{width:100%;background:#0a0a0a;border:1px solid #490e7e55;color:#fff;padding:.55rem .7rem;font-size:.85rem;border-radius:2px;outline:none;font-family:inherit}
.ac-form textarea{resize:vertical;font-family:'Courier New',Courier,monospace;letter-spacing:1px}
.ac-form .row{display:flex;gap:.6rem;margin-top:1rem;flex-wrap:wrap}
.ac-bar{display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:1rem}
.ac-item{border:1px solid #490e7e33;background:#0b0b0b;border-radius:2px;padding:.7rem .8rem;margin-bottom:.6rem;font-family:'Courier New',Courier,monospace;font-size:.68rem;letter-spacing:1px;color:#999;line-height:1.7}
.ac-item b{color:#fff;font-weight:400;letter-spacing:2px;font-size:.78rem}
.ac-item.off{opacity:.55}
.ac-item .btn{margin:.5rem .4rem 0 0;padding:.4rem .8rem}
`;
  document.head.appendChild(style);

  let items = [], busy = false;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  async function api(path, opt) {
    const r = await fetch('/api/network/admin/' + path, { credentials: 'same-origin', ...(opt || {}) });
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
  const isoOrNull = (v) => {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw new Error('Érvénytelen dátum.');
    return d.toISOString();
  };
  const valueText = (c) => c.kind === 'percent' ? c.value + '%'
    : c.kind === 'fixed' ? c.value.toLocaleString('hu-HU') + ' Ft' : 'INGYENES SZÁLLÍTÁS';

  const panel = el('div', 'panel');
  panel.id = 'ac-panel';
  panel.appendChild(el('h2', '', 'KUPONOK'));
  const bar = el('div', 'ac-bar');
  const newBtn = el('button', 'btn', 'Új kupon'); newBtn.type = 'button';
  const bulkBtn = el('button', 'btn', 'Kuponkódok generálása'); bulkBtn.type = 'button';
  bar.append(newBtn, bulkBtn);
  panel.appendChild(bar);

  const forms = el('div', '');
  forms.innerHTML = `
<form class="ac-form" id="ac-form" autocomplete="off">
  <input type="hidden" id="ac-id">
  <label for="ac-code">KÓD (A–Z, 0–9, kötőjel; létrehozás után nem módosítható)</label>
  <input type="text" id="ac-code" maxlength="32" style="text-transform:uppercase">
  <label for="ac-kind">TÍPUS</label>
  <select id="ac-kind"><option value="percent">Százalék (a termékek árából)</option><option value="fixed">Fix összeg (a termékek árából)</option><option value="free_shipping">Ingyenes szállítás</option></select>
  <div id="ac-valwrap"><label for="ac-value">ÉRTÉK (% vagy Ft)</label><input type="number" id="ac-value" min="1"></div>
  <label for="ac-max">MAX. FELHASZNÁLÁS (üresen: korlátlan)</label><input type="number" id="ac-max" min="1">
  <label><input type="checkbox" id="ac-once" checked> E-mail-címenként csak egyszer használható</label>
  <label for="ac-min">MINIMUM RENDELÉSI ÉRTÉK (Ft, a termékekre)</label><input type="number" id="ac-min" min="0" value="0">
  <label for="ac-start">KEZDET (opcionális)</label><input type="datetime-local" id="ac-start">
  <label for="ac-end">LEJÁRAT (opcionális)</label><input type="datetime-local" id="ac-end">
  <label for="ac-note">BELSŐ MEGJEGYZÉS (a vásárló nem látja)</label><input type="text" id="ac-note" maxlength="200">
  <label><input type="checkbox" id="ac-active" checked> Aktív</label>
  <div class="row"><button class="btn" type="submit">Mentés</button><button class="btn danger" type="button" id="ac-cancel">Mégse</button></div>
  <div class="msg" id="ac-msg" role="status"></div>
</form>
<form class="ac-form" id="ab-form" autocomplete="off">
  <label for="ab-count">DARABSZÁM (1–200, mind egyszer használatos)</label><input type="number" id="ab-count" min="1" max="200" value="10">
  <label for="ab-prefix">ELŐTAG (A–Z, 0–9, max. 8)</label><input type="text" id="ab-prefix" maxlength="8" value="ZMB" style="text-transform:uppercase">
  <label for="ab-kind">TÍPUS</label>
  <select id="ab-kind"><option value="percent">Százalék</option><option value="fixed">Fix összeg</option><option value="free_shipping">Ingyenes szállítás</option></select>
  <div id="ab-valwrap"><label for="ab-value">ÉRTÉK (% vagy Ft)</label><input type="number" id="ab-value" min="1" value="10"></div>
  <label for="ab-min">MINIMUM RENDELÉSI ÉRTÉK (Ft)</label><input type="number" id="ab-min" min="0" value="0">
  <label for="ab-end">LEJÁRAT (opcionális)</label><input type="datetime-local" id="ab-end">
  <label for="ab-note">BELSŐ MEGJEGYZÉS (pl. melyik nyereményhez)</label><input type="text" id="ab-note" maxlength="200">
  <div class="row"><button class="btn" type="submit">Generálás</button><button class="btn danger" type="button" id="ab-cancel">Mégse</button></div>
  <div class="msg" id="ab-msg" role="status"></div>
  <div id="ab-result" style="display:none">
    <label for="ab-codes">KÓDOK (mentsd el őket, később is megtalálod a listában)</label>
    <textarea id="ab-codes" rows="8" readonly></textarea>
    <div class="row"><button class="btn" type="button" id="ab-copy">Másolás</button></div>
  </div>
</form>`;
  panel.appendChild(forms);
  const listBox = el('div', ''); listBox.id = 'ac-list';
  panel.appendChild(listBox);
  app.insertBefore(panel, document.getElementById('audit-panel'));

  const $ = (s) => document.querySelector(s);
  const msg = (sel, t, ok) => { const m = $(sel); m.textContent = t || ''; m.className = 'msg' + (ok ? ' ok' : ''); };
  const syncVal = () => {
    $('#ac-valwrap').style.display = $('#ac-kind').value === 'free_shipping' ? 'none' : 'block';
    $('#ab-valwrap').style.display = $('#ab-kind').value === 'free_shipping' ? 'none' : 'block';
  };
  $('#ac-kind').addEventListener('change', syncVal);
  $('#ab-kind').addEventListener('change', syncVal);

  function openForm(c) {
    $('#ab-form').classList.remove('open');
    $('#ac-form').classList.add('open');
    $('#ac-id').value = c ? c.id : '';
    $('#ac-code').value = c ? c.code : '';
    $('#ac-code').disabled = !!c;
    $('#ac-kind').value = c ? c.kind : 'percent';
    $('#ac-value').value = c ? (c.value || '') : 10;
    $('#ac-max').value = c && c.maxUses ? c.maxUses : '';
    $('#ac-once').checked = c ? c.oncePerEmail : true;
    $('#ac-min').value = c ? c.minOrder : 0;
    $('#ac-start').value = c ? localVal(c.startsAt) : '';
    $('#ac-end').value = c ? localVal(c.expiresAt) : '';
    $('#ac-note').value = c ? c.note : '';
    $('#ac-active').checked = c ? c.active : true;
    msg('#ac-msg', '');
    syncVal();
    $('#ac-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  newBtn.addEventListener('click', () => openForm(null));
  $('#ac-cancel').addEventListener('click', () => $('#ac-form').classList.remove('open'));
  bulkBtn.addEventListener('click', () => {
    $('#ac-form').classList.remove('open');
    $('#ab-form').classList.add('open');
    $('#ab-result').style.display = 'none';
    msg('#ab-msg', '');
    syncVal();
    $('#ab-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('#ab-cancel').addEventListener('click', () => $('#ab-form').classList.remove('open'));

  $('#ac-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true; msg('#ac-msg', 'Mentés...', true);
    try {
      const r = await postJson('coupon-save', {
        id: $('#ac-id').value || null,
        code: $('#ac-code').value,
        kind: $('#ac-kind').value,
        value: $('#ac-value').value,
        maxUses: $('#ac-max').value,
        oncePerEmail: $('#ac-once').checked,
        minOrder: $('#ac-min').value,
        startsAt: isoOrNull($('#ac-start').value),
        expiresAt: isoOrNull($('#ac-end').value),
        note: $('#ac-note').value,
        active: $('#ac-active').checked,
      });
      if (!r.ok) throw new Error(r.data.error || 'Hiba történt.');
      $('#ac-form').classList.remove('open');
      await load();
    } catch (err) {
      msg('#ac-msg', err.message || 'Hiba történt.');
    } finally { busy = false; }
  });

  $('#ab-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true; msg('#ab-msg', 'Generálás...', true);
    try {
      const r = await postJson('coupon-bulk', {
        count: $('#ab-count').value,
        prefix: $('#ab-prefix').value,
        kind: $('#ab-kind').value,
        value: $('#ab-value').value,
        minOrder: $('#ab-min').value,
        expiresAt: isoOrNull($('#ab-end').value),
        note: $('#ab-note').value,
      });
      if (!r.ok) throw new Error(r.data.error || 'Hiba történt.');
      $('#ab-codes').value = r.data.codes.join('\n');
      $('#ab-result').style.display = 'block';
      msg('#ab-msg', r.data.codes.length + ' kód elkészült.', true);
      await load();
    } catch (err) {
      msg('#ab-msg', err.message || 'Hiba történt.');
    } finally { busy = false; }
  });
  $('#ab-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#ab-codes').value); msg('#ab-msg', 'Kimásolva.', true); }
    catch (e) { $('#ab-codes').select(); msg('#ab-msg', 'Jelöld ki és másold ki kézzel.'); }
  });

  async function toggle(c) {
    const r = await postJson('coupon-toggle', { id: c.id, active: !c.active });
    if (!r.ok) { alert(r.data.error || 'Hiba történt.'); return; }
    load();
  }
  async function showUses(c, box) {
    box.textContent = '';
    const r = await api('coupon-redemptions?id=' + encodeURIComponent(c.id));
    if (!r.ok) { box.textContent = 'Hiba a betöltéskor.'; return; }
    if (!r.data.items.length) { box.textContent = 'Még nem használták.'; return; }
    r.data.items.forEach((u) => {
      box.appendChild(el('div', '', new Date(u.createdAt).toLocaleString('hu-HU') + ' · ' + u.order + ' · -'
        + u.amount.toLocaleString('hu-HU') + ' Ft · ' + u.status.toUpperCase()));
    });
  }

  function render() {
    listBox.textContent = '';
    if (!items.length) { listBox.appendChild(el('div', 'ac-item', 'Még nincs kupon.')); return; }
    items.forEach((c) => {
      const card = el('div', 'ac-item' + (c.active ? '' : ' off'));
      card.appendChild(el('b', '', c.code));
      card.appendChild(el('div', '', valueText(c) + (c.minOrder ? ' · MIN. ' + c.minOrder.toLocaleString('hu-HU') + ' Ft' : '')
        + ' · ' + (c.active ? 'AKTÍV' : 'KIKAPCSOLVA')));
      card.appendChild(el('div', '', 'FELHASZNÁLVA: ' + c.used + (c.maxUses ? ' / ' + c.maxUses : ' (korlátlan)')
        + (c.reserved ? ' · FOGLALT: ' + c.reserved : '') + (c.oncePerEmail ? ' · E-MAILENKÉNT 1×' : '')));
      if (c.startsAt || c.expiresAt) {
        card.appendChild(el('div', '', (c.startsAt ? 'KEZDET: ' + new Date(c.startsAt).toLocaleString('hu-HU') + '  ' : '')
          + (c.expiresAt ? 'LEJÁR: ' + new Date(c.expiresAt).toLocaleString('hu-HU') : '')));
      }
      if (c.note) card.appendChild(el('div', '', 'MEGJEGYZÉS: ' + c.note));
      const edit = el('button', 'btn', 'Szerkesztés'); edit.type = 'button';
      edit.addEventListener('click', () => openForm(c));
      const tg = el('button', 'btn' + (c.active ? ' danger' : ''), c.active ? 'Kikapcsolás' : 'Bekapcsolás'); tg.type = 'button';
      tg.addEventListener('click', () => toggle(c));
      const uses = el('button', 'btn', 'Felhasználások'); uses.type = 'button';
      const usesBox = el('div', ''); usesBox.style.marginTop = '.5rem';
      uses.addEventListener('click', () => showUses(c, usesBox));
      card.append(edit, tg, uses, usesBox);
      listBox.appendChild(card);
    });
  }

  async function load() {
    const r = await api('coupons');
    if (!r.ok) return false;
    items = r.data.items;
    render();
    return true;
  }
  (async function init() {
    if (!(await load())) panel.remove(); // nem SUPER ADMIN
  })();
})();
