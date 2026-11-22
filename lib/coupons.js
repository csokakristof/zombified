const crypto = require('crypto');
const { sameOrigin } = require('./network');
const { audit } = require('./admin');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_RE = /^[A-Z0-9-]{3,32}$/;
const KINDS = ['percent', 'fixed', 'free_shipping'];
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // félreolvasható karakterek nélkül
const ACTIONS = ['coupons', 'coupon-save', 'coupon-bulk', 'coupon-toggle', 'coupon-redemptions'];

function needPost(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return false; }
  if (!sameOrigin(req)) { res.status(403).json({ error: 'Tiltott kérés.' }); return false; }
  if (!String(req.headers['content-type'] || '').includes('application/json')) {
    res.status(415).json({ error: 'Hibás kérés.' }); return false;
  }
  return true;
}

const normCode = (v) => String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, '').slice(0, 32);

function parseDate(v) {
  if (v == null || v === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d; // undefined = érvénytelen
}

// ZMB-XXXXX-XXXXX: 10 véletlen jel (~49 bit), a próbálkozások korlátozottak
function genCode(prefix) {
  let s = '';
  for (let i = 0; i < 10; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return prefix + '-' + s.slice(0, 5) + '-' + s.slice(5);
}

function readSettings(b) {
  const kind = String(b.kind || '');
  if (!KINDS.includes(kind)) return { error: 'Érvénytelen típus.' };
  let value = 0;
  if (kind === 'percent') {
    value = parseInt(b.value, 10);
    if (!(value >= 1 && value <= 90)) return { error: 'A százalék 1 és 90 között legyen.' };
  }
  if (kind === 'fixed') {
    value = parseInt(b.value, 10);
    if (!(value >= 1 && value <= 1000000)) return { error: 'Az összeg 1 és 1 000 000 Ft között legyen.' };
  }
  let maxUses = null;
  if (b.maxUses !== null && b.maxUses !== undefined && String(b.maxUses).trim() !== '') {
    maxUses = parseInt(b.maxUses, 10);
    if (!(maxUses >= 1 && maxUses <= 1000000)) return { error: 'Érvénytelen felhasználási korlát.' };
  }
  const minOrder = (b.minOrder === '' || b.minOrder == null) ? 0 : parseInt(b.minOrder, 10);
  if (!(minOrder >= 0 && minOrder <= 10000000)) return { error: 'Érvénytelen minimum rendelési érték.' };
  const startsAt = parseDate(b.startsAt);
  const expiresAt = parseDate(b.expiresAt);
  if (startsAt === undefined || expiresAt === undefined) return { error: 'Érvénytelen dátum.' };
  if (startsAt && expiresAt && expiresAt <= startsAt) return { error: 'A lejárat a kezdet után legyen.' };
  const note = String(b.note || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
  return {
    ok: {
      kind, value, max_uses: maxUses, once_per_email: b.oncePerEmail !== false, min_order: minOrder,
      starts_at: startsAt ? startsAt.toISOString() : null,
      expires_at: expiresAt ? expiresAt.toISOString() : null,
      note,
    },
  };
}

// true = az akciót kezeltük (a választ is elküldtük)
async function handleCouponAction(action, req, res, db, a) {
  if (!ACTIONS.includes(action)) return false;
  if (a.role !== 'super_admin') { res.status(404).json({ error: 'Not found' }); return true; }

  if (action === 'coupons') {
    if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return true; }
    const [cs, rs] = await Promise.all([
      db.from('coupons')
        .select('id,code,kind,value,max_uses,once_per_email,min_order,starts_at,expires_at,active,note,created_at')
        .order('created_at', { ascending: false }).limit(300),
      db.from('coupon_redemptions').select('coupon_id,status').limit(20000),
    ]);
    [cs, rs].forEach((r) => { if (r.error) throw r.error; });
    const tally = new Map();
    rs.data.forEach((x) => {
      const t = tally.get(x.coupon_id) || { redeemed: 0, reserved: 0 };
      if (x.status === 'redeemed') t.redeemed++;
      if (x.status === 'reserved') t.reserved++;
      tally.set(x.coupon_id, t);
    });
    res.status(200).json({
      items: cs.data.map((c) => ({
        id: c.id, code: c.code, kind: c.kind, value: c.value, maxUses: c.max_uses,
        oncePerEmail: c.once_per_email, minOrder: c.min_order, startsAt: c.starts_at,
        expiresAt: c.expires_at, active: c.active, note: c.note,
        used: (tally.get(c.id) || { redeemed: 0 }).redeemed,
        reserved: (tally.get(c.id) || { reserved: 0 }).reserved,
      })),
    });
    return true;
  }

  if (action === 'coupon-save') {
    if (!needPost(req, res)) return true;
    const b = req.body || {};
    const st = readSettings(b);
    if (st.error) { res.status(400).json({ error: st.error }); return true; }
    const id = b.id ? String(b.id) : null;
    if (id && !UUID.test(id)) { res.status(400).json({ error: 'Hibás azonosító.' }); return true; }

    if (id) {
      const { error } = await db.from('coupons').update({ ...st.ok, active: b.active !== false }).eq('id', id);
      if (error) {
        if (error.code === '23514') { res.status(400).json({ error: 'Érvénytelen adatok.' }); return true; }
        throw error;
      }
      await audit(db, a.member.id, 'coupon.save', 'coupon', id, { created: false });
      res.status(200).json({ id });
      return true;
    }

    const code = normCode(b.code);
    if (!CODE_RE.test(code)) {
      res.status(400).json({ error: 'A kód 3–32 karakter lehet (A–Z, 0–9, kötőjel).' });
      return true;
    }
    const { data, error } = await db.from('coupons')
      .insert({ code, ...st.ok, active: b.active !== false, created_by: a.member.id })
      .select('id').single();
    if (error) {
      if (error.code === '23505') { res.status(409).json({ error: 'Ez a kód már létezik.' }); return true; }
      if (error.code === '23514') { res.status(400).json({ error: 'Érvénytelen adatok.' }); return true; }
      throw error;
    }
    await audit(db, a.member.id, 'coupon.save', 'coupon', data.id, { created: true });
    res.status(200).json({ id: data.id });
    return true;
  }

  if (action === 'coupon-bulk') {
    if (!needPost(req, res)) return true;
    const b = req.body || {};
    const st = readSettings(b);
    if (st.error) { res.status(400).json({ error: st.error }); return true; }
    const count = parseInt(b.count, 10);
    if (!(count >= 1 && count <= 200)) { res.status(400).json({ error: 'A darabszám 1 és 200 között legyen.' }); return true; }
    const prefix = String(b.prefix || 'ZMB').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'ZMB';

    for (let attempt = 0; attempt < 3; attempt++) {
      const set = new Set();
      while (set.size < count) set.add(genCode(prefix));
      const codes = [...set];
      const rows = codes.map((code) => ({
        code, ...st.ok, max_uses: 1, once_per_email: false, active: true, created_by: a.member.id,
      }));
      const { error } = await db.from('coupons').insert(rows);
      if (!error) {
        await audit(db, a.member.id, 'coupon.bulk', 'coupon', null, { count, kind: st.ok.kind });
        res.status(200).json({ codes });
        return true;
      }
      if (error.code !== '23505') throw error;
    }
    res.status(500).json({ error: 'Kódgenerálási hiba, próbáld újra.' });
    return true;
  }

  if (action === 'coupon-toggle') {
    if (!needPost(req, res)) return true;
    const id = String((req.body && req.body.id) || '');
    if (!UUID.test(id)) { res.status(400).json({ error: 'Hibás azonosító.' }); return true; }
    const active = !!(req.body && req.body.active);
    const { error } = await db.from('coupons').update({ active }).eq('id', id);
    if (error) throw error;
    await audit(db, a.member.id, 'coupon.toggle', 'coupon', id, { active });
    res.status(200).json({ ok: true });
    return true;
  }

  // coupon-redemptions
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return true; }
  const id = String(req.query.id || '');
  if (!UUID.test(id)) { res.status(400).json({ error: 'Hibás azonosító.' }); return true; }
  const { data, error } = await db.from('coupon_redemptions')
    .select('status,amount,created_at,redeemed_at,orders(order_number)')
    .eq('coupon_id', id).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  res.status(200).json({
    items: data.map((r) => ({
      status: r.status, amount: r.amount, createdAt: r.created_at, redeemedAt: r.redeemed_at,
      order: r.orders ? r.orders.order_number : '—',
    })),
  });
  return true;
}

module.exports = { handleCouponAction };
