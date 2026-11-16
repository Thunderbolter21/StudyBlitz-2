// db.js — thin promise wrapper around IndexedDB.
//
// One database PER USER (named by main.js as `sb2-<userId>`), so two
// accounts on the same browser can never see each other's data. Inside it:
// one object store per table from schema.js, plus:
//   outbox — pending changes waiting to be pushed to Supabase
//   meta   — sync bookkeeping (pull cursors, hydrated flag)
//
// Everything here is storage only — no sync logic, no Supabase.

import { TABLES, TABLE_NAMES } from './schema.js';

const DB_VERSION = 1;

export function openDb(name, factory = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, DB_VERSION);

    req.onupgradeneeded = () => {
      const idb = req.result;
      for (const table of TABLE_NAMES) {
        const def = TABLES[table];
        const store = idb.createObjectStore(table, { keyPath: def.pk });
        for (const index of def.indexes) {
          store.createIndex(index, index, { unique: false });
        }
      }
      idb.createObjectStore('outbox', { keyPath: 'key' });
      idb.createObjectStore('meta', { keyPath: 'k' });
    };

    req.onsuccess = () => resolve(new Db(req.result));
    req.onerror = () => reject(req.error);
  });
}

// Wraps one IDB request in a promise.
function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

class Db {
  constructor(idb) {
    this.idb = idb;
  }

  _store(table, mode = 'readonly') {
    return this.idb.transaction(table, mode).objectStore(table);
  }

  get(table, id) {
    return promisify(this._store(table).get(id));
  }

  getAll(table) {
    return promisify(this._store(table).getAll());
  }

  // All rows where row[index] === value (e.g. questions by deckId).
  byIndex(table, index, value) {
    return promisify(this._store(table).index(index).getAll(value));
  }

  put(table, row) {
    return promisify(this._store(table, 'readwrite').put(row));
  }

  // One transaction for many rows — all succeed or all fail together.
  bulkPut(table, rows) {
    return new Promise((resolve, reject) => {
      const tx = this.idb.transaction(table, 'readwrite');
      const store = tx.objectStore(table);
      for (const row of rows) store.put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ── Outbox ──────────────────────────────────────────────────
  outboxPut(entry) {
    return this.put('outbox', entry);
  }

  outboxAll() {
    return this.getAll('outbox');
  }

  outboxDelete(key) {
    return promisify(this._store('outbox', 'readwrite').delete(key));
  }

  outboxCount() {
    return promisify(this._store('outbox').count());
  }

  // ── Meta (sync bookkeeping) ─────────────────────────────────
  async metaGet(k) {
    const row = await this.get('meta', k);
    return row ? row.v : undefined;
  }

  metaSet(k, v) {
    return this.put('meta', { k, v });
  }

  close() {
    this.idb.close();
  }
}
