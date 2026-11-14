const crypto = require('crypto');
const { adminClient, getSession, sameOrigin, allow } = require('../../../lib/network');
const { getAdminSession, audit, label } = require('../../../lib/admin');
const { answerHash, removeUploadFile, signPaths } = require('../../../lib/missions');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MCOLS = 'id,title,description,kind,status,starts_at,ends_at,reward_text,max_attempts,created_at,uploads(path)';

function needPost(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return false; }
  if (!sameOrigin(req)) { res.status(403).json({ error: 'Tiltott kérés.' }); return false; }
  if (!String(req.headers['content-type'] || '').includes('application/json')) {
    res.status(415).json({ error: 'Hibás kérés.' }); return false;
  }
  return true;
}

function parseDate(v) {
  if (v == null || v === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d; // undefined = érvénytelen
}

// ---------- Tagi műveletek ----------

async function list(req, res, db, s) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const me = s.member.id;
  const nowIso = new Date().toISOString();

  const [act, subs, atts] = await Promise.all([
    db.from('missions').select(MCOLS).eq('status', 'active')
      .or('starts_at.is.null,starts_at.lte.' + nowIso)
      .order('created_at', { ascending: false }).limit(100),
    db.from('mission_submissions').select('mission_id,status,note').eq('user_id', me),
    db.from('mission_attempts').select('mission_id,attempts').eq('user_id', me),
  ]);
  [act, subs, atts].forEach((r) => { if (r.error) throw r.error; });

  const subMap = new Map(subs.data.map((x) => [x.mission_id, x]));
  const attMap = new Map(atts.data.map((x) => [x.mission_id, x.attempts]));

  // Archivált küldetések is látszanak annak, aki már beküldött hozzájuk (vázlat soha)
  const have = new Set(act.data.map((m) => m.id));
  const extraIds = subs.data.map((x) => x.mission_id).filter((id) => !have.has(id));
  let extra = [];
  if (extraIds.length) {
    const r = await db.from('missions').select(MCOLS).in('id', extraIds).neq('status', 'draft');
    if (r.error) throw r.error;
    extra = r.data;
  }
  const all = act.data.concat(extra);
  const urls = await signPaths(db, all.map((m) => m.uploads && m.uploads.path));
  const now = Date.now();

  const items = all.map((m) => {
    const sub = subMap.get(m.id) || null;
    const ended = !!m.ends_at && new Date(m.ends_at).getTime() <= now;
    const closed = m.status !== 'active' || ended;
    const done = !!sub && sub.status === 'approved';
    const path = m.uploads && m.uploads.path;
    return {
      id: m.id,
      title: m.title,
      description: m.description,
      kind: m.kind,
      startsAt: m.starts_at,
      endsAt: m.ends_at,
      state: done ? 'done' : (closed ? 'ended' : 'open'),
      coverUrl: (path && urls.get(path)) || null,
      mine: sub ? { status: sub.status, note: sub.status === 'rejected' ? sub.note : '' } : null,
      reward: done ? m.reward_text : '',
      attemptsLeft: (m.kind === 'riddle' && !closed && !sub)
        ? Math.max(0, m.max_attempts - (attMap.get(m.id) || 0)) : null,
    };
  });

  const ORDER = { open: 0, done: 1, ended: 2 };
  const end = (x) => (x.endsAt ? new Date(x.endsAt).getTime() : Infinity);
  items.sort((a, b) => {
    if (ORDER[a.state] !== ORDER[b.state]) return ORDER[a.state] - ORDER[b.state];
    const ea = end(a), eb = end(b);
    return ea < eb ? -1 : ea > eb ? 1 : 0;
  });
  return res.status(200).json({ items });
}

