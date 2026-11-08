const { adminClient, getSession, sameOrigin, allow } = require('../../../lib/network');
const { label } = require('../../../lib/admin');
const { removeWallPost } = require('../../../lib/wall');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SITUATIONS = ['street', 'work', 'travel', 'night', 'sport', 'home'];
const REASONS = ['inappropriate', 'not_mine', 'spam', 'other'];
const PAGE = 24;
const MAX_WEEKLY = 3; // ugyanennek kell lennie, mint az SQL-ben a wall_create_post korlátjának
const BUCKET = 'network-media';
const URL_TTL = 3600; // a képcímek 1 óráig érvényesek
const POST_COLS = 'id,upload_id,caption,situation,week_start,created_at,owner_id,network_users!wall_posts_owner_id_fkey(username,member_number),uploads(path)';

function needPost(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return false; }
  if (!sameOrigin(req)) { res.status(403).json({ error: 'Tiltott kérés.' }); return false; }
  if (!String(req.headers['content-type'] || '').includes('application/json')) {
    res.status(415).json({ error: 'Hibás kérés.' }); return false;
  }
  return true;
}

async function currentWeek(db) {
  const [a, b] = await Promise.all([db.rpc('wall_current_week'), db.rpc('wall_week_end')]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
  return { start: a.data, endsAt: b.data };
}

async function winMap(db) {
  const { data, error } = await db.rpc('wall_win_counts');
  if (error) throw error;
  return new Map((data || []).map((r) => [r.owner_id, r.wins]));
}

// Kész, rövid ideig érvényes képcímek egyetlen kéréssel (nem kell képenként függvényhívás)
async function signUrls(db, posts) {
  const paths = [...new Set(posts.map((p) => p.uploads && p.uploads.path).filter(Boolean))];
  const map = new Map();
  if (!paths.length) return map;
  const { data, error } = await db.storage.from(BUCKET).createSignedUrls(paths, URL_TTL);
  if (error) { console.error(error); return map; }
  (data || []).forEach((d) => { if (d && d.signedUrl && d.path) map.set(d.path, d.signedUrl); });
  return map;
}

function serialize(p, ctx) {
  const cur = p.week_start === ctx.week;
  const o = p.network_users;
  const path = p.uploads && p.uploads.path;
  return {
    id: p.id,
    imageId: p.upload_id,
    imageUrl: (path && ctx.urls.get(path)) || null,
    caption: p.caption,
    situation: p.situation,
    createdAt: p.created_at,
    weekStart: p.week_start,
    current: cur,
    votes: cur ? (ctx.counts.get(p.id) || 0) : null,
    rank: ctx.ranks.get(p.id) || null,
    voted: ctx.myVote === p.id,
    mine: p.owner_id === ctx.me,
    owner: {
      username: o ? o.username : '—',
      label: o ? label(o.member_number) : '',
      wins: ctx.wins.get(p.owner_id) || 0,
    },
  };
}

async function feed(req, res, db, s) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const me = s.member.id;
  const before = req.query.before ? new Date(String(req.query.before)) : null;
  if (before && Number.isNaN(before.getTime())) return res.status(400).json({ error: 'Hibás kérés.' });

  // 1. kör: aktuális hét + lezárt hetek kihirdetése (párhuzamosan)
  const [week, closeRes] = await Promise.all([currentWeek(db), db.rpc('wall_close_due_weeks')]);
  if (closeRes.error) console.error(closeRes.error);

  // 2. kör: minden egyéb adat párhuzamosan
  let olderQ = db.from('wall_posts').select(POST_COLS).eq('status', 'visible')
    .lt('week_start', week.start).order('created_at', { ascending: false }).limit(PAGE + 1);
  if (before) olderQ = olderQ.lt('created_at', before.toISOString());
  const curQ = before
    ? Promise.resolve({ data: [], error: null })
    : db.from('wall_posts').select(POST_COLS).eq('status', 'visible').eq('week_start', week.start)
        .order('created_at', { ascending: true }).limit(150);

  const [older, cur, wins, votesRes, myVoteRes, countRes, lwRes] = await Promise.all([
    olderQ,
    curQ,
    winMap(db),
    db.rpc('wall_week_votes', { p_week: week.start }),
    db.from('wall_votes').select('post_id').eq('week_start', week.start).eq('voter_id', me).maybeSingle(),
    db.from('wall_posts').select('id', { count: 'exact', head: true })
      .eq('owner_id', me).eq('week_start', week.start).eq('status', 'visible'),
    db.from('wall_weeks').select('week_start,vote_count,winner_post_id')
      .not('winner_post_id', 'is', null).order('week_start', { ascending: false }).limit(1).maybeSingle(),
  ]);
  [older, cur, votesRes, myVoteRes, countRes, lwRes].forEach((r) => { if (r.error) throw r.error; });

  const counts = new Map((votesRes.data || []).map((v) => [v.post_id, v.votes]));
  const myVote = myVoteRes.data ? myVoteRes.data.post_id : null;

  // Futó hét: legtöbb szavazat elöl; egyenlőségnél az előbb feltöltött (mint a győztes kihirdetésénél)
  const curPosts = (cur.data || []).slice().sort((a, b) =>
    (counts.get(b.id) || 0) - (counts.get(a.id) || 0) || (a.created_at < b.created_at ? -1 : 1));
  const ranks = new Map();
  curPosts.slice(0, 3).forEach((p, i) => { if ((counts.get(p.id) || 0) > 0) ranks.set(p.id, i + 1); });

  const hasMore = older.data.length > PAGE;
  const posts = curPosts.concat(older.data.slice(0, PAGE));

  // 3. kör: a legutóbbi győztes képe
  let winnerRow = null;
  if (!before && lwRes.data) {
    const { data: wp, error: wErr } = await db.from('wall_posts').select(POST_COLS)
      .eq('id', lwRes.data.winner_post_id).eq('status', 'visible').maybeSingle();
    if (wErr) throw wErr;
    winnerRow = wp || null;
  }

  // 4. kör: képcímek
  const urls = await signUrls(db, winnerRow ? posts.concat([winnerRow]) : posts);
  const ctx = { week: week.start, counts, wins, me, myVote, urls, ranks };

  return res.status(200).json({
    week: {
      start: week.start,
      endsAt: week.endsAt,
      postsLeft: Math.max(0, MAX_WEEKLY - (countRes.count || 0)),
      myVotePostId: myVote,
    },
    winner: winnerRow
      ? { ...serialize(winnerRow, ctx), weekStart: lwRes.data.week_start, votes: lwRes.data.vote_count }
      : null,
    posts: posts.map((p) => serialize(p, ctx)),
    hasMore,
  });
}

