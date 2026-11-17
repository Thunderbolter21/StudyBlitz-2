// ExamPage.js — exam mode (v1 :1066–1296): every question at once, no
// per-question feedback, graded on submit (SM-2 without timing), then an
// annotated read-only review with "why this was wrong" notes.

import { gradeExam } from '../engine/session.js';
import { gradeAnswer } from '../engine/grading.js';
import { shuffleAnswerPositions } from '../ai/json-repair.js';
import { shuffle } from '../engine/sm2.js';
import { launchConfetti } from './QuizPage.js';
import { confirmModal } from '../ui/dialogs.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LETTERS = ['A', 'B', 'C', 'D'];

export function launchExamOverlay({ deckName, questions: rawQuestions, records, repos, count, onExit }) {
  // v1 :1077 — random subset, re-shuffled answer positions per exam.
  const questions = shuffle([...rawQuestions]).slice(0, count).map((q) => shuffleAnswerPositions(q));
  const answers = {}; // index → payload

  const overlay = document.createElement('div');
  overlay.className = 'quiz-overlay app-layer';
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  function destroy() {
    document.body.style.overflow = '';
    overlay.remove();
    onExit?.();
  }

  function unansweredCount() {
    return questions.filter((q, i) => {
      const a = answers[i];
      if (q.type === 'multi-select') return !Array.isArray(a) || a.length === 0;
      return a === undefined || a === '';
    }).length;
  }

  function render(review = null) {
    overlay.innerHTML = `
      <div class="quiz-frame">
        <div class="quiz-hud">
          <button class="icon-btn" id="ex-exit" aria-label="Exit exam">✕</button>
          <span class="hud-deck">${esc(deckName)} — ${review ? 'Review' : 'Exam'}</span>
          <span class="hud-num">${questions.length} questions</span>
        </div>
        <div class="paper-sheet">
          ${questions.map((q, i) => renderQuestion(q, i, review)).join('')}
          ${review ? `
            <div class="res-actions"><button class="btn-primary" id="ex-done">Done</button></div>
          ` : `
            <p class="exam-warn" id="ex-warn" role="status"></p>
            <div class="res-actions"><button class="btn-primary" id="ex-submit">Submit exam</button></div>
          `}
        </div>
      </div>`;

    overlay.querySelector('#ex-exit').onclick = () => destroy();

    if (review) {
      overlay.querySelector('#ex-done').onclick = () => destroy();
      return;
    }

    // Input wiring (answers persist across re-renders via the map).
    for (const el of overlay.querySelectorAll('[data-exam-mc]')) {
      el.addEventListener('change', () => {
        answers[Number(el.dataset.examMc)] = Number(el.value);
        updateWarn();
      });
    }
    for (const el of overlay.querySelectorAll('[data-exam-fr]')) {
      el.addEventListener('input', () => {
        answers[Number(el.dataset.examFr)] = el.value.trim();
        updateWarn();
      });
    }
    for (const btn of overlay.querySelectorAll('[data-exam-ms]')) {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.examMs);
        const j = Number(btn.dataset.opt);
        const list = Array.isArray(answers[i]) ? answers[i] : [];
        answers[i] = list.includes(j) ? list.filter((x) => x !== j) : [...list, j];
        btn.classList.toggle('ms-selected', answers[i].includes(j));
        updateWarn();
      });
    }
    overlay.querySelector('#ex-submit').onclick = () => submit();
    updateWarn();
  }

  function renderQuestion(q, i, review) {
    const head = `
      <div class="exam-q-head">
        ${review ? `<span class="exam-review-badge">${review.perQuestion[i].correct ? '✓' : '✗'}</span>` : ''}
        <span class="exam-q-num">${i + 1}.</span>
        <p class="q-text">${esc(q.q)}</p>
        <span class="chip">${esc(q.cat || '')}</span>
      </div>`;

    let bodyHtml = '';
    if (q.type === 'free-response') {
      const val = typeof answers[i] === 'string' ? answers[i] : '';
      if (review) {
        const ok = review.perQuestion[i].correct;
        bodyHtml = `<div class="fr-row">
          <input value="${esc(val)}" disabled class="${ok ? 'fr-correct' : 'fr-wrong'}" /></div>
          ${ok ? '' : reviewNote(`Correct: ${(q.ans || [])[0] || '—'}`, q.explain)}`;
      } else {
        bodyHtml = `<div class="fr-row">
          <input data-exam-fr="${i}" value="${esc(val)}" placeholder="Type your answer…"
                 autocomplete="off" spellcheck="false" /></div>`;
      }
    } else if (q.type === 'multi-select') {
      const sel = Array.isArray(answers[i]) ? answers[i] : [];
      bodyHtml = q.opts.map((o, j) => {
        const classes = ['exam-opt'];
        if (review) {
          // chosen-correct → filled green · missed-correct → green outline ·
          // wrong pick → red. Nothing dims; marks carry the signal too.
          if (q.ans.includes(j)) classes.push(sel.includes(j) ? 'review-correct' : 'review-missed');
          else if (sel.includes(j)) classes.push('review-wrong-pick');
        }
        return review
          ? `<div class="${classes.join(' ')}">${LETTERS[j]}) ${esc(o)}</div>`
          : `<button type="button" class="exam-opt opt-btn ${sel.includes(j) ? 'ms-selected' : ''}"
               data-exam-ms="${i}" data-opt="${j}" style="box-shadow:none;min-height:var(--touch-min)">
               <span class="opt-key">${LETTERS[j]}</span>${esc(o)}</button>`;
      }).join('') + (review && !review.perQuestion[i].correct
        ? reviewNote(`Correct: ${q.ans.map((x) => LETTERS[x]).join(', ')}`, q.explain) : '');
    } else {
      const sel = answers[i];
      bodyHtml = q.opts.map((o, j) => {
        if (review) {
          const classes = ['exam-opt'];
          if (j === q.ans) classes.push('review-correct');
          else if (!review.perQuestion[i].correct && j === sel) classes.push('review-wrong-pick');
          return `<div class="${classes.join(' ')}">${LETTERS[j]}) ${esc(o)}</div>`;
        }
        return `<label class="exam-opt">
          <input type="radio" name="exam-${i}" value="${j}" data-exam-mc="${i}" ${sel === j ? 'checked' : ''} />
          <strong>${LETTERS[j]}</strong> ${esc(o)}</label>`;
      }).join('') + (review && !review.perQuestion[i].correct && q.explain
        ? reviewNote(null, q.explain) : '');
    }

    return `<div class="exam-q">${head}${bodyHtml}</div>`;
  }

  const reviewNote = (wrongMsg, explain) => `
    <div class="exam-review-note">
      ${[wrongMsg, explain].filter(Boolean).map(esc).join(' — ')}
    </div>`;

  function updateWarn() {
    const n = unansweredCount();
    const el = overlay.querySelector('#ex-warn');
    if (el) el.textContent = n > 0 ? `${n} question${n === 1 ? '' : 's'} unanswered` : '';
  }

  async function submit() {
    const n = unansweredCount();
    if (n > 0) {
      const go = await confirmModal({
        title: 'Submit anyway?',
        bodyText: `You have ${n} unanswered question${n === 1 ? '' : 's'}. Unanswered counts as wrong.`,
        confirmLabel: 'Submit', danger: false,
      });
      if (!go) return;
    }
    const result = gradeExam({
      questions, answers, records,
      onRecord: (qid, rec) => void repos.cardMemory.saveForQuestion(qid, rec),
    });
    showResults(result);
  }

  function showResults(r) {
    overlay.innerHTML = `
      <div class="quiz-frame"><div class="paper-sheet results-sheet">
        <p class="res-grade">${r.grade}</p>
        <p class="res-label">${esc(r.label)}</p>
        <p class="res-score">${r.correct}/${r.total} · ${r.pct}%</p>
        <div class="res-actions">
          <button class="btn-ghost" id="ex-review">Review answers</button>
          <button class="btn-primary" id="ex-done">Done</button>
        </div>
      </div></div>`;
    overlay.querySelector('#ex-done').onclick = () => destroy();
    overlay.querySelector('#ex-review').onclick = () => render(r);
    if (r.confetti) launchConfetti();
  }

  render();
  return { destroy };
}

// Double-check an exam answer the same way grading does (exported for tests).
export const isAnswerCorrect = gradeAnswer;
