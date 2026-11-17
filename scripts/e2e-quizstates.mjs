// e2e-quizstates.mjs — verifies the Step A dimming fix in the real app:
// after answering, every choice stays at full brightness (computed
// opacity === 1); only colors + ✓/✗ marks change. Covers MC and
// multi-select (chosen-correct green, missed-correct green outline,
// wrong-pick red). Screenshots at desktop, phone, and reduced-motion.
//
//   1. `npm run dev` on :5173
//   2. node scripts/e2e-quizstates.mjs

import { launchBrowser, signIn, sleep } from './lib/cdp.mjs';

// Distinctive option texts so we can target by text despite per-session shuffle.
const QUESTIONS = [
  { q: 'MC question', type: 'mc', cat: 'X',
    opts: ['Apple', 'Banana', 'Cherry', 'Date'], ans: 1, explain: 'Banana is correct.' },
  { q: 'MS question (select all)', type: 'multi-select', cat: 'X',
    opts: ['Red', 'Green', 'Blue', 'Yellow'], ans: [0, 2], explain: 'Red and Blue.' },
];

const browser = await launchBrowser({ height: 1200 });
const { evaluate, waitFor, click, type, shot, cdp } = browser;

// computed opacity of the .opt-btn whose text contains `text`
const opacityOf = (text) => evaluate(`(() => {
  const b = [...document.querySelectorAll('.opt-btn')].find(x => x.textContent.includes(${JSON.stringify(text)}));
  return b ? getComputedStyle(b).opacity : 'MISSING';
})()`);
const hasClass = (text, cls) => evaluate(`(() => {
  const b = [...document.querySelectorAll('.opt-btn')].find(x => x.textContent.includes(${JSON.stringify(text)}));
  return b ? b.classList.contains(${JSON.stringify(cls)}) : false;
})()`);
const markOf = (text) => evaluate(`(() => {
  const b = [...document.querySelectorAll('.opt-btn')].find(x => x.textContent.includes(${JSON.stringify(text)}));
  return b ? getComputedStyle(b, '::after').content : 'none';
})()`);
const clickOpt = (text) => evaluate(`[...document.querySelectorAll('.opt-btn')]
  .find(x => x.textContent.includes(${JSON.stringify(text)})).click()`);

function assert(cond, msg) { if (!cond) throw new Error('ASSERT FAILED: ' + msg); }

