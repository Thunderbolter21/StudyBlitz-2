// sw-cache.test.js — the precache version + stale-cache selection logic
// that guarantees a new deploy's cache replaces the old one.

import { describe, it, expect } from 'vitest';
import { manifestVersion, staleCaches, CACHE_PREFIX } from './sw-cache.js';

describe('manifestVersion', () => {
  it('is stable for the same manifest and changes when the build changes', () => {
    const v1 = [{ url: '/index.html', revision: 'a1' }, { url: '/assets/app-x.js', revision: null }];
    const v1b = [{ url: '/index.html', revision: 'a1' }, { url: '/assets/app-x.js', revision: null }];
    const v2 = [{ url: '/index.html', revision: 'b2' }, { url: '/assets/app-y.js', revision: null }];

    expect(manifestVersion(v1)).toBe(manifestVersion(v1b)); // deterministic
    expect(manifestVersion(v1)).not.toBe(manifestVersion(v2)); // new deploy → new name
    expect(manifestVersion(v1).startsWith(CACHE_PREFIX)).toBe(true);
  });

  it('handles an empty manifest', () => {
    expect(manifestVersion([]).startsWith(CACHE_PREFIX)).toBe(true);
  });
});

describe('staleCaches', () => {
  it('selects our old precaches but never the current one or strangers', () => {
    const current = CACHE_PREFIX + 'abc';
    const keys = [
      CACHE_PREFIX + 'old1',
      CACHE_PREFIX + 'old2',
      current,
      'workbox-runtime',      // not ours
      'some-other-app-cache', // not ours
    ];
    expect(staleCaches(keys, current).sort()).toEqual([CACHE_PREFIX + 'old1', CACHE_PREFIX + 'old2']);
  });

  it('returns nothing when only the current cache exists', () => {
    const current = CACHE_PREFIX + 'abc';
    expect(staleCaches([current], current)).toEqual([]);
  });
});