async function answer(req, res, db, s) {
  if (!needPost(req, res)) return;
  const me = s.member.id;
  if (!(await allow(db, 'mis-ans:' + me, 40, 3600))) {
    return res.status(429).json({ error: 'Túl sok próbálkozás. Próbáld újra később.' });
  }
  const b = req.body || {};
  const id = String(b.missionId || '');
  if (!UUID.test(id)) return res.status(400).json({ error: 'Hibás kérés.' });
  const hash = answerHash(id, b.answer);
  if (!hash) return res.status(400).json({ error: 'Írj be egy választ.' });

  const { data, error } = await db.rpc('mission_try_answer', { p_user: me, p_mission: id, p_hash: hash });
  if (error) throw error;
  const r = String(data || '');

  if (r === 'correct') {
    const { data: m } = await db.from('missions').select('reward_text').eq('id', id).maybeSingle();
    return res.status(200).json({ correct: true, reward: m ? m.reward_text : '' });
  }
  if (r.startsWith('wrong:')) return res.status(200).json({ correct: false, attemptsLeft: Number(r.slice(6)) });
  if (r === 'locked') return res.status(429).json({ error: 'Elfogytak a próbálkozásaid ennél a küldetésnél.' });
  if (r === 'done') return res.status(409).json({ error: 'Ezt a küldetést már teljesítetted.' });
  return res.status(409).json({ error: 'Ez a küldetés már nem elérhető.' });
}

async function submit(req, res, db, s) {
  if (!needPost(req, res)) return;
  const me = s.member.id;
  if (!(await allow(db, 'mis-sub:' + me, 10, 3600))) {
    return res.status(429).json({ error: 'Túl sok próbálkozás. Próbáld újra később.' });
  }
  const b = req.body || {};
  const missionId = String(b.missionId || '');
  const uploadId = String(b.uploadId || '');
  if (!UUID.test(missionId) || !UUID.test(uploadId)) return res.status(400).json({ error: 'Hibás kérés.' });

  const { data: prev } = await db.from('mission_submissions')
    .select('upload_id,status').eq('mission_id', missionId).eq('user_id', me).maybeSingle();

  const { data, error } = await db.rpc('mission_submit_photo', {
    p_user: me, p_mission: missionId, p_upload: uploadId,
  });
  if (error) {
    const m = String(error.message || '');
    if (/MISSION_CLOSED/.test(m)) return res.status(409).json({ error: 'Ez a küldetés nem elérhető.' });
    if (/ALREADY_SUBMITTED/.test(m)) return res.status(409).json({ error: 'Ehhez a küldetéshez már beküldtél képet.' });
    if (/UPLOAD_INVALID/.test(m)) return res.status(400).json({ error: 'Érvénytelen kép.' });
    if (error.code === '23505') return res.status(409).json({ error: 'Ez a kép már be van küldve.' });
    throw error;
  }
  // Újrabeküldésnél a korábbi, elutasított kép törlődik
  if (prev && prev.status === 'rejected' && prev.upload_id && prev.upload_id !== uploadId) {
    await removeUploadFile(db, prev.upload_id, me);
  }
  return res.status(200).json({ id: data });
}

// Feltöltött, de be nem küldött kép takarítása (ha a beküldés hibázik)
async function discard(req, res, db, s) {
  if (!needPost(req, res)) return;
  const id = String((req.body && req.body.uploadId) || '');
  if (!UUID.test(id)) return res.status(400).json({ error: 'Hibás kérés.' });
  const { data: u } = await db.from('uploads').select('id,owner_id,purpose,status').eq('id', id).maybeSingle();
  if (!u || u.owner_id !== s.member.id || u.purpose !== 'mission' || u.status !== 'ready') {
    return res.status(404).json({ error: 'Nem található.' });
  }
  const [used, cover] = await Promise.all([
    db.from('mission_submissions').select('id').eq('upload_id', id).limit(1),
    db.from('missions').select('id').eq('cover_upload_id', id).limit(1),
  ]);
  if ((used.data && used.data.length) || (cover.data && cover.data.length)) {
    return res.status(400).json({ error: 'A kép használatban van.' });
  }
  await removeUploadFile(db, id, s.member.id);
  return res.status(200).json({ ok: true });
}

