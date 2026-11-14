const crypto = require('crypto');
const BUCKET = 'network-media';

// Kis- és nagybetű, ékezet, szóköz és írásjel nem számít
function normalizeAnswer(raw) {
  return String(raw == null ? '' : raw)
    .slice(0, 200)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// HMAC: egy adatbázis-szivárgás önmagában nem elég a válasz kitalálásához
function answerHash(missionId, raw) {
  const n = normalizeAnswer(raw);
  if (!n) return null;
  const key = Buffer.from(process.env.CODE_ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) throw new Error('CODE_ENCRYPTION_KEY hibás (32 bájt, base64 kell)');
  return crypto.createHmac('sha256', key).update('mission:' + missionId + ':' + n).digest('hex');
}

async function removeUploadFile(db, uploadId, byUserId) {
  const { data: u } = await db.from('uploads')
    .update({ status: 'removed', removed_at: new Date().toISOString(), removed_by: byUserId })
    .eq('id', uploadId).eq('status', 'ready').select('path').maybeSingle();
  if (u && u.path) {
    const { error } = await db.storage.from(BUCKET).remove([u.path]);
    if (error) console.error('Tárolóból törlés hiba', error);
  }
}

async function signPaths(db, paths, ttl) {
  const list = [...new Set((paths || []).filter(Boolean))];
  const map = new Map();
  if (!list.length) return map;
  const { data, error } = await db.storage.from(BUCKET).createSignedUrls(list, ttl || 3600);
  if (error) { console.error(error); return map; }
  (data || []).forEach((d) => { if (d && d.signedUrl && d.path) map.set(d.path, d.signedUrl); });
  return map;
}

module.exports = { normalizeAnswer, answerHash, removeUploadFile, signPaths };