async function winners(req, res, db) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const [week, closeRes] = await Promise.all([currentWeek(db), db.rpc('wall_close_due_weeks')]);
  if (closeRes.error) console.error(closeRes.error);

  const { data: ws, error } = await db.from('wall_weeks').select('week_start,vote_count,winner_post_id')
    .not('winner_post_id', 'is', null).order('week_start', { ascending: false }).limit(12);
  if (error) throw error;
  const ids = (ws || []).map((w) => w.winner_post_id);
  let posts = [];
  if (ids.length) {
    const { data, error: pErr } = await db.from('wall_posts').select(POST_COLS).in('id', ids).eq('status', 'visible');
    if (pErr) throw pErr;
    posts = data;
  }
  const [wins, urls] = await Promise.all([winMap(db), signUrls(db, posts)]);
  const byId = new Map(posts.map((p) => [p.id, p]));
  const ctx = { week: week.start, counts: new Map(), wins, me: null, myVote: null, urls, ranks: new Map() };
  const items = (ws || [])
    .filter((w) => byId.has(w.winner_post_id))
    .map((w) => ({ weekStart: w.week_start, votes: w.vote_count, post: serialize(byId.get(w.winner_post_id), ctx) }))
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1)); // legfrissebb győztes elöl
  return res.status(200).json({ items });
}

async function createPost(req, res, db, s) {
  if (!needPost(req, res)) return;
  const me = s.member.id;
  if (!(await allow(db, 'wall-post:' + me, 10, 3600))) {
    return res.status(429).json({ error: 'Túl sok próbálkozás. Próbáld újra később.' });
  }
  const b = req.body || {};
  const uploadId = String(b.uploadId || '');
  const situation = String(b.situation || '');
  const caption = String(b.caption || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 140);
  if (!UUID.test(uploadId) || !SITUATIONS.includes(situation)) {
    return res.status(400).json({ error: 'Hibás kérés.' });
  }
  const { data, error } = await db.rpc('wall_create_post', {
    p_user: me, p_upload: uploadId, p_caption: caption, p_situation: situation,
  });
  if (error) {
    const m = String(error.message || '');
    if (/LIMIT_REACHED/.test(m)) return res.status(429).json({ error: 'Ezen a héten már ' + MAX_WEEKLY + ' képet töltöttél fel.' });
    if (/UPLOAD_INVALID/.test(m)) return res.status(400).json({ error: 'Érvénytelen kép.' });
    if (error.code === '23505') return res.status(409).json({ error: 'Ez a kép már fel van töltve.' });
    throw error;
  }
  return res.status(200).json({ id: data });
}

