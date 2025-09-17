// lib/purge.js
async function purgeChannel(client, channelId, { keepPinned = true } = {}) {
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch || !ch.isTextBased()) return { ok: false, reason: 'not_text' };

  let totalDeleted = 0;
  const twoWeeks = 14 * 24 * 60 * 60 * 1000;

  while (true) {
    const batch = await ch.messages.fetch({ limit: 100 }).catch(() => null);
    if (!batch || batch.size === 0) break;

    let deletable = batch;
    if (keepPinned) deletable = deletable.filter(m => !m.pinned);

    const younger = deletable.filter(m => (Date.now() - m.createdTimestamp) < twoWeeks);
    if (younger.size > 0) {
      const deleted = await ch.bulkDelete(younger, true).catch(() => null);
      totalDeleted += deleted?.size ?? 0;
    }
    if (younger.size === 0) break;
  }

  return { ok: true, deleted: totalDeleted };
}

module.exports = { purgeChannel };
