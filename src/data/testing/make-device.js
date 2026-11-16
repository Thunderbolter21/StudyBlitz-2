// make-device.js — builds a complete simulated "device" for tests:
// its own fake IndexedDB + the REAL sync engine + the REAL repositories,
// pointed at a shared mock (or real) Supabase server.
//
// This is the same production code path the browser runs — only the
// IndexedDB implementation and the server are swapped.

import { IDBFactory } from 'fake-indexeddb';
import { openDb } from '../db.js';
import { createSync } from '../sync.js';
import { createRepos } from '../repositories.js';

// One shared wall clock for all devices in a test, strictly increasing so
// every edit gets a unique, ordered updatedAt (like real ms timestamps).
export function createWallClock(startIso = '2026-01-01T12:00:00Z') {
  let t = Date.parse(startIso);
  return () => ++t;
}

export async function makeDevice({ server, userId, clock, name = 'dev' }) {
  // A brand-new IDBFactory = a brand-new browser profile (fresh device).
  const db = await openDb(`sb2-test-${name}`, new IDBFactory());

  const device = {
    name,
    db,
    online: true,
    statusLog: [],
  };

  device.sync = createSync({
    db,
    client: server.client(),
    userId,
    now: clock,
    isOnline: () => device.online,
    onChange: (status, { pending }) => device.statusLog.push({ status, pending }),
  });

  device.repos = createRepos({ db, sync: device.sync, userId, now: clock });

  // Shorthand used by nearly every test: hydrate then settle.
  device.settle = async () => {
    await device.sync.hydrate();
    await device.sync.pullAll();
    await device.sync.flush();
  };

  return device;
}
