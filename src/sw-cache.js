// sw-cache.js — pure cache-naming/cleanup helpers for the service worker.
// Kept separate so the selection logic is unit-testable without SW globals.

export const CACHE_PREFIX = 'sb2-precache-';

// A deterministic cache name derived from the precache manifest. Because the
// manifest's revisions change whenever the build output changes, a new deploy
// produces a NEW version string — which is what triggers cleanup of the old
// precache (the v1 stale-bundle fix).
export function manifestVersion(manifest) {
  const str = (manifest || []).map((e) => `${e.url}:${e.revision || ''}`).join('|');
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return CACHE_PREFIX + h.toString(36);
}

// Which existing cache names are OUR old precaches (to delete on activate).
// Only ever touches caches we created — never a stranger's.
export function staleCaches(keys, currentVersion) {
  return (keys || []).filter((k) => k.startsWith(CACHE_PREFIX) && k !== currentVersion);
}
