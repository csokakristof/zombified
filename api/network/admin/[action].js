const { adminClient, sameOrigin } = require('../../../lib/network');
const { getAdminSession, audit, label } = require('../../../lib/admin');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUCKET = 'network-media';

async function cnt(db, table, col, val) {
  let q = db.from(table).select('id', { count: 'exact', head: true });
  if (col) q = q.eq(col, val);
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
}

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
    // Nem admin: mindenre ugyanaz a válasz, nem áruljuk el, hogy van-e ilyen felület
    const a = await getAdminSession(req, res);
    if (!a) return res.status(404).json({ error: 'Not found' });
    const db = adminClient();
    const isSuper = a.role === 'super_admin';

    switch (String(req.query.action || '')) {
      case 'whoami':
        return res.status(200).json({ role: a.role, label: label(a.member.member_number), username: a.member.username });

      case 'stats': {
        const items = [
          ['TAGOK', await cnt(db, 'network_users')],
          ['AKTÍV', await cnt(db, 'network_users', 'status', 'active')],
          ['FELFÜGGESZTETT', await cnt(db, 'network_users', 'status', 'suspended')],
          ['KÉPEK', await cnt(db, 'uploads', 'status', 'ready')],
        ];
        if (isSuper) {
          items.push(
            ['KÓD: ISSUED', await cnt(db, 'access_codes', 'status', 'issued')],
            ['KÓD: CREATED', await cnt(db, 'access_codes', 'status', 'created')],
            ['KÓD: REDEEMED', await cnt(db, 'access_codes', 'status', 'redeemed')],
            ['KÓD: REVOKED', await cnt(db, 'access_codes', 'status', 'revoked')],
            ['FIZETETT RENDELÉS', await cnt(db, 'orders', 'status', 'paid')]
          );
        }
        return res.status(200).json({ items });
      }

      case 'uploads': {
        const { data, error } = await db
          .from('uploads')
          .select('id,purpose,bytes,width,height,created_at,network_users!uploads_owner_id_fkey(username,member_number)')
          .eq('status', 'ready')
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) throw error;
        return res.status(200).json({
          items: data.map((u) => ({
            id: u.id, purpose: u.purpose, bytes: u.bytes, width: u.width, height: u.height,
            createdAt: u.created_at,
            owner: u.network_users ? u.network_users.username + ' (' + label(u.network_users.member_number) + ')' : '—',
          })),
        });
      }

      case 'upload-remove': {
        if (!needPost(req, res)) return;
        const id = String((req.body && req.body.id) || '');
        if (!UUID.test(id)) return res.status(400).json({ error: 'Érvénytelen azonosító.' });

        const { data: row } = await db.from('uploads').select('id,path,status,owner_id,purpose').eq('id', id).maybeSingle();
        if (!row || row.status !== 'ready') return res.status(404).json({ error: 'A kép nem található.' });

        // Először elrejtjük, így akkor sem marad látható, ha a tárolóból törlés hibázna
        const { error: uErr } = await db.from('uploads')
          .update({ status: 'removed', removed_at: new Date().toISOString(), removed_by: a.member.id }).eq('id', id);
        if (uErr) throw uErr;
        const { error: rErr } = await db.storage.from(BUCKET).remove([row.path]);
        if (rErr) console.error('Tárolóból törlés hiba', rErr);

        await audit(db, a.member.id, 'upload.remove', 'upload', id, { purpose: row.purpose, owner_id: row.owner_id });
        return res.status(200).json({ ok: true });
      }

      case 'audit': {
        if (!isSuper) return res.status(404).json({ error: 'Not found' });
        const { data, error } = await db
          .from('admin_audit_logs')
          .select('id,action,target_type,target_id,created_at,network_users(username,member_number)')
          .order('created_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        return res.status(200).json({
          items: data.map((l) => ({
            id: l.id, action: l.action, target: [l.target_type, l.target_id].filter(Boolean).join(' '),
            createdAt: l.created_at,
            admin: l.network_users ? l.network_users.username : '—',
          })),
        });
      }

      default:
        return res.status(404).json({ error: 'Not found' });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Szerverhiba, próbáld újra.' });
  }
};