async function mystats(req, res, db, s) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { count, error } = await db.from('mission_submissions')
    .select('id', { count: 'exact', head: true }).eq('user_id', s.member.id).eq('status', 'approved');
  if (error) throw error;
  return res.status(200).json({ completed: count || 0 });
}

// ---------- Admin műveletek ----------

async function adminList(req, res, db, a) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const [ms, subs] = await Promise.all([
    db.from('missions')
      .select('id,title,description,kind,status,cover_upload_id,starts_at,ends_at,reward_text,max_attempts,answer_hash,created_at')
      .order('created_at', { ascending: false }).limit(100),
    db.from('mission_submissions').select('mission_id,status').limit(5000),
  ]);
  [ms, subs].forEach((r) => { if (r.error) throw r.error; });
  const tally = new Map();
  subs.data.forEach((x) => {
    const t = tally.get(x.mission_id) || { pending: 0, approved: 0, rejected: 0 };
    t[x.status]++;
    tally.set(x.mission_id, t);
  });
  return res.status(200).json({
    role: a.role,
    items: ms.data.map((m) => ({
      id: m.id, title: m.title, description: m.description, kind: m.kind, status: m.status,
      startsAt: m.starts_at, endsAt: m.ends_at, rewardText: m.reward_text, maxAttempts: m.max_attempts,
      hasAnswer: !!m.answer_hash, hasCover: !!m.cover_upload_id,
      counts: tally.get(m.id) || { pending: 0, approved: 0, rejected: 0 },
    })),
  });
}

async function adminSave(req, res, db, a) {
  if (!needPost(req, res)) return;
  if (a.role !== 'super_admin') return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};

  const id = b.id ? String(b.id) : null;
  if (id && !UUID.test(id)) return res.status(400).json({ error: 'Hibás azonosító.' });
  const title = String(b.title || '').trim().slice(0, 80);
  const description = String(b.description || '').trim().slice(0, 1000);
  const kind = String(b.kind || '');
  const status = String(b.status || '');
  const rewardText = String(b.rewardText || '').trim().slice(0, 200);
  const maxAttempts = Math.min(50, Math.max(1, parseInt(b.maxAttempts, 10) || 5));
  const startsAt = parseDate(b.startsAt);
  const endsAt = parseDate(b.endsAt);

  if (!title) return res.status(400).json({ error: 'A cím kötelező.' });
  if (!['photo', 'riddle'].includes(kind)) return res.status(400).json({ error: 'Érvénytelen típus.' });
  if (!['draft', 'active', 'archived'].includes(status)) return res.status(400).json({ error: 'Érvénytelen állapot.' });
  if (startsAt === undefined || endsAt === undefined) return res.status(400).json({ error: 'Érvénytelen dátum.' });
  if (startsAt && endsAt && endsAt <= startsAt) return res.status(400).json({ error: 'A vége a kezdet után legyen.' });

  let existing = null;
  if (id) {
    const r = await db.from('missions').select('id,kind,answer_hash').eq('id', id).maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) return res.status(404).json({ error: 'A küldetés nem található.' });
    if (r.data.kind !== kind) return res.status(400).json({ error: 'A küldetés típusa utólag nem módosítható.' });
    existing = r.data;
  }
  const mid = id || crypto.randomUUID();

  const answer = String(b.answer || '');
  let hash = null;
  if (kind === 'riddle' && answer.trim()) {
    hash = answerHash(mid, answer);
    if (!hash) return res.status(400).json({ error: 'A válasz legalább egy betűt vagy számot tartalmazzon.' });
  }
  if (kind === 'riddle' && status === 'active' && !hash && !(existing && existing.answer_hash)) {
    return res.status(400).json({ error: 'Aktív rejtvényhez add meg a helyes választ.' });
  }

  let coverId = null;
  if (b.coverUploadId) {
    const cid = String(b.coverUploadId);
    if (!UUID.test(cid)) return res.status(400).json({ error: 'Hibás borítókép.' });
    const { data: u } = await db.from('uploads').select('id,owner_id,purpose,status').eq('id', cid).maybeSingle();
    if (!u || u.owner_id !== a.member.id || u.purpose !== 'mission' || u.status !== 'ready') {
      return res.status(400).json({ error: 'Érvénytelen borítókép.' });
    }
    coverId = cid;
  }

  const row = {
    title, description, kind, status, reward_text: rewardText, max_attempts: maxAttempts,
    starts_at: startsAt ? startsAt.toISOString() : null,
    ends_at: endsAt ? endsAt.toISOString() : null,
  };
  if (hash) row.answer_hash = hash;
  if (coverId) row.cover_upload_id = coverId;
  else if (b.removeCover) row.cover_upload_id = null;

  const q = id
    ? db.from('missions').update(row).eq('id', id)
    : db.from('missions').insert({ id: mid, created_by: a.member.id, ...row });
  const { error } = await q;
  if (error) {
    if (error.code === '23514') return res.status(400).json({ error: 'Érvénytelen adatok.' });
    throw error;
  }
  await audit(db, a.member.id, 'mission.save', 'mission', mid, { status, kind, created: !id });
  return res.status(200).json({ id: mid });
}

