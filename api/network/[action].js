const {
  adminClient, anonClient, sha, hashCode, setSessionCookies, clearSessionCookies,
  getSession, parseCookies, clientIp, allow, sameOrigin, formatMember,
} = require('../../lib/network');

const BAD_CODE = 'Érvénytelen vagy már felhasznált kód.';
const TOO_MANY = 'Túl sok próbálkozás. Próbáld újra később.';
const RESERVED = /^(admin|administrator|moderator|system|zombified|zombifed|network|support|staff|root)$/i;

function postOnly(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return false; }
  if (!sameOrigin(req)) { res.status(403).json({ error: 'Tiltott kérés.' }); return false; }
  if (!String(req.headers['content-type'] || '').includes('application/json')) {
    res.status(415).json({ error: 'Hibás kérés.' }); return false;
  }
  return true;
}

async function codeUsable(admin, hash) {
  const { data } = await admin.from('access_codes').select('status').eq('code_hash', hash).maybeSingle();
  return !!data && (data.status === 'created' || data.status === 'issued');
}

async function checkCode(req, res) {
  if (!postOnly(req, res)) return;
  const admin = adminClient();
  if (!(await allow(admin, 'code:' + sha(clientIp(req)), 10, 900))) {
    return res.status(429).json({ error: TOO_MANY });
  }
  const hash = hashCode(req.body && req.body.code);
  if (!hash || !(await codeUsable(admin, hash))) {
    return res.status(400).json({ valid: false, error: BAD_CODE });
  }
  return res.status(200).json({ valid: true });
}

async function register(req, res) {
  if (!postOnly(req, res)) return;
  const admin = adminClient();
  if (!(await allow(admin, 'reg:' + sha(clientIp(req)), 6, 900))) {
    return res.status(429).json({ error: TOO_MANY });
  }

  const b = req.body || {};
  const hash = hashCode(b.code);
  const email = String(b.email || '').trim().toLowerCase();
  const username = String(b.username || '').trim();
  const password = String(b.password || '');

  if (!b.acceptPrivacy || !b.acceptTerms) {
    return res.status(400).json({ error: 'El kell fogadnod az adatkezelési tájékoztatót és a felhasználási feltételeket.' });
  }
  if (email.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Érvénytelen e-mail-cím.' });
  }
  if (!/^[A-Za-z0-9_.-]{3,20}$/.test(username) || RESERVED.test(username) || /^subject/i.test(username)) {
    return res.status(400).json({ error: 'A felhasználónév 3-20 karakter lehet (betű, szám, _ . -), és nem lehet foglalt név.' });
  }
  if (password.length < 10 || password.length > 128) {
    return res.status(400).json({ error: 'A jelszó legalább 10 karakter legyen.' });
  }
  if (!hash || !(await codeUsable(admin, hash))) {
    return res.status(400).json({ error: BAD_CODE });
  }

  const { data: taken } = await admin
    .from('network_users').select('id').eq('username_lower', username.toLowerCase()).maybeSingle();
  if (taken) return res.status(409).json({ error: 'Ez a felhasználónév már foglalt.' });

  // 1) hitelesítési fiók (e-mail megerősítés nélkül, a kártyakód a belépő)
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (cErr) {
    if (cErr.code === 'email_exists' || cErr.status === 422) {
      return res.status(409).json({ error: 'Ezzel az e-mail-címmel már létezik fiók.' });
    }
    console.error(cErr);
    return res.status(400).json({ error: 'A fiók létrehozása nem sikerült.' });
  }
  const userId = created.user.id;

  // 2) atomikus kódaktiválás + tagazonosító; hiba esetén a fiókot töröljük, a kód megmarad
  const { data: memberNo, error: rErr } = await admin.rpc('activate_membership', {
    p_code_hash: hash, p_user_id: userId, p_username: username,
  });
  if (rErr) {
    try { await admin.auth.admin.deleteUser(userId); } catch (e) { console.error(e); }
    if (/CODE_UNAVAILABLE/.test(rErr.message || '')) return res.status(400).json({ error: BAD_CODE });
    if (rErr.code === '23505') return res.status(409).json({ error: 'Ez a felhasználónév már foglalt.' });
    throw rErr;
  }

  const label = 'SUBJECT ' + String(memberNo).padStart(4, '0');
  const { data: s } = await anonClient().auth.signInWithPassword({ email, password });
  if (s && s.session) {
    setSessionCookies(res, s.session);
    return res.status(200).json({ ok: true, loggedIn: true, label });
  }
  return res.status(200).json({ ok: true, loggedIn: false, label });
}

async function login(req, res) {
  if (!postOnly(req, res)) return;
  const admin = adminClient();
  const email = String((req.body && req.body.email) || '').trim().toLowerCase().slice(0, 200);
  const password = String((req.body && req.body.password) || '').slice(0, 128);

  const okIp = await allow(admin, 'login-ip:' + sha(clientIp(req)), 20, 900);
  const okEm = await allow(admin, 'login-em:' + sha(email), 8, 900);
  if (!okIp || !okEm) return res.status(429).json({ error: TOO_MANY });

  const { data, error } = await anonClient().auth.signInWithPassword({ email, password });
  if (error || !data || !data.session) return res.status(401).json({ error: 'Hibás e-mail-cím vagy jelszó.' });

  const { data: member } = await admin
    .from('network_users')
    .select('id, member_number, username, status, created_at')
    .eq('id', data.user.id).maybeSingle();
  if (!member) return res.status(401).json({ error: 'Hibás e-mail-cím vagy jelszó.' });
  if (member.status !== 'active') return res.status(403).json({ error: 'A fiók jelenleg nem elérhető.' });

  setSessionCookies(res, data.session);
  await admin.from('network_activity').insert({ user_id: member.id, type: 'login' });
  return res.status(200).json({ member: formatMember(member) });
}

async function logout(req, res) {
  if (!postOnly(req, res)) return;
  const at = parseCookies(req).nd_at;
  if (at) { try { await adminClient().auth.admin.signOut(at); } catch (e) { /* nem kritikus */ } }
  clearSessionCookies(res);
  return res.status(200).json({ ok: true });
}

async function me(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const s = await getSession(req, res);
  if (!s) { clearSessionCookies(res); return res.status(401).json({ error: 'Nincs bejelentkezve.' }); }
  return res.status(200).json({ member: formatMember(s.member) });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    switch (String(req.query.action || '')) {
      case 'check-code': return await checkCode(req, res);
      case 'register': return await register(req, res);
      case 'login': return await login(req, res);
      case 'logout': return await logout(req, res);
      case 'me': return await me(req, res);
      default: return res.status(404).json({ error: 'Not found' });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Szerverhiba, próbáld újra.' });
  }
};
