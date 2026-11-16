// e2e-home.mjs — drives the real app in headless Edge over the Chrome
// DevTools Protocol (no dependencies; Node ≥21 for built-in WebSocket).
// Signs in with the throwaway test account from .env, walks the Phase 3
// hierarchy UI (semester → class → deck), captures screenshots, then
// deletes everything it created so the test account stays clean.
//
//   1. `npm run dev` must already be running on :5173
//   2. node scripts/e2e-home.mjs
//
// Screenshots land in %TEMP%\sb2-shots\.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP = 'http://localhost:5173/';
const SHOTS = join(tmpdir(), 'sb2-shots');
mkdirSync(SHOTS, { recursive: true });

// Read test credentials from .env (never printed).
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);
const EMAIL = env.VITE_SB2_TEST_EMAIL;
const PASSWORD = env.VITE_SB2_TEST_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error('Test credentials missing from .env');

// ── Minimal CDP client ──────────────────────────────────────────────────────
const PORT = 9333;
const profile = join(tmpdir(), 'sb2-e2e-profile-' + Date.now());
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--window-size=1000,1200', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return new CdpSession(new WebSocket(page.webSocketDebuggerUrl));
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Could not reach Edge DevTools');
}

class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
    this.ready = new Promise((r) => ws.addEventListener('open', r));
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

let cdp;

// Run JS inside the page and return its JSON-able result.
async function evaluate(expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (exceptionDetails) throw new Error('page error: ' + exceptionDetails.text + ' ' + (exceptionDetails.exception?.description || ''));
  return result.value;
}

// Wait until a selector exists (and is visible-ish).
async function waitFor(selector, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return;
    await sleep(150);
  }
  throw new Error(`timeout waiting for ${selector}`);
}

const click = (selector) =>
  evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);

// Set an input's value the way a user would (fires input event).
const type = (selector, value) =>
  evaluate(`{
    const el = document.querySelector(${JSON.stringify(selector)});
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }`);

async function shot(name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, name), Buffer.from(data, 'base64'));
  console.log('📸', name);
}

// ── The walk ────────────────────────────────────────────────────────────────
try {
  cdp = await connect();
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: APP });
  await waitFor('#auth-email');

  console.log('Signing in as test account…');
  await type('#auth-email', EMAIL);
  await type('#auth-pw', PASSWORD);
  await click('#auth-submit');

  // First-run empty state (test account has no data).
  await waitFor('[data-new-sem], #sem-tabs', 20000);
  await sleep(600); // let fonts/decor settle
  await shot('home-empty.png');

  // Create a semester (the suggested name is pre-filled).
  console.log('Creating semester…');
  await click('[data-new-sem]');
  await waitFor('#dlg-input');
  await click('.modal-box .btn-primary');
  await waitFor('#sem-tabs');

  // Create a class.
  console.log('Creating class…');
  await click('[data-new-class]');
  await waitFor('#dlg-cname');
  await type('#dlg-cname', 'ACC 210');
  await evaluate(`document.querySelectorAll('.swatch')[3].click()`); // amber
  await click('.modal-box .btn-primary');
  await waitFor('.class-section');

  // Create a deck.
  console.log('Creating deck…');
  await click('[data-new-deck]');
  await waitFor('#dlg-input');
  await type('#dlg-input', 'Chapter 1 — The Accounting Equation');
  await click('.modal-box .btn-primary');
  await waitFor('.deck-card');
  await sleep(400);
  await shot('home-populated.png');

  // Open the deck menu so the popover is verified too.
  await click('[data-deck-menu]');
  await waitFor('.menu-pop');
  await shot('home-deck-menu.png');
  await evaluate(`document.body.click()`); // close menu

  // Clean up: delete the semester through the real UI (menu → confirm).
  console.log('Cleaning up…');
  await click('[data-sem-menu]');
  await waitFor('.menu-pop');
  await evaluate(`[...document.querySelectorAll('.menu-item')]
    .find((b) => b.textContent.includes('Delete')).click()`);
  await waitFor('.modal-box [data-ok]');
  await click('.modal-box [data-ok]');
  await waitFor('[data-new-sem]'); // back to first-run state
  await sleep(1500); // let the tombstones flush to Supabase
  console.log('Done — test account left empty.');
} finally {
  edge.kill();
}
