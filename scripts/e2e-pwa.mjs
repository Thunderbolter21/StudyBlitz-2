// e2e-pwa.mjs — proves the v1 stale-bundle trap is fixed: a new deploy
// replaces the old bundle with NO manual cache clear, and the old precache
// is cleaned up. Also checks cross-origin (Supabase) is never cached.
//
//   node scripts/e2e-pwa.mjs
//
// It builds twice (BUILD_A then BUILD_B) against a running `vite preview`,
// reloading in between, and asserts window.__SB2_BUILD__ flips to BUILD_B.

import { spawn, execSync } from 'node:child_process';
import { launchBrowser, sleep } from './lib/cdp.mjs';

const PORT = 4287;
const URL = `http://localhost:${PORT}/`;

function build(id) {
  console.log(`Building ${id}…`);
  execSync('npm run build', { env: { ...process.env, SB2_BUILD_ID: id }, stdio: 'ignore' });
}

async function waitForServer(url, ms = 20000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up */ }
    await sleep(300);
  }
  throw new Error('preview server did not start');
}

function assert(cond, msg) { if (!cond) throw new Error('ASSERT FAILED: ' + msg); }

async function poll(browser, expr, want, ms = 30000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if (String(await browser.evaluate(expr)) === want) return; }
    catch { /* context swapping during reload */ }
    await sleep(400);
  }
  throw new Error(`timeout: ${expr} never became ${want} (last=${await browser.evaluate(expr).catch(() => '?')})`);
}

const precaches = (browser) =>
  browser.evaluate(`caches.keys().then(k => k.filter(x => x.startsWith('sb2-precache-')))`);

build('BUILD_A');
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  shell: true, stdio: 'ignore',
});

const browser = await launchBrowser();
try {
  await waitForServer(URL);
  await browser.navigate(URL);

  // First load: SW installs, skipWaiting + clients.claim → it controls us.
  await poll(browser, `navigator.serviceWorker.controller ? 'yes' : 'no'`, 'yes', 20000);
  assert((await browser.evaluate(`window.__SB2_BUILD__`)) === 'BUILD_A', 'first load serves BUILD_A');
  const cachesA = await precaches(browser);
  assert(cachesA.length === 1, `exactly one precache after first load (got ${cachesA.length})`);
  console.log('✓ BUILD_A installed, SW controlling, 1 precache:', cachesA[0]);

  // Cross-origin must never be cached.
  const supaCached = await browser.evaluate(`(async () => {
    for (const n of await caches.keys()) {
      const reqs = await (await caches.open(n)).keys();
      if (reqs.some(r => r.url.includes('supabase.co') || r.url.includes('anthropic.com'))) return true;
    }
    return false;
  })()`);
  assert(supaCached === false, 'Supabase/Anthropic requests are never cached');
  console.log('✓ cross-origin API calls are not cached');

  // ── Deploy BUILD_B over the top, then reload (no manual cache clear) ──
  build('BUILD_B');
  await browser.evaluate(`navigator.serviceWorker.getRegistration().then(r => r && r.update())`).catch(() => {});
  await browser.evaluate(`location.reload()`);

  // The fresh index.html (network-first) + the new SW taking control (which
  // auto-reloads the page) land us on BUILD_B — with the old cache gone.
  await poll(browser, `String(window.__SB2_BUILD__ || '')`, 'BUILD_B', 40000);
  await sleep(1500); // let activate() finish cleaning old caches
  const cachesB = await precaches(browser);
  assert(cachesB.length === 1, `exactly one precache after update (old cleaned; got ${cachesB.length})`);
  assert(cachesB[0] !== cachesA[0], 'precache version changed with the deploy');
  console.log('✓ BUILD_B now served with NO manual cache clear; old precache cleaned:', cachesB[0]);
  console.log('PWA deploy-swap verified.');
} finally {
  browser.close();
  preview.kill();
}
