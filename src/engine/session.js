// session.js — the quiz session state machine, ported from v1's QS logic
// (reference-v1/src/engine/quiz.js) with the DOM stripped out. The page
// renders; this decides. All v1 behavior preserved: scoring, streaks,
// drill re-filtering, time-challenge looping, mastery messages, results.
//
// THE TIMING CONTRACT lives here as named constants so the pages and the
// tests share one source of truth (values measured from v1 — see the
// Phase 5 report and CLAUDE.md).

import { gradeAnswer } from './grading.js';
import { updateRecord, emptyRecord, isWeak, isMastered, drillCleared } from './sm2.js';
import { shuffleAnswerPositions } from '../ai/json-repair.js';

export const TIMING = {
  SOURCE_IMAGE_DELAY: 50,     // wrong answer → source-image thumbnail (v1 :598)
  FR_FOCUS_DELAY: 80,         // question render → free-response autofocus (:405)
  TC_TIMEOUT_RESULTS_DELAY: 300, // timer hits 0 → results screen (:510)
  TC_AUTO_ADVANCE: 400,       // TC answer → next question, timer alive (:612)
  TC_TICK: 1000,              // countdown interval (:496)
  TC_URGENT_UNDER_S: 10,      // urgency pulse threshold (:500)
  CONFETTI_CLEANUP: 4000,     // confetti removal (:1821)
  CONFETTI_MIN_PCT: 80,       // results confetti threshold (:845)
};

// v1's letter-grade scale (:723–735).
export function letterGrade(pct) {
  if (pct >= 97) return { grade: 'A+', label: 'Perfect!' };
  if (pct >= 93) return { grade: 'A', label: 'Excellent!' };
  if (pct >= 90) return { grade: 'A-', label: 'Great job!' };
  if (pct >= 87) return { grade: 'B+', label: 'Good work!' };
  if (pct >= 83) return { grade: 'B', label: 'Solid effort' };
  if (pct >= 80) return { grade: 'B-', label: 'Not bad!' };
  if (pct >= 77) return { grade: 'C+', label: 'Getting there' };
  if (pct >= 73) return { grade: 'C', label: 'Keep studying' };
  if (pct >= 70) return { grade: 'C-', label: 'Needs work' };
  if (pct >= 67) return { grade: 'D+', label: 'Below average' };
  if (pct >= 60) return { grade: 'D', label: 'Study harder' };
  return { grade: 'F', label: 'Try again' };
}

