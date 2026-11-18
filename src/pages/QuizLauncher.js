// QuizLauncher.js — loads a deck's questions + memory records and opens
// the right overlay. The launch modal mirrors v1's per-deck quiz panel
// (mode cards + count + time limit + drill), and quick-start = v1's
// one-tap "▶ Quiz" (20 adaptive questions, standard mode).

import { emptyRecord, isWeak, isDue, weightedSample, interleaveQuestions } from '../engine/sm2.js';
import { openModal } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import { launchQuizOverlay } from './QuizPage.js';
import { launchExamOverlay } from './ExamPage.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Load questions + a Map of memory records for a set of question ids.
export async function loadDeckData(repos, deckId) {
  const questions = await repos.questions.listByDeck(deckId);
  const records = new Map();
  for (const q of questions) {
    const rec = await repos.cardMemory.getForQuestion(q.id);
    if (rec) records.set(q.id, rec);
  }
  return { questions, records };
}

const getRecordFn = (records) => (q) => records.get(q.id) || emptyRecord();

// Remember the last deck-based quiz so Home can offer "Resume" (v1's
// recentDeck, now in synced preferences so it follows you across devices).
function recordRecent(repos, deckId, mode, tcSecs) {
  return repos.settings.patchPreferences({ recentQuiz: { deckId, mode, tcSecs: tcSecs || null } });
}

// Launch a specific mode for a deck — the single dispatch shared by the
// launch modal, quick-start, and Resume. Records it as the recent quiz.
export async function launchDeckMode({ repos, sources = null, deck, mode, count, tcSecs = 60, onExit }) {
  const { questions, records } = await loadDeckData(repos, deck.id);
  if (!questions.length) return showToast('This deck has no questions yet — fill it in the Quiz Builder');
  const getRecord = getRecordFn(records);
  const max = questions.length;
  const n = Math.min(Math.max(5, count || Math.min(20, max)), max);
  await recordRecent(repos, deck.id, mode, tcSecs);

  if (mode === 'exam') {
    launchExamOverlay({ deckName: deck.name, questions, records, repos, count: n, onExit });
  } else if (mode === 'timechallenge') {
    // v1 :153–162: whole deck, due-first, NO interleave in TC.
    const picked = weightedSample(questions, getRecord, max);
    launchQuizOverlay({
      deckName: deck.name, deckId: deck.id, mode: 'timechallenge',
      questions: picked, records, repos, sources, tcSecs, onExit,
    });
  } else {
    const picked = interleaveQuestions(weightedSample(questions, getRecord, n), getRecord);
    launchQuizOverlay({
      deckName: deck.name, deckId: deck.id, mode: 'standard',
      questions: picked, records, repos, sources, onExit,
    });
  }
}

// One-tap quick quiz: 20 adaptive questions, standard mode (v1 :96–106).
export function quickStartDeck({ repos, sources = null, deck, onExit }) {
  return launchDeckMode({ repos, sources, deck, mode: 'standard', onExit });
}

// Resume the most recent deck quiz (same mode), if that deck still exists.
export async function getRecentQuiz(repos) {
  const settings = await repos.settings.get();
  const r = settings.preferences?.recentQuiz;
  if (!r?.deckId) return null;
  const deck = await repos.decks.get(r.deckId);
  return deck ? { deck, mode: r.mode, tcSecs: r.tcSecs } : null;
}

export async function relaunchRecent({ repos, sources = null, onExit }) {
  const recent = await getRecentQuiz(repos);
  if (!recent) return showToast('No recent quiz to resume');
  await launchDeckMode({ repos, sources, deck: recent.deck, mode: recent.mode, tcSecs: recent.tcSecs || 60, onExit });
}

// Drill a specific question set (deck weak spots, class weak spots, due
// review). v1 used drill mode for all of these.
export function startDrill({ repos, sources = null, name, questions, records, onExit }) {
  if (!questions.length) return showToast('Nothing to drill — nice! 🎉');
  const getRecord = getRecordFn(records);
  const ordered = interleaveQuestions([...questions], getRecord);
  launchQuizOverlay({
    deckName: name, mode: 'drill', questions: ordered, records, repos, sources, onExit,
  });
}