async function vote(req, res, db, s) {
  if (!needPost(req, res)) return;
  const me = s.member.id;
  if (!(await allow(db, 'wall-vote:' + me, 60, 3600))) {
    return res.status(429).json({ error: 'Túl sok próbálkozás. Próbáld újra később.' });
  }
  const postId = String((req.body && req.body.postId) || '');
  if (!UUID.test(postId)) return res.status(400).json({ error: 'Hibás kérés.' });
  const { error } = await db.rpc('wall_cast_vote', { p_user: me, p_post: postId });
  if (error) {
    const m = String(error.message || '');
    if (/OWN_POST/.test(m)) return res.status(400).json({ error: 'A saját képedre nem szavazhatsz.' });
    if (/VOTING_CLOSED/.test(m)) return res.status(409).json({ error: 'Erre a képre már lezárult a szavazás.' });
    if (/POST_UNAVAILABLE/.test(m)) return res.status(404).json({ error: 'A kép nem érhető el.' });
    throw error;
  }
  return res.status(200).json({ ok: true });
}

async function unvote(req, res, db, s) {
  if (!needPost(req, res)) return;
  const week = await currentWeek(db);
  const { error } = await db.from('wall_votes').delete().eq('week_start', week.start).eq('voter_id', s.member.id);
  if (error) throw error;
  return res.status(200).json({ ok: true });
}

async function deletePost(req, res, db, s) {
  if (!needPost(req, res)) return;
  const postId = String((req.body && req.body.postId) || '');
  if (!UUID.test(postId)) return res.status(400).json({ error: 'Hibás kérés.' });
  const { data: p } = await db.from('wall_posts').select('id,owner_id,status').eq('id', postId).maybeSingle();
  if (!p || p.owner_id !== s.member.id || p.status !== 'visible') {
    return res.status(404).json({ error: 'A kép nem található.' });
  }
  await removeWallPost(db, postId, s.member.id);
  return res.status(200).json({ ok: true });
}

// Feltöltött, de poszttá nem vált kép takarítása (ha a poszt létrehozása hibázik)
async function discard(req, res, db, s) {
  if (!needPost(req, res)) return;
  const id = String((req.body && req.body.uploadId) || '');
  if (!UUID.test(id)) return res.status(400).json({ error: 'Hibás kérés.' });
  const { data: u } = await db.from('uploads').select('id,owner_id,purpose,status,path').eq('id', id).maybeSingle();
  if (!u || u.owner_id !== s.member.id || u.purpose !== 'wall' || u.status !== 'ready') {
    return res.status(404).json({ error: 'Nem található.' });
  }
  const { data: used } = await db.from('wall_posts').select('id').eq('upload_id', id).limit(1);
  if (used && used.length) return res.status(400).json({ error: 'A kép poszthoz tartozik.' });
  await db.from('uploads').update({ status: 'removed', removed_at: new Date().toISOString(), removed_by: s.member.id }).eq('id', id);
  const { error: rErr } = await db.storage.from(BUCKET).remove([u.path]);
  if (rErr) console.error(rErr);
  return res.status(200).json({ ok: true });
}

async function report(req, res, db, s) {
  if (!needPost(req, res)) return;
  const me = s.member.id;
  if (!(await allow(db, 'wall-rep:' + me, 20, 3600))) {
    return res.status(429).json({ error: 'Túl sok jelentés. Próbáld újra később.' });
  }
  const postId = String((req.body && req.body.postId) || '');
  const reason = String((req.body && req.body.reason) || '');
  if (!UUID.test(postId) || !REASONS.includes(reason)) return res.status(400).json({ error: 'Hibás kérés.' });
  const { data: p } = await db.from('wall_posts').select('id,owner_id,status').eq('id', postId).maybeSingle();
  if (!p || p.status !== 'visible') return res.status(404).json({ error: 'A kép nem található.' });
  if (p.owner_id === me) return res.status(400).json({ error: 'A saját képedet nem jelentheted.' });
  const { error } = await db.from('wall_reports')
    .upsert({ post_id: postId, reporter_id: me, reason }, { onConflict: 'post_id,reporter_id', ignoreDuplicates: true });
  if (error) throw error;
  return res.status(200).json({ ok: true });
}

async function mystats(req, res, db, s) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { error: cErr } = await db.rpc('wall_close_due_weeks');
  if (cErr) console.error(cErr);
  const wins = await winMap(db);
  return res.status(200).json({ wins: wins.get(s.member.id) || 0 });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const s = await getSession(req, res);
    if (!s) return res.status(401).json({ error: 'Nincs bejelentkezve.' });
    const db = adminClient();
    switch (String(req.query.action || '')) {
      case 'feed': return await feed(req, res, db, s);
      case 'winners': return await winners(req, res, db);
      case 'post': return await createPost(req, res, db, s);
      case 'vote': return await vote(req, res, db, s);
      case 'unvote': return await unvote(req, res, db, s);
      case 'delete': return await deletePost(req, res, db, s);
      case 'discard': return await discard(req, res, db, s);
      case 'report': return await report(req, res, db, s);
      case 'mystats': return await mystats(req, res, db, s);
      default: return res.status(404).json({ error: 'Not found' });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Szerverhiba, próbáld újra.' });
  }
};
