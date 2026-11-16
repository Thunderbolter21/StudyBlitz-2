// sync.js — the outbox + per-row sync engine. Implements the SYNC RULES
// from CLAUDE.md. Read those rules first; this file is their translation.
//
// The big ideas:
//   • Every local change is already saved in IndexedDB before we get here
//     (local-first). This engine only MIRRORS rows to/from Supabase.
//   • There is no code path that writes a whole collection — only per-row
//     upserts of rows that exist locally. An empty device can't clobber
//     anything because it has nothing to push.
//   • Two timestamps per row:
//       updatedAt       — set by the client at edit time. Merges compare
//                         THIS, so "latest edit wins" survives offline replays.
//       serverUpdatedAt — set by a DB trigger. Pulls use it as a cursor.
//   • Deletes are tombstones (deletedAt) and they are TERMINAL: once any
//     device deletes a row, no concurrent edit can resurrect it.

import { TABLES, TABLE_NAMES, toRemote, toLocal } from './schema.js';

const EPOCH = '1970-01-01T00:00:00.000Z';
const PULL_LIMIT = 1000; // rows per pull page
const IN_CHUNK = 100;    // ids per `.in()` filter
const UPSERT_CHUNK = 500;

// Decides which version of one row wins. Pure function — heavily unit-tested.
// `localQueued` = true when the local row has an unpushed edit in the outbox.
export function mergeRows(local, remote, localQueued = false) {
  if (!local) return remote;
  if (!remote) return local;

  // Tombstones are terminal: if either side deleted the row, it stays
  // deleted — a stale device can never resurrect it (SYNC RULE 5).
  const localDeleted = Boolean(local.deletedAt);
  const remoteDeleted = Boolean(remote.deletedAt);
  if (localDeleted !== remoteDeleted) return localDeleted ? local : remote;

  // Normal case: latest EDIT wins (client timestamps, SYNC RULE 4).
  if (remote.updatedAt > local.updatedAt) return remote;
  if (remote.updatedAt < local.updatedAt) return local;
  // Exact tie: keep an unpushed local edit (it will push and converge);
  // otherwise prefer remote so every device settles on the same bytes.
  return localQueued ? local : remote;
}

