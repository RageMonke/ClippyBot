// lib/uitgaanStore.js
// In-memory store for pending "Uitgaan" confirmations.
// API: savePending(token, data, ttlMs?), getPending(token), deletePending(token)
//
// Expected `data` shape:
// { guildId: string, channelId: string, allowUserId: string, plan: object }

const PENDING = new Map();

/** Save/overwrite a pending approval (auto-expires after ttlMs, default 1h). */
function savePending(token, data, ttlMs = 60 * 60 * 1000) {
  const old = PENDING.get(token);
  if (old?.timeout) clearTimeout(old.timeout);

  const record = { ...data, createdAt: Date.now(), timeout: null };
  record.timeout = setTimeout(() => {
    PENDING.delete(token);
  }, ttlMs);

  // Don't keep the Node process alive just for this timer.
  if (typeof record.timeout?.unref === 'function') record.timeout.unref();

  PENDING.set(token, record);
}

/** Get a pending approval by token (or undefined if none). */
function getPending(token) {
  return PENDING.get(token);
}

/** Remove a pending approval and clear its timer. */
function deletePending(token) {
  const rec = PENDING.get(token);
  if (rec?.timeout) clearTimeout(rec.timeout);
  return PENDING.delete(token);
}

module.exports = { savePending, getPending, deletePending };
