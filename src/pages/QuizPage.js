// QuizPage.js — the quiz overlay (standard / drill / time challenge).
// The session state machine decides; this file renders and keeps v1's
// timing contract to the millisecond (constants in engine/session.js):
//   answer → verdict + explanation render SYNCHRONOUSLY (0ms)
//   wrong  → (source-image beat reserved at +50ms; images land Phase 6)
//   FR autofocus +80ms · TC auto-advance +400ms · TC 0s → +300ms → results
// Keyboard: A–D / 1–4 answer · Enter/Space advance ONLY once feedback is
// visible (the v1 free-response bug is fixed by construction: the session
// refuses next() before answer(), and the submitting keystroke never
// reaches the advance handler).

import { createSession, TIMING } from '../engine/session.js';
import { isWeak } from '../engine/sm2.js';
import { openFixAnswer, openEditQuestion } from './QuizFixTools.js';
import { showToast } from '../ui/toast.js';
import { openMenu } from '../ui/menu.js';
import { readAsDataURL } from '../ai/extract-files.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LETTERS = ['A', 'B', 'C', 'D'];

export function launchQuizOverlay({
  deckName, deckId = null, mode, questions, records, repos, sources = null, tcSecs = 60, onExit,
}) {
  const session = createSession({
    mode,
    questions,
    records,
    tcSecs,
    onRecord: (qid, rec) => void repos.cardMemory.saveForQuestion(qid, rec),
  });

  const overlay = document.createElement('div');
  overlay.className = 'quiz-overlay app-layer';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `${deckName} quiz`);
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  let questionStartTime = null;
  let feedbackVisible = false;
  let tcInterval = null;
  let tcRemaining = tcSecs;
  const timers = new Set();
  const later = (fn, ms) => {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
  };

  // ── Keyboard (v1 main.js :138–155) ────────────────────────────────────────
  function onKey(e) {
    // Never intercept while the free-response input is focused — its own
    // Enter handler submits (and stops propagation).
    if (document.activeElement?.id === 'fr-input') return;
    if (e.key === 'Enter' || e.key === ' ') {
      if (feedbackVisible && session.state.mode !== 'timechallenge') {
        e.preventDefault();
        advance();
      }
      return;
    }
    const map = { a: 0, b: 1, c: 2, d: 3, 1: 0, 2: 1, 3: 2, 4: 3 };
    const idx = map[e.key.toLowerCase()];
    if (idx !== undefined && !session.state.answered) {
      const q = session.currentQuestion();
      if (q && q.type === 'mc' && idx < (q.opts || []).length) answerMC(idx);
    }
  }
  document.addEventListener('keydown', onKey);

  function destroy() {
    clearInterval(tcInterval);
    for (const t of timers) clearTimeout(t);
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
    overlay.remove();
    onExit?.();
  }

  // ── Frame ────────────────────────────────────────────────────────────────
  const isTC = mode === 'timechallenge';
  overlay.innerHTML = `
    <div class="quiz-frame">
      <div class="quiz-hud">
        <button class="icon-btn" id="qz-exit" aria-label="Exit quiz">✕</button>
        <span class="hud-deck">${esc(deckName)}</span>
        ${isTC ? `<span class="tc-timer" id="qz-timer">${tcSecs}</span>` : `<span class="hud-num" id="qz-num"></span>`}
        <span class="hud-counts">
          <span class="hud-correct" id="qz-c">0</span>
          <span class="hud-wrong" id="qz-w">0</span>
        </span>
      </div>
      ${isTC ? '' : `<div class="pencil-progress"><div class="fill" id="qz-prog"></div></div>`}
      <div class="paper-sheet ruled"><div class="ruled-content">
        <div class="q-badges" id="qz-badges"></div>
        <p class="q-text" id="qz-text"></p>
      </div></div>
      <div class="q-options" id="qz-options"></div>
      <div id="qz-feedback"></div>
      <button class="btn-primary quiz-next" id="qz-next" style="display:none">Next →</button>
    </div>`;

  const g = (id) => overlay.querySelector('#' + id);
  g('qz-exit').onclick = () => destroy();
  g('qz-next').onclick = () => advance();

  // ── Question rendering ───────────────────────────────────────────────────
  function renderQuestion() {
    const q = session.currentQuestion();
    if (!q) return;
    feedbackVisible = false;
    questionStartTime = Date.now();

    if (!isTC) {
      g('qz-num').textContent = `Q${session.state.current + 1} of ${session.state.questions.length}`;
      g('qz-prog').style.width =
        `${(session.state.current / session.state.questions.length) * 100}%`;
    }

    const rec = session.getRecord(q.id);
    g('qz-badges').innerHTML = `
      <span class="chip">${esc(q.cat || 'General')}</span>
      ${isWeak(rec) ? `<span class="weak-badge">Revisiting · ${rec.total - rec.correct}x missed</span>` : ''}`;
    g('qz-text').textContent = q.q;
    g('qz-feedback').innerHTML = '';
    g('qz-next').style.display = 'none';

    const opts = g('qz-options');
    opts.innerHTML = '';
    if (q.type === 'free-response') {
      opts.innerHTML = `
        <div class="fr-row">
          <input id="fr-input" type="text" placeholder="Type your answer…"
                 autocomplete="off" spellcheck="false" aria-label="Your answer" />
          <button class="btn-primary" id="fr-submit">Submit</button>
        </div>`;
      const input = opts.querySelector('#fr-input');
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          // The submitting keystroke must never double as "advance".
          e.preventDefault();
          e.stopPropagation();
          submitFR();
        }
      });
      opts.querySelector('#fr-submit').onclick = () => submitFR();
      later(() => input.focus(), TIMING.FR_FOCUS_DELAY); // v1 +80ms
    } else if (q.type === 'multi-select') {
      opts.innerHTML = `
        <span class="ms-hint">☑ Select all that apply, then submit</span>
        ${q.opts.map((o, i) => `
          <button class="opt-btn" data-ms="${i}">
            <span class="opt-key">${LETTERS[i]}</span><span>${esc(o)}</span>
          </button>`).join('')}
        <button class="btn-primary" id="ms-submit">Submit</button>`;
      const selected = new Set();
      for (const btn of opts.querySelectorAll('[data-ms]')) {
        btn.onclick = () => {
          if (session.state.answered) return;
          const i = Number(btn.dataset.ms);
          selected.has(i) ? selected.delete(i) : selected.add(i);
          btn.classList.toggle('ms-selected', selected.has(i));
        };
      }
      opts.querySelector('#ms-submit').onclick = () => {
        const res = session.answer([...selected], elapsed());
        if (res) showFeedback(res, { msSelected: [...selected] });
      };
    } else {
      opts.innerHTML = q.opts.map((o, i) => `
        <button class="opt-btn" data-mc="${i}">
          <span class="opt-key">${LETTERS[i]}</span><span>${esc(o)}</span>
        </button>`).join('');
      for (const btn of opts.querySelectorAll('[data-mc]')) {
        btn.onclick = () => answerMC(Number(btn.dataset.mc));
      }
    }
  }

  const elapsed = () => (questionStartTime ? Date.now() - questionStartTime : null);

  function answerMC(idx) {
    const res = session.answer(idx, elapsed());
    if (res) showFeedback(res, { mcIndex: idx });
  }

  function submitFR() {
    const input = overlay.querySelector('#fr-input');
    if (!input || session.state.answered) return;
    const typed = input.value.trim();
    if (!typed) { input.focus(); return; }
    const res = session.answer(typed, elapsed());
    if (!res) return;
    input.disabled = true;
    input.classList.add(res.correct ? 'fr-correct' : 'fr-wrong');
    overlay.querySelector('#fr-submit').disabled = true;
    showFeedback(res);
  }

  // ── Feedback — ALL of this renders synchronously (v1 0ms contract) ───────
  function showFeedback(res, { mcIndex, msSelected } = {}) {
    const q = res.question;

    // Lock a choice WITHOUT dimming it: pointer-events:none + aria-disabled,
    // never the `disabled` attribute (which the global style fades).
    const lock = (btn) => { btn.classList.add('locked'); btn.setAttribute('aria-disabled', 'true'); };

    if (q.type === 'mc') {
      for (const btn of overlay.querySelectorAll('[data-mc]')) {
        const i = Number(btn.dataset.mc);
        lock(btn);
        if (i === q.ans) btn.classList.add('opt-correct');       // correct shown both ways (v1 :581)
        if (!res.correct && i === mcIndex) btn.classList.add('opt-wrong');
      }
    } else if (q.type === 'multi-select') {
      for (const btn of overlay.querySelectorAll('[data-ms]')) {
        const i = Number(btn.dataset.ms);
        lock(btn);
        btn.classList.remove('ms-selected'); // let the result color own the key badge
        const isCorrect = q.ans.includes(i);
        const wasPicked = msSelected?.includes(i);
        if (isCorrect && wasPicked) btn.classList.add('opt-correct');   // got it → green fill
        else if (isCorrect) btn.classList.add('opt-missed');            // should have → green outline
        else if (wasPicked) btn.classList.add('opt-wrong');            // shouldn't have → red
      }
      const ms = overlay.querySelector('#ms-submit');
      if (ms) ms.disabled = true; // the Submit action button may dim; it's not a choice
    }

    g('qz-feedback').innerHTML = `
      <div class="feedback-card ${res.correct ? 'fb-correct' : 'fb-wrong'}">
        <div class="fb-title">
          <span class="fb-check">${res.correct ? '✓' : '✗'}</span>
          <span>${esc(res.message)}</span>
        </div>
        ${res.explanation || res.explanationSuffix ? `
          <p class="fb-explain">${esc(res.explanation)}${esc(res.explanationSuffix)}</p>` : ''}
        <div class="fix-row">
          <button class="btn-link" id="fx-ans">✏️ Fix answer</button>
          <button class="btn-link" id="fx-text">✏️ Edit question</button>
          ${sources ? `<button class="btn-link" id="fx-img">${q.sourceImagePath ? '🖼️ Source image' : '📎 Attach image'}</button>` : ''}
        </div>
        <div id="qz-source-img"></div>
      </div>`;
    feedbackVisible = true;

    g('qz-c').textContent = session.state.correct;
    g('qz-w').textContent = session.state.wrong;

    overlay.querySelector('#fx-ans').onclick = () =>
      openFixAnswer({ liveQ: q, repos, records, onFixed: () => repaintCorrect(q) });
    overlay.querySelector('#fx-text').onclick = () =>
      openEditQuestion({ liveQ: q, repos, records, onSaved: () => { g('qz-text').textContent = q.q; } });

    if (sources) {
      overlay.querySelector('#fx-img').onclick = (e) =>
        handleImageButton(e.currentTarget, q);
      // v1: a question's source image appears on a WRONG answer, +50ms later.
      if (!res.correct && q.sourceImagePath) {
        later(() => void showSourceThumb(q), TIMING.SOURCE_IMAGE_DELAY);
      }
    }

    if (isTC) {
      // v1: auto-advance +400ms while the timer is alive (:612).
      later(() => { if (tcRemaining > 0) advance(); }, TIMING.TC_AUTO_ADVANCE);
    } else {
      g('qz-next').style.display = '';
    }
  }

  function repaintCorrect(q) {
    if (q.type !== 'mc') return;
    for (const btn of overlay.querySelectorAll('[data-mc]')) {
      btn.classList.remove('opt-correct', 'opt-wrong');
      if (Number(btn.dataset.mc) === q.ans) btn.classList.add('opt-correct');
    }
  }

  // ── Source image (attach / view / remove) ────────────────────────────────
  async function showSourceThumb(q) {
    const host = overlay.querySelector('#qz-source-img');
    if (!host || !q.sourceImagePath) return;
    const url = await sources.signedUrl(q.sourceImagePath);
    if (!url || !overlay.isConnected) return;
    host.innerHTML = `
      <div class="source-img-wrap">
        <div class="source-img-label">📎 Source reference</div>
        <img class="source-img-thumb" src="${url}" alt="Source reference" title="Open full size" />
      </div>`;
    host.querySelector('img').onclick = () => window.open(url, '_blank', 'noopener');
  }

  function pickAndUpload(q) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) return showToast('Image too large (max 10 MB)');
      showToast('Uploading image…');
      const path = await sources.uploadQuestionImage(q.id, await readAsDataURL(file));
      if (!path) return showToast('Could not upload image');
      await repos.questions.update(q.id, { sourceImagePath: path });
      q.sourceImagePath = path;
      const btn = overlay.querySelector('#fx-img');
      if (btn) btn.textContent = '🖼️ Source image';
      showToast('✓ Source image attached');
      void showSourceThumb(q);
    };
    input.click();
  }

  function handleImageButton(anchor, q) {
    if (!q.sourceImagePath) return pickAndUpload(q);
    openMenu(anchor, [
      { label: 'View', onClick: () => void showSourceThumb(q) },
      { label: 'Replace', onClick: () => pickAndUpload(q) },
      { label: 'Remove', danger: true, onClick: async () => {
          await sources.removeObject(q.sourceImagePath);
          await repos.questions.update(q.id, { sourceImagePath: null });
          q.sourceImagePath = null;
          const btn = overlay.querySelector('#fx-img');
          if (btn) btn.textContent = '📎 Attach image';
          const host = overlay.querySelector('#qz-source-img');
          if (host) host.innerHTML = '';
          showToast('Source image removed');
        } },
    ]);
  }

  function advance() {
    const step = session.next();
    if (step.type === 'question') renderQuestion();
    else if (step.type === 'results') showResults(step.results);
    else if (step.type === 'drill-complete') showDrillComplete(step.cleared);
  }

  // ── Time challenge countdown (v1 :489–513) ───────────────────────────────
  if (isTC) {
    const timerEl = g('qz-timer');
    tcInterval = setInterval(() => {
      tcRemaining--;
      timerEl.textContent = tcRemaining;
      timerEl.classList.toggle('urgent', tcRemaining < TIMING.TC_URGENT_UNDER_S);
      if (tcRemaining <= 0) {
        clearInterval(tcInterval);
        timerEl.classList.remove('urgent');
        later(() => showTCResults(), TIMING.TC_TIMEOUT_RESULTS_DELAY); // +300ms
      }
    }, TIMING.TC_TICK);
  }

  // ── Results screens ──────────────────────────────────────────────────────
  function resultsFrame(inner) {
    feedbackVisible = false;
    overlay.innerHTML = `<div class="quiz-frame"><div class="paper-sheet results-sheet">${inner}</div></div>`;
  }

  function showResults(r) {
    resultsFrame(`
      <p class="res-grade">${r.grade}</p>
      <p class="res-label">${esc(r.label)}</p>
      <p class="res-score">${r.correct}/${r.total} · ${r.pct}%</p>
      ${r.missed.length ? `
        <div class="res-panel">
          <h4>Missed — review these</h4>
          ${r.missed.map((q) => `
            <div class="res-missed-item">${esc(q.q)}<br>
              <span class="ans">Answer: ${esc(answerText(q))}</span></div>`).join('')}
        </div>` : ''}
      ${r.mastered.length ? `
        <div class="res-panel"><h4>Leveled up</h4>
          ${r.mastered.map((q) => `<div class="res-missed-item">${esc(q.q)}</div>`).join('')}
        </div>` : ''}
      ${catBreakdown(r.catStats)}
      <div class="res-actions">
        <button class="btn-primary" id="res-done">Done</button>
      </div>`);
    overlay.querySelector('#res-done').onclick = () => destroy();
    if (r.confetti) launchConfetti();
    if (deckId && mode === 'standard') void repos.decks.update(deckId, { lastScore: r.pct });
  }

  function showDrillComplete(cleared) {
    resultsFrame(`
      <p class="res-grade" style="color:var(--pen-green)">🎯</p>
      <p class="res-label">Drill complete</p>
      <p class="res-score">${cleared > 0
        ? `${cleared} weak spot${cleared === 1 ? '' : 's'} cleared!`
        : 'Keep at it — they fade with reps.'}</p>
      <div class="res-actions"><button class="btn-primary" id="res-done">Done</button></div>`);
    overlay.querySelector('#res-done').onclick = () => destroy();
    if (cleared > 0) launchConfetti();
  }

  async function showTCResults() {
    const tc = session.timeUp();
    let isNewBest = false;
    if (deckId) {
      const prev = await repos.highScores.best(deckId, tcSecs);
      isNewBest = !prev || tc.correct > prev.correct;
      if (isNewBest) await repos.highScores.record(deckId, tcSecs, tc.correct, tc.total);
    }
    resultsFrame(`
      ${isNewBest ? `<p class="hs-banner">New high score!</p>` : ''}
      <p class="res-grade" style="color:var(--pen-blue)">${tc.correct}</p>
      <p class="res-label">correct in ${tcSecs} seconds</p>
      <p class="res-score">${tc.correct}/${tc.total} attempted · ${tc.pct}% · best streak ${tc.bestStreak}</p>
      <div class="res-actions"><button class="btn-primary" id="res-done">Done</button></div>`);
    overlay.querySelector('#res-done').onclick = () => destroy();
    if (isNewBest) launchConfetti();
  }

  renderQuestion();
  return { destroy };
}

