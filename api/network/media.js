const { adminClient, getSession } = require('../../lib/network');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const id = String((req.query && req.query.id) || '');
    if (!UUID.test(id)) return res.status(404).end();

    const s = await getSession(req, res);
    if (!s) return res.status(401).end();

    const db = adminClient();
    const { data: row } = await db.from('uploads').select('path,status').eq('id', id).maybeSingle();
    if (!row || row.status !== 'ready') return res.status(404).end();

    const { data, error } = await db.storage.from('network-media').createSignedUrl(row.path, 120);
    if (error || !data) throw error || new Error('Aláírt URL hiba');

    res.setHeader('Location', data.signedUrl);
    return res.status(302).end();
  } catch (e) {
    console.error(e);
    return res.status(500).end();
  }
};