async function adminPending(req, res, db) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { data, error } = await db.from('mission_submissions')
    .select('id,created_at,upload_id,missions(title),network_users!mission_submissions_user_id_fkey(username,member_number)')
    .eq('status', 'pending').eq('kind', 'photo')
    .order('created_at', { ascending: true }).limit(100);
  if (error) throw error;
  return res.status(200).json({
    items: data.map((x) => ({
      id: x.id,
      imageId: x.upload_id,
      mission: x.missions ? x.missions.title : '—',
      member: x.network_users ? x.network_users.username + ' (' + label(x.network_users.member_number) + ')' : '—',
      createdAt: x.created_at,
    })),
  });
}

async function adminReview(req, res, db, a) {
  if (!needPost(req, res)) return;
  const b = req.body || {};
  const id = String(b.submissionId || '');
  const decision = String(b.decision || '');
  const note = String(b.note || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
  if (!UUID.test(id) || !['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'Hibás kérés.' });

  const { data, error } = await db.from('mission_submissions')
    .update({
      status: decision === 'approve' ? 'approved' : 'rejected',
      note: decision === 'reject' ? note : '',
      reviewed_at: new Date().toISOString(),
      reviewed_by: a.member.id,
    })
    .eq('id', id).eq('status', 'pending').select('id,mission_id').maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ error: 'A beküldés már el van bírálva.' });
  await audit(db, a.member.id, 'mission.review', 'mission_submission', id, { decision, mission_id: data.mission_id });
  return res.status(200).json({ ok: true });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const action = String(req.query.action || '');
    const db = adminClient();

    if (action.startsWith('admin-')) {
      const a = await getAdminSession(req, res);
      if (!a) return res.status(404).json({ error: 'Not found' });
      switch (action) {
        case 'admin-list': return await adminList(req, res, db, a);
        case 'admin-save': return await adminSave(req, res, db, a);
        case 'admin-pending': return await adminPending(req, res, db);
        case 'admin-review': return await adminReview(req, res, db, a);
        default: return res.status(404).json({ error: 'Not found' });
      }
    }

    const s = await getSession(req, res);
    if (!s) return res.status(401).json({ error: 'Nincs bejelentkezve.' });
    switch (action) {
      case 'list': return await list(req, res, db, s);
      case 'answer': return await answer(req, res, db, s);
      case 'submit': return await submit(req, res, db, s);
      case 'discard': return await discard(req, res, db, s);
      case 'mystats': return await mystats(req, res, db, s);
      default: return res.status(404).json({ error: 'Not found' });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Szerverhiba, próbáld újra.' });
  }
};