// Creates one quiz session.
//   mode: 'standard' | 'drill' | 'timechallenge'   (exam has its own path)
//   records: Map<questionId, memoryRecord> — mutated as answers land
//   onRecord(questionId, newRecord): persist hook (fire-and-forget)
export function createSession({
  mode = 'standard',
  questions,
  records,
  tcSecs = 60,
  onRecord = () => {},
  now = () => Date.now(),
  rng = Math.random,
}) {
  const state = {
    mode,
    tcSecs,
    // Per-session answer-position shuffle, exactly like v1 startQS (:290).
    questions: questions.map((q) => shuffleAnswerPositions(q, rng)),
    current: 0,
    correct: 0,
    wrong: 0,
    streak: 0,
    bestStreak: 0,
    catStats: {},            // cat → {correct, total}
    missed: [],              // question objects answered wrong
    sessionMastered: [],     // question ids newly mastered/cleared
    answered: false,
    finished: false,
  };

  const getRecord = (qid) => records.get(qid) || emptyRecord();

  function currentQuestion() {
    return state.questions[state.current] || null;
  }

  // Answer the current question. Returns everything the page needs to
  // render the feedback beat — or null if answering isn't allowed.
  // `answer` payload: mc → index · fr → string · ms → index[].
  // Pass answer === null for a time-out (graded wrong, v1 idx=-1 path).
  function answer(payload, answerTimeMs = null) {
    if (state.answered || state.finished) return null; // lockout (v1 :520)
    const q = currentQuestion();
    if (!q) return null;
    state.answered = true;

    const correct = payload === null ? false : gradeAnswer(q, payload);

    // SM-2 update (v1 :532–537).
    const prev = getRecord(q.id);
    const wasWeak = isWeak(prev);
    const updated = updateRecord(prev, correct, answerTimeMs, now());
    records.set(q.id, updated);
    onRecord(q.id, updated);

    // Category stats (v1 :546–548).
    const cat = q.cat || 'General';
    state.catStats[cat] ??= { correct: 0, total: 0 };
    state.catStats[cat].total++;

    let message;
    if (correct) {
      state.correct++;
      state.streak++;
      state.bestStreak = Math.max(state.bestStreak, state.streak);
      state.catStats[cat].correct++;
      // v1's mastery messages (:565–568).
      message = 'Correct!';
      if (wasWeak && drillCleared(updated)) {
        message += ' Cleared from weak spots!';
        state.sessionMastered.push(q.id);
      } else if (isMastered(updated) && !state.sessionMastered.includes(q.id)) {
        message += ' Mastered!';
        state.sessionMastered.push(q.id);
      }
    } else {
      state.wrong++;
      state.streak = 0;
      state.missed.push(q);
      // v1's wrong-message formats (:586–594).
      const keys = ['A', 'B', 'C', 'D'];
      const pre = payload === null ? "Time's up! " : 'Not quite. ';
      if (q.type === 'free-response') {
        message = `Not quite. Correct: ${(q.ans || [])[0] || '—'}`;
      } else if (q.type === 'multi-select') {
        message = `Not quite. Correct: ${(q.ans || []).map((i) => keys[i]).join(', ')}`;
      } else {
        message = `${pre}Answer: ${q.opts[q.ans]}`;
      }
    }

    return {
      correct,
      message,
      explanation: q.explain || '',
      explanationSuffix: correct ? '' : ' — Added to weak spots.',
      question: q,
      record: updated,
    };
  }

  // Advance after feedback (v1 quizNext :616–637).
  // Returns {type:'question'} | {type:'results'} | {type:'drill-complete', cleared}.
  function next() {
    // THE v1 BUG FIX: advancing is impossible until the current question
    // has been answered — feedback ALWAYS shows first.
    if (!state.answered || state.finished) return { type: 'noop' };
    state.answered = false;
    state.current++;

    if (state.mode === 'timechallenge') {
      state.current = state.current % state.questions.length; // loop forever
      return { type: 'question', question: currentQuestion() };
    }

    if (state.mode === 'drill') {
      // Re-filter to still-weak after every answer (v1 :624–631).
      state.questions = state.questions.filter((q) => isWeak(getRecord(q.id)));
      if (state.questions.length === 0) {
        state.finished = true;
        return { type: 'drill-complete', cleared: state.sessionMastered.length };
      }
      state.current = state.current % state.questions.length;
      return { type: 'question', question: currentQuestion() };
    }

    if (state.current >= state.questions.length) {
      state.finished = true;
      return { type: 'results', results: results() };
    }
    return { type: 'question', question: currentQuestion() };
  }

  // Time challenge ran out (v1 showTCResults :848).
  function timeUp() {
    state.finished = true;
    const total = state.correct + state.wrong;
    const pct = total ? Math.round((state.correct / total) * 100) : 0;
    return { correct: state.correct, wrong: state.wrong, total, pct, bestStreak: state.bestStreak };
  }

  function results() {
    const total = state.questions.length;
    const pct = total ? Math.round((state.correct / total) * 100) : 0;
    return {
      ...letterGrade(pct),
      pct,
      correct: state.correct,
      total,
      missed: [...state.missed],
      mastered: state.sessionMastered
        .map((id) => state.questions.find((q) => q.id === id) || state.missed.find((q) => q.id === id))
        .filter(Boolean),
      catStats: { ...state.catStats },
      confetti: pct >= TIMING.CONFETTI_MIN_PCT,
    };
  }

  return { state, currentQuestion, answer, next, timeUp, results, getRecord };
}

// ── Exam grading (v1 submitExam :1236–1289): everything at once, no
// per-question feedback, SM-2 updated WITHOUT timing (binary quality). ──────
export function gradeExam({ questions, answers, records, onRecord, now = () => Date.now() }) {
  const perQuestion = [];
  let correctCount = 0;
  const catStats = {};

  questions.forEach((q, i) => {
    const payload = answers[i];
    const correct =
      payload === undefined || payload === '' ? false : gradeAnswer(q, payload);

    const prev = records.get(q.id) || emptyRecord();
    const updated = updateRecord(prev, correct, null, now());
    records.set(q.id, updated);
    onRecord(q.id, updated);

    const cat = q.cat || 'General';
    catStats[cat] ??= { correct: 0, total: 0 };
    catStats[cat].total++;
    if (correct) {
      correctCount++;
      catStats[cat].correct++;
    }
    perQuestion.push({ question: q, answer: payload, correct });
  });

  const total = questions.length;
  const pct = total ? Math.round((correctCount / total) * 100) : 0;
  return {
    ...letterGrade(pct),
    pct,
    correct: correctCount,
    total,
    perQuestion,
    missed: perQuestion.filter((p) => !p.correct).map((p) => p.question),
    catStats,
    confetti: pct >= TIMING.CONFETTI_MIN_PCT,
  };
}
