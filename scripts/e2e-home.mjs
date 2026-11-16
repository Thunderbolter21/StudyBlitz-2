// e2e-home.mjs — drives the real app's Phase 3 hierarchy UI in headless
// Edge: sign in → create semester/class/deck through the actual UI →
// screenshots → delete everything so the test account stays clean.
//
//   1. `npm run dev` must already be running on :5173
//   2. node scripts/e2e-home.mjs
//
// Screenshots land in %TEMP%\sb2-shots\.

import { launchBrowser, signIn, sleep } from './lib/cdp.mjs';

const browser = await launchBrowser();
try {
  console.log('Signing in as test account…');
  await signIn(browser);

  // First-run empty state (hydration resolves to "welcome" on empty account).
  await browser.waitFor('[data-new-sem], #sem-tabs', 20000);
  await sleep(600); // let fonts/decor settle
  await browser.shot('home-empty.png');

  console.log('Creating semester…');
  await browser.click('[data-new-sem]');
  await browser.waitFor('#dlg-input');
  await browser.click('.modal-box .btn-primary'); // suggested name pre-filled
  await browser.waitFor('#sem-tabs');

  console.log('Creating class…');
  await browser.click('[data-new-class]');
  await browser.waitFor('#dlg-cname');
  await browser.type('#dlg-cname', 'ACC 210');
  await browser.evaluate(`document.querySelectorAll('.swatch')[3].click()`); // amber
  await browser.click('.modal-box .btn-primary');
  await browser.waitFor('.class-section');

  console.log('Creating deck…');
  await browser.click('[data-new-deck]');
  await browser.waitFor('#dlg-input');
  await browser.type('#dlg-input', 'Chapter 1 — The Accounting Equation');
  await browser.click('.modal-box .btn-primary');
  await browser.waitFor('.deck-card');
  await sleep(400);
  await browser.shot('home-populated.png');

  // Verify the popover menu renders.
  await browser.click('[data-deck-menu]');
  await browser.waitFor('.menu-pop');
  await browser.shot('home-deck-menu.png');
  await browser.evaluate(`document.body.click()`);

  console.log('Cleaning up…');
  await browser.click('[data-sem-menu]');
  await browser.waitFor('.menu-pop');
  await browser.evaluate(`[...document.querySelectorAll('.menu-item')]
    .find((b) => b.textContent.includes('Delete')).click()`);
  await browser.waitFor('.modal-box [data-ok]');
  await browser.click('.modal-box [data-ok]');
  await browser.waitFor('[data-new-sem]');
  await sleep(1500); // let the tombstones flush to Supabase
  console.log('Done — test account left empty.');
} finally {
  browser.close();
}