function answerText(q) {
  if (q.type === 'free-response') return (q.ans || [])[0] || '';
  if (q.type === 'multi-select') {
    return (q.ans || []).map((i) => `${LETTERS[i]}) ${(q.opts || [])[i] || ''}`).join(', ');
  }
  return (q.opts || [])[q.ans] || '';
}

function catBreakdown(catStats) {
  const cats = Object.entries(catStats || {});
  if (!cats.length) return '';
  return `
    <div class="res-panel"><h4>By topic</h4>
      ${cats.map(([cat, st]) => {
        const pct = st.total ? Math.round((st.correct / st.total) * 100) : 0;
        return `
          <div class="cat-row">
            <span class="cat-name">${esc(cat)}</span>
            <div class="pencil-progress"><div class="fill" style="width:${pct}%"></div></div>
            <span class="cat-n">${st.correct}/${st.total}</span>
          </div>`;
      }).join('')}
    </div>`;
}

// Paper-scrap confetti (v1 :1776–1822 — 80 pieces, 1.5–3.5s, gone at 4s).
export function launchConfetti() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;overflow:hidden;';
  document.body.appendChild(host);
  const colors = ['#b02a21', '#1d4f91', '#1e6f3e', '#8a4c0f', '#6a3fa0', '#0f6b6b', '#e8b23c', '#faf6ef'];
  for (let i = 0; i < 80; i++) {
    const piece = document.createElement('div');
    const size = 6 + Math.random() * 6;
    piece.className = 'confetti-piece';
    piece.style.cssText = `
      left:${Math.random() * 100}%;
      width:${size}px;height:${size * 0.6}px;
      background:${colors[Math.floor(Math.random() * colors.length)]};
      transform:rotate(${Math.random() * 360}deg);
      animation:confettiFall ${1.5 + Math.random() * 2}s ease-in ${Math.random() * 0.5}s forwards;`;
    host.appendChild(piece);
  }
  setTimeout(() => host.remove(), TIMING.CONFETTI_CLEANUP);
}
