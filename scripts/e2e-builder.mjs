// e2e-builder.mjs — drives the Quiz Builder UI (Phase 4) in headless Edge.
// No API calls are made (the test account has no Anthropic key): this
// verifies the page itself — preset picker + preview modal, key modal,
// file/url plumbing, and the claude.ai fallback's prompt copy.
//
//   1. `npm run dev` must already be running on :5173
//   2. node scripts/e2e-builder.mjs

import { launchBrowser, signIn, sleep } from './lib/cdp.mjs';

const browser = await launchBrowser({ height: 1600 });
try {
  console.log('Signing in as test account…');
  await signIn(browser);
  await browser.waitFor('[data-new-sem], #sem-tabs', 20000);

  console.log('Opening the builder…');
  await browser.evaluate(`location.hash = 'builder'`);
  await browser.waitFor('#b-generate');
  await sleep(500);
  await browser.shot('builder.png');

  console.log('Preset preview modal…');
  await browser.evaluate(
    `[...document.querySelectorAll('[data-preview]')]
      .find((b) => b.closest('.preset-card').textContent.includes('Calculation')).click()`);
  await browser.waitFor('.modal-box');
  await browser.shot('builder-preset-preview.png');
  await browser.evaluate(`document.querySelector('.modal-overlay').click()`);

  console.log('Selecting a preset…');
  await browser.evaluate(
    `[...document.querySelectorAll('.preset-card')]
      .find((c) => c.textContent.includes('Definitions')).click()`);
  const selected = await browser.evaluate(
    `document.querySelector('.preset-card.selected')?.textContent.includes('Definitions')`);
  if (!selected) throw new Error('preset selection failed');

  console.log('Key modal (no key on test account)…');
  await browser.click('#key-chip');
  await browser.waitFor('#key-input');
  await browser.shot('builder-key-modal.png');
  await browser.evaluate(`document.querySelector('.modal-overlay').click()`);

  console.log('URL add + generate without key prompts for key…');
  await browser.type('#b-url', 'https://en.wikipedia.org/wiki/Accounting_equation');
  await browser.click('#b-url-add');
  await browser.waitFor('[data-rm-url]');
  await browser.type('#b-notes', 'Assets = Liabilities + Equity. Debits on the left, credits on the right.');
  await browser.click('#b-generate');
  await browser.waitFor('#key-input'); // no key → key modal opens
  await browser.evaluate(`document.querySelector('.modal-overlay').click()`);

  console.log('claude.ai fallback: copy prompt + import JSON…');
  await browser.evaluate(`document.querySelector('#fallback').open = true`);
  const sample = JSON.stringify([
    { q: 'Assets equal liabilities plus ___?', type: 'free-response', cat: 'Basics',
      opts: null, ans: ['equity', 'owners equity'], explain: 'The accounting equation.' },
    { q: 'Which side records debits?', type: 'mc', cat: 'Basics',
      opts: ['Left', 'Right', 'Top', 'Bottom'], ans: 0, explain: 'Debits go on the left.' },
  ]);
  await browser.type('#b-json', sample);
  await browser.click('#b-import');
  await browser.waitFor('.preview-q');
  await sleep(300);
  await browser.shot('builder-preview.png');

  console.log('Done — builder verified (no data was saved).');
} finally {
  browser.close();
}
