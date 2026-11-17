// sm2.js — the SM-2 spaced-repetition engine, ported byte-for-byte in
// behavior from reference-v1/src/engine/memory.js and proven identical by
// the parity harness in sm2.test.js (which runs a verbatim copy of v1's
// algorithm as an oracle).
//
// A memory record (one per question per user — v1 shapes preserved):
//   { correct, total, everWrong, lastResult, reps, ease, interval,
//     due (Unix ms), responseTimes: [{ms, ts, correct}] }
//
// v2 stores records as card_memory rows; these functions stay pure —
// callers load/save through repositories.

const DAY_MS = 86400000;

// A brand-new record (v1's getRec default).
export function emptyRecord() {
  return {
    correct: 0, total: 0, everWrong: false, lastResult: null,
    interval: 1, ease: 2.5, due: 0, reps: 0,
  };
}

// SM-2 quality score 1–5 from correctness + response speed, using p33/p66
// of THIS question's own correct-answer history. Falls back to binary 4/1
// when timing is unavailable or history is thin (<3 samples). (v1 verbatim)
function computeQuality(record, wasCorrect, answerTimeMs) {
  if (!answerTimeMs || answerTimeMs <= 0) return wasCorrect ? 4 : 1;

  const correctTimes = (record.responseTimes || [])
    .filter((e) => e.correct && e.ms > 0)
    .map((e) => e.ms)
    .sort((a, b) => a - b);

  if (correctTimes.length < 3) return wasCorrect ? 4 : 1;

  const p33 = correctTimes[Math.floor(correctTimes.length * 0.33)];
  const p66 = correctTimes[Math.floor(correctTimes.length * 0.66)];

  if (wasCorrect) {
    if (answerTimeMs <= p33) return 5; // fast correct  → very confident
    if (answerTimeMs <= p66) return 4; // normal correct → solid
    return 3;                          // slow correct   → hesitant
  }
  return 1; // wrong — fast or slow both reset
}

// Applies one answer to a record and returns the UPDATED COPY (v1 mutated
// in place; the math is identical — the parity tests prove it).
export function updateRecord(record, wasCorrect, answerTimeMs = null, nowMs = Date.now()) {
  const r = { ...emptyRecord(), ...record };
  r.total++;
  r.lastResult = wasCorrect ? 'correct' : 'wrong';

  // Record timing BEFORE computing quality, so the current answer joins
  // its own percentile pool — subtle v1 behavior, deliberately preserved.
  r.responseTimes = [...(r.responseTimes || [])];
  if (answerTimeMs && answerTimeMs > 0 && answerTimeMs < 60000) {
    r.responseTimes.push({ ms: answerTimeMs, correct: wasCorrect, ts: nowMs });
    if (r.responseTimes.length > 20) r.responseTimes = r.responseTimes.slice(-20);
  }

  if (wasCorrect) r.correct++;
  else r.everWrong = true;

  const q = computeQuality(r, wasCorrect, answerTimeMs);

  if (q >= 3) {
    r.reps++;
    if (r.reps === 1) r.interval = 1;
    else if (r.reps === 2) r.interval = 6;
    else r.interval = Math.round(r.interval * r.ease);
    r.ease = Math.max(1.3, r.ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  } else {
    r.reps = 0;
    r.interval = 1;
    r.ease = Math.max(1.3, r.ease - 0.2);
  }

  r.due = nowMs + r.interval * DAY_MS;
  return r;
}

// ── Card states (v1 thresholds) ─────────────────────────────────────────────
export const isMastered = (r) => r.reps >= 3;
export const drillCleared = (r) => r.everWrong && r.reps >= 2;
export const isWeak = (r) => r.everWrong && r.reps < 2;
export const isDue = (r, nowMs = Date.now()) => r.everWrong && (r.due || 0) <= nowMs;

// ── Session selection (v1: memory.js interleave + weightedSample) ───────────

// Reorders questions for cognitive interleaving:
//   Rule 1 — no same category back-to-back (takes priority).
//   Rule 2 — WEAK and STRONG questions alternate (WEAK → STRONG → …).
// getRecord(question) → memory record (or empty for unseen).
export function interleaveQuestions(questions, getRecord) {
  if (questions.length <= 1) return questions;

  const wQueue = [];
  const sQueue = [];
  questions.forEach((q) => {
    if (isWeak(getRecord(q))) wQueue.push(q);
    else sQueue.push(q);
  });

  // Sort each bucket by category so same-cat items cluster, which makes
  // the round-robin category-preference step effective.
  const byCat = (a, b) => (a.cat || '').localeCompare(b.cat || '');
  wQueue.sort(byCat);
  sQueue.sort(byCat);

  // Pick from a bucket, preferring a different category than lastCat.
  function pick(bucket, lastCat) {
    const idx = lastCat
      ? bucket.findIndex((q) => (q.cat || 'General') !== lastCat)
      : 0;
    return bucket.splice(idx >= 0 ? idx : 0, 1)[0];
  }

  const result = [];
  let lastCat = null;
  let lastWasWeak = false; // false → next pick comes from weak

  while (wQueue.length || sQueue.length) {
    if (!lastWasWeak && wQueue.length) {
      const q = pick(wQueue, lastCat);
      result.push(q); lastCat = q.cat || 'General'; lastWasWeak = true;
    } else if (sQueue.length) {
      const q = pick(sQueue, lastCat);
      result.push(q); lastCat = q.cat || 'General'; lastWasWeak = false;
    } else {
      const q = pick(wQueue, lastCat);
      result.push(q); lastCat = q.cat || 'General';
    }
  }

  return result;
}

// Adaptive sampling: due/unseen questions first (shuffled), the rest after
// (shuffled), take n. rng injectable for deterministic tests.
export function weightedSample(pool, getRecord, n, nowMs = Date.now(), rng = Math.random) {
  const overdue = [];
  const rest = [];
  pool.forEach((q) => {
    const r = getRecord(q);
    if (r.total === 0 || (r.due || 0) <= nowMs) overdue.push(q);
    else rest.push(q);
  });
  shuffle(overdue, rng);
  shuffle(rest, rng);
  return [...overdue, ...rest].slice(0, n);
}

export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
