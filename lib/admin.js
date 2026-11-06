const { adminClient, getSession } = require('./network');

const label = (n) => 'SUBJECT ' + String(n).padStart(4, '0');

async function roleOf(db, userId) {
  const { data } = await db.from('admin_users').select('role').eq('user_id', userId).maybeSingle();
  return data ? data.role : null;
}

// Bejelentkezett tag, akinek admin szerepköre is van; különben null
async function getAdminSession(req, res) {
  const s = await getSession(req, res);
  if (!s) return null;
  const role = await roleOf(adminClient(), s.member.id);
  return role ? { ...s, role } : null;
}

// Naplózás: ne kerüljön bele személyes adat (e-mail, cím, jelszó)
async function audit(db, adminId, action, targetType, targetId, meta) {
  const { error } = await db.from('admin_audit_logs').insert({
    admin_id: adminId,
    action,
    target_type: targetType || null,
    target_id: targetId ? String(targetId) : null,
    meta: meta || {},
  });
  if (error) console.error('audit hiba', error);
}

module.exports = { label, roleOf, getAdminSession, audit };