// The full launch modal for one deck (v1 openClassQuizPanel :152–189).
export async function openQuizModal({ repos, sources = null, deck, onExit }) {
  const { questions, records } = await loadDeckData(repos, deck.id);
  if (!questions.length) {
    return showToast('This deck has no questions yet — fill it in the Quiz Builder');
  }
  const getRecord = getRecordFn(records);
  const weak = questions.filter((q) => isWeak(getRecord(q)));
  const maxQ = questions.length;
  const defaultQ = Math.min(20, maxQ);

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="preset-grid" style="grid-template-columns:repeat(auto-fill,minmax(10rem,1fr))">
      ${[
        ['standard', '📖 Practice', 'Adaptive questions · feedback after each answer'],
        ['exam', '📋 Exam mode', 'All at once · graded on submit'],
        ['timechallenge', '⏱ Time challenge', 'Race the clock · high scores'],
      ].map(([value, label, sub], i) => `
        <div class="preset-card${i === 0 ? ' selected' : ''}" data-mode="${value}">
          <strong>${label}</strong><span class="preset-desc">${sub}</span>
        </div>`).join('')}
    </div>

    <div id="qm-count-wrap" class="debug-row" style="align-items:center">
      <label style="margin:0" for="qm-count">Questions</label>
      <button class="btn-ghost" id="qm-minus" style="min-width:var(--touch-min)">−</button>
      <input id="qm-count" type="number" value="${defaultQ}" min="5" max="${maxQ}" step="5"
             style="width:5rem;text-align:center" />
      <button class="btn-ghost" id="qm-plus" style="min-width:var(--touch-min)">+</button>
      <span class="auth-sub" style="margin:0">of ${maxQ}</span>
    </div>

    <div id="qm-time-wrap" class="debug-row" style="display:none;align-items:center">
      <label style="margin:0" for="qm-secs">Time limit</label>
      <select id="qm-secs" style="width:auto">
        <option value="30">30 seconds</option>
        <option value="60" selected>60 seconds</option>
        <option value="90">90 seconds</option>
        <option value="120">2 minutes</option>
        <option value="300">5 minutes</option>
      </select>
    </div>

    <button class="btn-primary" id="qm-start" style="width:100%;margin-top:var(--space-3)">▶ Start</button>
    ${weak.length ? `
      <button class="btn-ghost" id="qm-drill" style="width:100%;margin-top:var(--space-2)">
        🎯 Drill weak spots (${weak.length})</button>` : ''}`;

  const close = openModal({ title: esc(deck.name), body });
  let mode = 'standard';

  body.querySelector('.preset-grid').onclick = (e) => {
    const card = e.target.closest('[data-mode]');
    if (!card) return;
    mode = card.dataset.mode;
    for (const el of body.querySelectorAll('[data-mode]')) {
      el.classList.toggle('selected', el === card);
    }
    body.querySelector('#qm-count-wrap').style.display = mode === 'timechallenge' ? 'none' : 'flex';
    body.querySelector('#qm-time-wrap').style.display = mode === 'timechallenge' ? 'flex' : 'none';
  };

  const countEl = body.querySelector('#qm-count');
  body.querySelector('#qm-minus').onclick = () => {
    countEl.value = Math.max(5, (parseInt(countEl.value, 10) || defaultQ) - 5);
  };
  body.querySelector('#qm-plus').onclick = () => {
    countEl.value = Math.min(maxQ, (parseInt(countEl.value, 10) || defaultQ) + 5);
  };

  body.querySelector('#qm-start').onclick = () => {
    const count = Math.min(Math.max(5, parseInt(countEl.value, 10) || defaultQ), maxQ);
    const tcSecs = parseInt(body.querySelector('#qm-secs').value, 10);
    close();
    void launchDeckMode({ repos, sources, deck, mode, count, tcSecs, onExit });
  };

  const drillBtn = body.querySelector('#qm-drill');
  if (drillBtn) {
    drillBtn.onclick = () => {
      close();
      startDrill({ repos, name: `${deck.name} — Weak spots`, questions: weak, records, onExit });
    };
  }
}

// Collect every due question across all live decks (v1 launchReviewAll).
export async function collectDueQuestions(repos, nowMs = Date.now()) {
  const records = new Map();
  for (const rec of await repos.cardMemory.list()) records.set(rec.questionId, rec);
  const due = [];
  for (const deck of await repos.decks.list()) {
    for (const q of await repos.questions.listByDeck(deck.id)) {
      const rec = records.get(q.id);
      if (rec && isDue(rec, nowMs)) due.push(q);
    }
  }
  return { due, records };
}

// Collect weak questions for a set of decks (deck/class drills).
export async function collectWeakQuestions(repos, decks) {
  const records = new Map();
  for (const rec of await repos.cardMemory.list()) records.set(rec.questionId, rec);
  const weak = [];
  for (const deck of decks) {
    for (const q of await repos.questions.listByDeck(deck.id)) {
      const rec = records.get(q.id);
      if (rec && isWeak(rec)) weak.push(q);
    }
  }
  return { weak, records };
}
