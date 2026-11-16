// cdp.mjs — tiny shared Chrome-DevTools-Protocol driver for the e2e
// scripts. Headless Edge + built-in WebSocket (Node ≥21); no dependencies.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
export const SHOTS_DIR = join(tmpdir(), 'sb2-shots');
mkdirSync(SHOTS_DIR, { recursive: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Test credentials come from .env only — never hardcoded.
export function readEnv() {
  return Object.fromEntries(
    readFileSync(new URL('../../.env', import.meta.url), 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
  );
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

// Launches headless Edge, connects, and returns the page-driving toolkit.
export async function launchBrowser({ width = 1000, height = 1200 } = {}) {
  const port = 9300 + Math.floor(Math.random() * 400);
  const profile = join(tmpdir(), 'sb2-e2e-profile-' + Date.now());
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, `--window-size=${width},${height}`, 'about:blank',
  ], { stdio: 'ignore' });

  let cdp = null;
  for (let i = 0; i < 40 && !cdp; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) cdp = new CdpSession(new WebSocket(page.webSocketDebuggerUrl));
    } catch { await sleep(250); }
  }
  if (!cdp) { edge.kill(); throw new Error('Could not reach Edge DevTools'); }
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  async function evaluate(expression) {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (exceptionDetails) {
      throw new Error('page error: ' + exceptionDetails.text + ' ' + (exceptionDetails.exception?.description || ''));
    }
    return result.value;
  }

  async function waitFor(selector, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return;
      await sleep(150);
    }
    throw new Error(`timeout waiting for ${selector}`);
  }

  return {
    cdp,
    evaluate,
    waitFor,
    navigate: (url) => cdp.send('Page.navigate', { url }),
    click: (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`),
    type: (selector, value) => evaluate(`{
      const el = document.querySelector(${JSON.stringify(selector)});
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }`),
    async shot(name) {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(SHOTS_DIR, name), Buffer.from(data, 'base64'));
      console.log('📸', name);
    },
    close: () => edge.kill(),
  };
}

// Signs into the running dev server with the throwaway test account.
export async function signIn(browser, appUrl = 'http://localhost:5173/') {
  const env = readEnv();
  if (!env.VITE_SB2_TEST_EMAIL || !env.VITE_SB2_TEST_PASSWORD) {
    throw new Error('Test credentials missing from .env');
  }
  await browser.navigate(appUrl);
  await browser.waitFor('#auth-email');
  await browser.type('#auth-email', env.VITE_SB2_TEST_EMAIL);
  await browser.type('#auth-pw', env.VITE_SB2_TEST_PASSWORD);
  await browser.click('#auth-submit');
}
