const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 jel, félreolvasható karakterek nélkül
const CODE_RE = /^NDN[A-Z0-9]{28}$/;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

const adminClient = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, opts);
const anonClient = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, opts);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// ---------- Aktiváló kód ----------
function normalizeCode(raw) {
  return String(raw == null ? '' : raw).slice(0, 100).toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function hashCode(raw) {
  const n = normalizeCode(raw);
  return CODE_RE.test(n) ? sha(n) : null;
}
// 28 jel x ~4,95 bit = ~138 bit véletlenszerűség
function generateCode() {
  let s = '';
  for (let i = 0; i < 28; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return 'NDN-' + s.match(/.{4}/g).join('-');
}
function encKey() {
  const k = Buffer.from(process.env.CODE_ENCRYPTION_KEY || '', 'base64');
  if (k.length !== 32) throw new Error('CODE_ENCRYPTION_KEY hibás (32 bájt, base64 kell)');
  return k;
}
function encryptCode(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

// Rendelésenként legfeljebb egy kód (unique order_id), ismételt hívásnál nem hoz létre újat
async function ensureMembershipCode(supabase, orderId) {
  const { data: items, error: iErr } = await supabase
    .from('order_items')
    .select('product_id, products(grants_membership)')
    .eq('order_id', orderId);
  if (iErr) throw iErr;
  if (!items || !items.some((i) => i.products && i.products.grants_membership)) return null;

  const { data: existing } = await supabase
    .from('access_codes').select('id').eq('order_id', orderId).maybeSingle();
  if (existing) return existing.id;

  const code = generateCode();
  const { data, error } = await supabase
    .from('access_codes')
    .insert({ order_id: orderId, code_hash: hashCode(code), code_enc: encryptCode(code) })
    .select('id').single();
  if (error && error.code === '23505') return null; // közben másik példány létrehozta
  if (error) throw error;
  return data.id;
}

// ---------- Süti és munkamenet ----------
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) {} }
  });
  return out;
}
const COOKIE_BASE = '; HttpOnly; Secure; SameSite=Strict; Path=/api/network';
function setSessionCookies(res, s) {
  res.setHeader('Set-Cookie', [
    'nd_at=' + encodeURIComponent(s.access_token) + COOKIE_BASE + '; Max-Age=' + Math.max(60, s.expires_in || 3600),
    'nd_rt=' + encodeURIComponent(s.refresh_token) + COOKIE_BASE + '; Max-Age=2592000',
  ]);
}
function clearSessionCookies(res) {
  res.setHeader('Set-Cookie', ['nd_at=' + COOKIE_BASE + '; Max-Age=0', 'nd_rt=' + COOKIE_BASE + '; Max-Age=0']);
}

async function getSession(req, res) {
  const admin = adminClient();
  const c = parseCookies(req);
  let user = null;

  if (c.nd_at) {
    const { data, error } = await admin.auth.getUser(c.nd_at);
    if (!error && data && data.user) user = data.user;
  }
  if (!user && c.nd_rt) {
    const { data, error } = await anonClient().auth.refreshSession({ refresh_token: c.nd_rt });
    if (!error && data && data.session && data.user) {
      setSessionCookies(res, data.session);
      user = data.user;
    }
  }
  if (!user) return null;

  const { data: member } = await admin
    .from('network_users')
    .select('id, member_number, username, status, created_at')
    .eq('id', user.id).maybeSingle();
  if (!member || member.status !== 'active') return null;
  return { user, member };
}

// ---------- Segédek ----------
function clientIp(req) {
  const h = req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || '';
  return String(h).split(',')[0].trim() || 'unknown';
}
// true = megengedett, hiba esetén tiltunk (fail closed)
async function allow(admin, key, limit, windowSec) {
  const { data, error } = await admin.rpc('rate_limit_hit', {
    p_key: key, p_limit: limit, p_window_seconds: windowSec,
  });
  if (error) { console.error(error); return false; }
  return data === true;
}
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch (e) { return false; }
}
function formatMember(m) {
  return {
    number: m.member_number,
    label: 'SUBJECT ' + String(m.member_number).padStart(4, '0'),
    username: m.username,
    joinedAt: m.created_at,
  };
}

module.exports = {
  adminClient, anonClient, sha, hashCode, generateCode, ensureMembershipCode,
  setSessionCookies, clearSessionCookies, getSession, parseCookies,
  clientIp, allow, sameOrigin, formatMember,
};
