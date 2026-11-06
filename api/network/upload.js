const crypto = require('crypto');
const sharp = require('sharp');
const { adminClient, getSession, sameOrigin, allow } = require('../../lib/network');
const { roleOf } = require('../../lib/admin');

const MAX_IN = 4000000; // a Vercel kérésméret-korlátja miatt
const BUCKET = 'network-media';
// true = csak admin használhatja
const PURPOSES = { wall: false, community: false, mission: false, avatar: false, scenes: true, test: true };
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    const onData = (c) => {
      n += c.length;
      if (n > max) {
        req.removeListener('data', onData);
        req.resume();
        reject(Object.assign(new Error('too_large'), { code: 'TOO_LARGE' }));
        return;
      }
      chunks.push(c);
    };
    req.on('data', onData);
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// A kliens által megadott típusban nem bízunk: a fájl első bájtjait nézzük
function sniff(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Tiltott kérés.' });

  try {
    const purpose = new URL(req.url, 'http://x').searchParams.get('purpose') || '';
    if (!Object.prototype.hasOwnProperty.call(PURPOSES, purpose)) {
      return res.status(400).json({ error: 'Érvénytelen cél.' });
    }

    const s = await getSession(req, res);
    if (!s) return res.status(401).json({ error: 'Nincs bejelentkezve.' });

    const db = adminClient();
    if (PURPOSES[purpose] && !(await roleOf(db, s.member.id))) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (!(await allow(db, 'up:' + s.member.id, 20, 3600))) {
      return res.status(429).json({ error: 'Túl sok feltöltés. Próbáld újra később.' });
    }

    const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!TYPES.includes(ctype)) return res.status(415).json({ error: 'Csak JPG, PNG vagy WebP kép tölthető fel.' });
    if (Number(req.headers['content-length'] || 0) > MAX_IN) {
      return res.status(413).json({ error: 'A kép túl nagy.' });
    }

    let buf;
    try {
      buf = await readBody(req, MAX_IN);
    } catch (e) {
      if (e.code === 'TOO_LARGE') return res.status(413).json({ error: 'A kép túl nagy.' });
      throw e;
    }
    if (!sniff(buf)) return res.status(415).json({ error: 'A fájl nem érvényes kép.' });

    // Újraképzés: metaadat (GPS, EXIF) törlése, méretkorlát, egységes WebP formátum
    let out;
    try {
      out = await sharp(buf, { limitInputPixels: 40000000, failOn: 'error' })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer({ resolveWithObject: true });
    } catch (e) {
      return res.status(400).json({ error: 'A fájl nem érvényes kép.' });
    }

    const id = crypto.randomUUID();
    const path = purpose + '/' + s.member.id + '/' + id + '.webp';

    const { error: uErr } = await db.storage.from(BUCKET).upload(path, out.data, {
      contentType: 'image/webp', upsert: false, cacheControl: '3600',
    });
    if (uErr) throw uErr;

    const { error: iErr } = await db.from('uploads').insert({
      id, owner_id: s.member.id, purpose, path,
      bytes: out.info.size, width: out.info.width, height: out.info.height,
    });
    if (iErr) {
      await db.storage.from(BUCKET).remove([path]);
      throw iErr;
    }
    return res.status(200).json({ id, width: out.info.width, height: out.info.height });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Szerverhiba, próbáld újra.' });
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