try {
  await signIn(browser);
  await waitFor('[data-new-sem], #sem-tabs', 20000);
  await click('[data-new-sem]');
  await waitFor('#dlg-input');
  await click('.modal-box .btn-primary');
  await waitFor('#sem-tabs');
  await click('[data-new-class]');
  await waitFor('#dlg-cname');
  await type('#dlg-cname', 'States');
  await click('.modal-box .btn-primary');
  await waitFor('.class-section');
  await click('[data-new-deck]');
  await waitFor('#dlg-input');
  await type('#dlg-input', 'State deck');
  await click('.modal-box .btn-primary');
  await waitFor('[data-deck-open]');

  const deckId = await evaluate(`document.querySelector('[data-deck-open]').dataset.deckOpen`);
  await evaluate(`location.hash = 'builder?deck=' + ${JSON.stringify(deckId)}`);
  await waitFor('#b-json');
  await evaluate(`document.querySelector('#fallback').open = true`);
  await type('#b-json', JSON.stringify(QUESTIONS));
  await click('#b-import');
  await waitFor('#b-save');
  await click('#b-save');
  await waitFor('.modal-box [data-ok]');
  await click('.modal-box [data-ok]');
  await waitFor('[data-deck-open]');

  await click('[data-deck-open]');
  await waitFor('[data-mode]');
  await click('#qm-start');
  await waitFor('.quiz-overlay .q-text');

  let didMC = false;
  let didMS = false;
  let shotTaken = false;

  for (let round = 0; round < 2; round++) {
    await sleep(200);
    const isMS = await evaluate(`Boolean(document.querySelector('#ms-submit'))`);

    if (isMS) {
      // Select one correct (Red) + one wrong (Yellow); leave Blue (missed) & Green.
      await clickOpt('Red');
      await clickOpt('Yellow');
      await click('#ms-submit');
      await waitFor('.feedback-card');
      await sleep(300);

      assert(await hasClass('Red', 'opt-correct'), 'MS: chosen-correct Red → opt-correct');
      assert(await hasClass('Blue', 'opt-missed'), 'MS: missed-correct Blue → opt-missed outline');
      assert(await hasClass('Yellow', 'opt-wrong'), 'MS: wrong-pick Yellow → opt-wrong');
      for (const t of ['Red', 'Green', 'Blue', 'Yellow']) {
        assert((await opacityOf(t)) === '1', `MS: ${t} opacity must be 1, got ${await opacityOf(t)}`);
      }
      assert((await markOf('Red')).includes('✓'), 'MS: Red shows ✓');
      assert((await markOf('Blue')).includes('✓'), 'MS: Blue (missed) shows ✓');
      assert((await markOf('Yellow')).includes('✗'), 'MS: Yellow shows ✗');
      console.log('✓ multi-select states correct, all choices opacity=1');
      if (!shotTaken) { await shot('states-ms.png'); shotTaken = true; }
      didMS = true;
    } else {
      // MC: answer WRONG (click Apple; correct is Banana) to show both colors.
      await clickOpt('Apple');
      await waitFor('.feedback-card.fb-wrong');
      await sleep(300);

      assert(await hasClass('Banana', 'opt-correct'), 'MC: Banana → opt-correct');
      assert(await hasClass('Apple', 'opt-wrong'), 'MC: Apple → opt-wrong');
      for (const t of ['Apple', 'Banana', 'Cherry', 'Date']) {
        assert((await opacityOf(t)) === '1', `MC: ${t} opacity must be 1, got ${await opacityOf(t)}`);
      }
      assert((await markOf('Banana')).includes('✓'), 'MC: Banana shows ✓');
      assert((await markOf('Apple')).includes('✗'), 'MC: Apple shows ✗');
      console.log('✓ MC states correct, all choices opacity=1 (incl. unselected Cherry/Date)');
      await shot('states-mc.png');
      didMC = true;
    }

    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    if (round < 1) await waitFor('.quiz-overlay .q-text, .results-sheet');
  }

  assert(didMC && didMS, 'both question types were exercised');

  // Phone width + reduced-motion screenshot of a fresh answered state.
  await waitFor('.results-sheet');
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await click('#res-done');
  await waitFor('[data-deck-open]');
  await click('[data-deck-open]');
  await waitFor('[data-mode]');
  await click('#qm-start');
  await waitFor('.quiz-overlay .q-text');
  await sleep(200);
  const isMS2 = await evaluate(`Boolean(document.querySelector('#ms-submit'))`);
  if (isMS2) { await clickOpt('Red'); await clickOpt('Yellow'); await click('#ms-submit'); }
  else { await clickOpt('Apple'); }
  await waitFor('.feedback-card');
  await sleep(200);
  // Even with reduced motion the colored states + opacity must hold.
  const probe = isMS2 ? 'Green' : 'Cherry';
  assert((await opacityOf(probe)) === '1', `reduced-motion/phone: ${probe} opacity must be 1`);
  await shot('states-phone-reduced.png');
  console.log('✓ phone + reduced-motion: choices full brightness');

  // Cleanup
  await evaluate(`document.querySelector('#qz-exit').click()`);
  await waitFor('[data-sem-menu]');
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await click('[data-sem-menu]');
  await waitFor('.menu-pop');
  await evaluate(`[...document.querySelectorAll('.menu-item')].find(b => b.textContent.includes('Delete')).click()`);
  await waitFor('.modal-box [data-ok]');
  await click('.modal-box [data-ok]');
  await waitFor('[data-new-sem]');
  await sleep(1500);
  console.log('Done — dimming fix verified, test account left empty.');
} finally {
  browser.close();
}
