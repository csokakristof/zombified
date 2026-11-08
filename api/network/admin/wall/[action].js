const { adminClient, sameOrigin } = require('../../../../lib/network');
const { getAdminSession, audit } = require('../../../../lib/admin');
const { removeWallPost } = require('../../../../lib/wall');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function needPost(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return false; }
  if (!sameOrigin(req)) { res.status(403).json({ error: 'Tiltott kérés.' }); return false; }
  if (!String(req.headers['content-type'] || '').includes('application/json')) {
    res.status(415).json({ error: 'Hibás kérés.' }); return false;
  }
  return true;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const a = await getAdminSession(req, res);
    if (!a) return res.status(404).json({ error: 'Not found' });
    const db = adminClient();

    switch (String(req.query.action || '')) {
      case 'reports': {
        const { data: reps, error } = await db.from('wall_reports')
          .select('post_id,reason,created_at').order('created_at', { ascending: false }).limit(500);
        if (error) throw error;
        const groups = new Map();
        reps.forEach((r) => {
          const g = groups.get(r.post_id) || { count: 0, reasons: new Set() };
          g.count++; g.reasons.add(r.reason);
          groups.set(r.post_id, g);
        });
        const ids = [...groups.keys()];
        if (!ids.length) return res.status(200).json({ items: [] });

        const { data: posts, error: pErr } = await db.from('wall_posts')
          .select('id,upload_id,caption,situation,created_at,network_users!wall_posts_owner_id_fkey(username,member_number)')
          .in('id', ids).eq('status', 'visible');
        if (pErr) throw pErr;

        const items = posts.map((p) => ({
          postId: p.id,
          imageId: p.upload_id,
          caption: p.caption,
          situation: p.situation,
          createdAt: p.created_at,
          owner: p.network_users ? p.network_users.username : '—',
          reports: groups.get(p.id).count,
          reasons: [...groups.get(p.id).reasons],
        })).sort((x, y) => y.reports - x.reports);
        return res.status(200).json({ items });
      }

      case 'remove': {
        if (!needPost(req, res)) return;
        const postId = String((req.body && req.body.postId) || '');
        if (!UUID.test(postId)) return res.status(400).json({ error: 'Hibás kérés.' });
        const { data: p } = await db.from('wall_posts').select('id,owner_id,week_start').eq('id', postId).maybeSingle();
        if (!p) return res.status(404).json({ error: 'A kép nem található.' });

        const ok = await removeWallPost(db, postId, a.member.id);
        if (!ok) return res.status(404).json({ error: 'A kép már el van távolítva.' });

        // Ha ez volt egy hét győztese, a győzelem is visszavonódik
        const { data: revoked } = await db.from('wall_weeks')
          .update({ winner_post_id: null }).eq('winner_post_id', postId).select('week_start');
        await audit(db, a.member.id, 'wall.remove', 'wall_post', postId, {
          owner_id: p.owner_id, win_revoked: !!(revoked && revoked.length),
        });
        return res.status(200).json({ ok: true });
      }

      case 'dismiss': {
        if (!needPost(req, res)) return;
        const postId = String((req.body && req.body.postId) || '');
        if (!UUID.test(postId)) return res.status(400).json({ error: 'Hibás kérés.' });
        const { error } = await db.from('wall_reports').delete().eq('post_id', postId);
        if (error) throw error;
        await audit(db, a.member.id, 'wall.dismiss', 'wall_post', postId, {});
        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(404).json({ error: 'Not found' });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Szerverhiba, próbáld újra.' });
  }
};
