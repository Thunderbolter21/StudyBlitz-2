// sw.js — StudyBlitz service worker (vite-plugin-pwa injectManifest).
//
// Goals, straight from the v1 post-mortem (a stale SW once served an old
// bundle after a deploy):
//   • skipWaiting + clients.claim so a new SW takes over immediately
//   • a VERSIONED precache; old versions are deleted on activate
//   • navigations are network-first, so a fresh deploy's index.html (with its
//     new asset hashes) always wins — the cache can never pin an old bundle
//   • NEVER cache cross-origin requests (Supabase, Anthropic) or non-GET —
//     those always hit the network
// The page (main.js) reloads once when a new SW takes control.

import { manifestVersion, staleCaches } from './sw-cache.js';

const MANIFEST = self.__WB_MANIFEST || [];
const VERSION = manifestVersion(MANIFEST);
const PRECACHE_URLS = MANIFEST.map((e) => e.url);

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // Per-URL so one unexpected response can't fail the whole install and
  // brick the worker (addAll is atomic — all or nothing). Navigation is
  // network-first regardless, so a partial precache is still correct.
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(staleCaches(keys, VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Cross-origin (Supabase / Anthropic) and non-GET must ALWAYS hit the
  // network — we never read or write them to a cache.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // SPA navigations: network-first (fresh deploy wins), cached shell offline.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }

  // Hashed build assets are immutable → cache-first, then network.
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
