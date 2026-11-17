// e2e-quiz.mjs — drives a COMPLETE quiz loop in the real app (Phase 5):
// build a deck (JSON import fallback — no API key needed), take a practice
// quiz with a correct answer, a wrong answer, and the free-response
// Enter-key bug-fix assertion, see results, then run an exam submit with
// the unanswered confirm + review. Cleans up afterwards.
//
//   1. `npm run dev` running on :5173
//   2. node scripts/e2e-quiz.mjs

import { launchBrowser, signIn, sleep } from './lib/cdp.mjs';

const QUESTIONS = [
  { q: 'Assets = Liabilities + ___?', type: 'free-response', cat: 'Basics',
    opts: null, ans: ['equity', 'owners equity'], explain: 'The accounting equation.' },
  { q: 'Which side are debits recorded on?', type: 'mc', cat: 'Basics',
    opts: ['Left', 'Right', 'Top', 'Bottom'], ans: 0, explain: 'Debits go on the left.' },
  { q: 'Which account increases with a credit?', type: 'mc', cat: 'Accounts',
    opts: ['Revenue', 'Cash', 'Equipment', 'Supplies'], ans: 0, explain: 'Revenue increases with credits.' },
];
// Correct answers by question text — options get shuffled, text doesn't.
const CORRECT = {
  'Which side are debits recorded on?': 'Left',
  'Which account increases with a credit?': 'Revenue',
};

const browser = await launchBrowser({ height: 1300 });
const { evaluate, waitFor, click, type, shot } = browser;

async function clickOptionByText(text, { wrong = false } = {}) {
  await evaluate(`{
    const target = [...document.querySelectorAll('.opt-btn')]
      .filter((b) => !b.disabled)
      .find((b) => ${wrong ? '!' : ''}b.textContent.includes(${JSON.stringify(text)}));
    target.click();
  }`);
}

try {
  console.log('Signing in + building a deck via JSON import…');
  await signIn(browser);
  await waitFor('[data-new-sem], #sem-tabs', 20000);
  await click('[data-new-sem]');
  await waitFor('#dlg-input');
  await click('.modal-box .btn-primary');
  await waitFor('#sem-tabs');
  await click('[data-new-class]');
  await waitFor('#dlg-cname');
  await type('#dlg-cname', 'ACC 210');
  await click('.modal-box .btn-primary');
  await waitFor('.class-section');
  await click('[data-new-deck]');
  await waitFor('#dlg-input');
  await type('#dlg-input', 'Debits & Credits');
  await click('.modal-box .btn-primary');
  await waitFor('[data-deck-open]');

  // Fill it through the builder's JSON-import fallback.
  const deckId = await evaluate(`document.querySelector('[data-deck-open]').dataset.deckOpen`);
  await evaluate(`location.hash = 'builder?deck=' + ${JSON.stringify(deckId)}`);
  await waitFor('#b-json');
  await evaluate(`document.querySelector('#fallback').open = true`);
  await type('#b-json', JSON.stringify(QUESTIONS));
  await click('#b-import');
  await waitFor('#b-save');
  await click('#b-save');
  await waitFor('.modal-box [data-ok]'); // "Replace questions?" confirm
  await click('.modal-box [data-ok]');
  await waitFor('[data-deck-open]');

  console.log('Launching a practice quiz from the deck card…');
  await click('[data-deck-open]');
  await waitFor('[data-mode]');
  await click('#qm-start');
  await waitFor('.quiz-overlay .q-text');

  let tookCorrectShot = false;
  let tookWrongShot = false;

  for (let round = 0; round < 3; round++) {
    await sleep(250);
    const qText = await evaluate(`document.querySelector('#qz-text').textContent`);
    const isFR = await evaluate(`Boolean(document.querySelector('#fr-input'))`);

    if (isFR) {
      console.log('FR question — verifying the Enter-key bug fix…');
      await type('#fr-input', 'EQUITY!');
      // Dispatch a REAL Enter keydown on the input: must submit + show
      // feedback, and must NOT advance to the next question.
      await evaluate(`document.querySelector('#fr-input').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`);
      await waitFor('.feedback-card');
      const still = await evaluate(`document.querySelector('#qz-text').textContent`);
      if (still !== qText) throw new Error('BUG: Enter advanced past the feedback!');
      const verdict = await evaluate(`document.querySelector('.fb-title').textContent`);
      if (!verdict.includes('Correct')) throw new Error('FR grading failed: ' + verdict);
      console.log('  ✓ feedback shown first, no skip; graded correct:', verdict.trim());
    } else {
      const correctText = CORRECT[qText.trim()];
      if (!tookCorrectShot) {
        await clickOptionByText(correctText);
        await waitFor('.feedback-card.fb-correct');
        await sleep(350); // let the highlighter sweep finish for the shot
        await shot('quiz-correct.png');
        tookCorrectShot = true;
      } else {
        await clickOptionByText(correctText, { wrong: true });
        await waitFor('.feedback-card.fb-wrong');
        await sleep(250);
        await shot('quiz-wrong.png');
        tookWrongShot = true;
      }
    }

    // Advance with the keyboard (Enter at document level, feedback visible).
    await evaluate(`document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`);
    if (round < 2) await waitFor('.quiz-overlay .q-text');
  }

  await waitFor('.results-sheet');
  await sleep(300);
  await shot('quiz-results.png');
  const score = await evaluate(`document.querySelector('.res-score').textContent`);
  console.log('Results:', score.trim(), tookWrongShot ? '(1 intentional miss)' : '');
  await click('#res-done');

  console.log('Exam mode: unanswered confirm + review…');
  await waitFor('[data-deck-open]');
  await click('[data-deck-open]');
  await waitFor('[data-mode]');
  await evaluate(`[...document.querySelectorAll('[data-mode]')]
    .find((c) => c.dataset.mode === 'exam').click()`);
  await click('#qm-start');
  await waitFor('#ex-submit');
  await click('#ex-submit');
  await waitFor('.modal-box [data-ok]'); // "3 unanswered" confirm
  await click('.modal-box [data-ok]');
  await waitFor('#ex-review');
  await click('#ex-review');
  await waitFor('.exam-review-note');
  await shot('exam-review.png');
  await click('#ex-done');

  console.log('Cleaning up…');
  await waitFor('[data-sem-menu]');
  await click('[data-sem-menu]');
  await waitFor('.menu-pop');
  await evaluate(`[...document.querySelectorAll('.menu-item')]
    .find((b) => b.textContent.includes('Delete')).click()`);
  await waitFor('.modal-box [data-ok]');
  await click('.modal-box [data-ok]');
  await waitFor('[data-new-sem]');
  await sleep(1500);
  console.log('Done — full quiz loop verified, test account left empty.');
} finally {
  browser.close();
}
