const BUCKET = 'network-media';

// Kép eltávolítása a faliújságról: poszt és feltöltés elrejtése, fájl törlése a tárolóból
async function removeWallPost(db, postId, byUserId) {
  const { data: p } = await db.from('wall_posts').select('id,upload_id,status').eq('id', postId).maybeSingle();
  if (!p || p.status !== 'visible') return false;
  const now = new Date().toISOString();

  const { error } = await db.from('wall_posts').update({ status: 'removed', removed_at: now }).eq('id', postId);
  if (error) throw error;

  const { data: u } = await db.from('uploads')
    .update({ status: 'removed', removed_at: now, removed_by: byUserId })
    .eq('id', p.upload_id).select('path').maybeSingle();
  if (u && u.path) {
    const { error: rErr } = await db.storage.from(BUCKET).remove([u.path]);
    if (rErr) console.error('Tárolóból törlés hiba', rErr);
  }
  return true;
}

module.exports = { removeWallPost };