export function createSync({
  db,
  client,        // an AUTHED supabase-js client (or the test mock)
  userId,
  now = () => Date.now(),
  isOnline = () =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  heartbeatMs = 45_000,
  onChange = () => {},   // (status, { pending }) → UI
  onApplied = () => {},  // fired when a pull/reconcile CHANGED local rows,
                         // so pages can re-render remote edits
}) {
  let status = 'synced';
  let heartbeat = null;
  let stopped = false;

  // All sync work runs through this chain so a pull can never interleave
  // with a flush halfway through (one at a time, in order).
  let chain = Promise.resolve();
  function exclusive(fn) {
    const next = chain.then(fn, fn);
    // Keep the chain alive even if fn throws; errors surface to callers.
    chain = next.catch(() => {});
    return next;
  }

  async function setStatus(next) {
    status = next;
    const pending = await db.outboxCount();
    onChange(status, { pending });
  }

  const outboxKey = (table, id) => `${table}|${id}`;

  // ── Enqueue: called by repositories after every local write ──────────────
  // Stores only {table, id}; the freshest row is read from IndexedDB at
  // flush time, so ten quick edits collapse into one upsert automatically.
  async function enqueue(table, id) {
    await db.outboxPut({ key: outboxKey(table, id), table, id, queuedAt: now() });
    void flush(); // fire-and-forget; flush itself is serialized + guarded
  }

  // ── Hydration gate (SYNC RULE 6) ──────────────────────────────────────────
  // A fresh device must fully pull before it may push anything.
  async function isHydrated() {
    return (await db.metaGet('hydrated')) === true;
  }

  function hydrate() {
    return exclusive(async () => {
      if (await isHydrated()) return;
      await pullAllInner();
      await db.metaSet('hydrated', true);
    });
  }

  // ── Pull (cursor per table on serverUpdatedAt) ────────────────────────────
  function pullAll() {
    return exclusive(() => pullAllInner());
  }

  async function pullAllInner() {
    if (!isOnline()) {
      await setStatus('offline');
      return;
    }
    try {
      const queuedKeys = new Set((await db.outboxAll()).map((e) => e.key));
      let applied = 0;
      for (const table of TABLE_NAMES) {
        applied += await pullTable(table, queuedKeys);
      }
      await setStatus((await db.outboxCount()) > 0 ? 'syncing' : 'synced');
      if (applied > 0) onApplied();
    } catch (err) {
      console.warn('[sync] pull failed:', err?.message || err);
      await setStatus('error');
      throw err;
    }
  }

  // Returns how many rows were actually written locally.
  async function pullTable(table, queuedKeys) {
    const cursorKey = `cursor:${table}`;
    let cursor = (await db.metaGet(cursorKey)) || EPOCH;

    let appliedCount = 0;

    // We use gte (not gt) so rows sharing the exact cursor timestamp are
    // never skipped; re-applying an already-seen row is harmless because
    // mergeRows is idempotent.
    for (;;) {
      const { data, error } = await client
        .from(table)
        .select('*')
        .eq('user_id', userId)
        .gte('server_updated_at', cursor)
        .order('server_updated_at', { ascending: true })
        .limit(PULL_LIMIT);
      if (error) throw new Error(`pull ${table}: ${error.message}`);

      let maxSeen = cursor;
      for (const remoteRaw of data || []) {
        const remote = toLocal(table, remoteRaw);
        const id = remote[TABLES[table].pk];
        const local = await db.get(table, id);
        const queued = queuedKeys.has(outboxKey(table, id));
        const winner = mergeRows(local, remote, queued);
        if (winner === remote) {
          // Only count rows whose content is actually new to this device
          // (every pull re-reads rows at the cursor timestamp — see gte note).
          if (!local || local.updatedAt !== remote.updatedAt || Boolean(local.deletedAt) !== Boolean(remote.deletedAt)) {
            appliedCount++;
          }
          await db.put(table, remote);
          // Remote beat a queued local edit → that edit lost the merge;
          // pushing it would be wrong, so drop it from the outbox.
          if (queued) await db.outboxDelete(outboxKey(table, id));
        }
        if (remote.serverUpdatedAt > maxSeen) maxSeen = remote.serverUpdatedAt;
      }

      await db.metaSet(cursorKey, maxSeen);
      if (!data || data.length < PULL_LIMIT) break;
      if (maxSeen === cursor) break; // safety: cursor must advance
      cursor = maxSeen;
    }
    return appliedCount;
  }

  // ── Flush (push the outbox; SYNC RULES 2 + 3) ─────────────────────────────
  function flush() {
    return exclusive(() => flushInner());
  }

  async function flushInner() {
    if (stopped) return;
    if (!isOnline()) {
      await setStatus('offline');
      return;
    }
    if (!(await isHydrated())) return; // RULE 6: pull before any push

    const entries = await db.outboxAll();
    if (entries.length === 0) {
      await setStatus('synced');
      return;
    }
    await setStatus('syncing');

    try {
      // Group queued ids by table so each table is one reconcile + one upsert.
      const byTable = new Map();
      for (const e of entries) {
        if (!byTable.has(e.table)) byTable.set(e.table, []);
        byTable.get(e.table).push(e.id);
      }

      for (const [table, ids] of byTable) {
        await flushTable(table, ids);
      }
      await setStatus((await db.outboxCount()) > 0 ? 'syncing' : 'synced');
    } catch (err) {
      console.warn('[sync] flush failed:', err?.message || err);
      await setStatus('error'); // outbox entries kept — they retry later
      throw err;
    }
  }

  async function flushTable(table, ids) {
    const pkLocal = TABLES[table].pk;
    const pkRemote = table === 'user_settings' ? 'user_id' : 'id';

    // RULE 3 — pull before push: fetch the current remote version of every
    // queued row and reconcile each one before anything is written.
    const remoteById = new Map();
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK);
      const { data, error } = await client
        .from(table)
        .select('*')
        .in(pkRemote, chunk);
      if (error) throw new Error(`reconcile ${table}: ${error.message}`);
      for (const raw of data || []) {
        const row = toLocal(table, raw);
        remoteById.set(row[pkLocal], row);
      }
    }

    const toPush = [];
    for (const id of ids) {
      const local = await db.get(table, id);
      if (!local) {
        // Row vanished locally (shouldn't happen) — nothing to push.
        await db.outboxDelete(outboxKey(table, id));
        continue;
      }
      const remote = remoteById.get(id);
      const winner = mergeRows(local, remote, true);
      if (remote && winner === remote) {
        // The remote edit is newer (or it's a tombstone): adopt it and
        // drop our stale local change instead of overwriting (RULE 4/5).
        await db.put(table, remote);
        await db.outboxDelete(outboxKey(table, id));
      } else {
        toPush.push(local);
      }
    }

    for (let i = 0; i < toPush.length; i += UPSERT_CHUNK) {
      const chunk = toPush.slice(i, i + UPSERT_CHUNK);
      const { error } = await client
        .from(table)
        .upsert(chunk.map((row) => toRemote(table, row)), { onConflict: pkRemote });
      if (error) throw new Error(`push ${table}: ${error.message}`);
      // Only after the server confirmed the write do the entries clear.
      for (const row of chunk) {
        await db.outboxDelete(outboxKey(table, row[pkLocal]));
      }
    }
  }

  // ── Lifecycle: listeners + heartbeat (RULE 2 flush triggers) ──────────────
  const onPagehide = () => void flush();
  const onVisibility = () => {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') void flush();
    else void pullAll().then(() => flush());
  };
  const onOnline = () => void pullAll().then(() => flush());

  async function start() {
    stopped = false;
    await hydrate();
    await pullAll();
    await flush();
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', onPagehide);
      window.addEventListener('online', onOnline);
      document.addEventListener('visibilitychange', onVisibility);
    }
    heartbeat = setInterval(() => {
      void pullAll().then(() => flush()).catch(() => {});
    }, heartbeatMs);
  }

  function stop() {
    stopped = true;
    clearInterval(heartbeat);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', onPagehide);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
    }
  }

  return {
    enqueue,
    flush,
    pullAll,
    hydrate,
    isHydrated,
    start,
    stop,
    getStatus: () => status,
  };
}
