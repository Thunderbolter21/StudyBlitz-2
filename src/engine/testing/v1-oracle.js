// v1-oracle.js — TEST-ONLY. A VERBATIM copy of v1's SM-2 implementation
// (reference-v1/src/engine/memory.js, lines 15–89), used as the ground
// truth the v2 port is compared against. Do not "improve" this file —
// its value is being exactly what v1 shipped. Not bundled in the app.

const DAY_MS = 86400000;

export function v1GetRec(mem, id) {
  const r = mem[id];
  if (!r) return { correct: 0, total: 0, everWrong: false, lastResult: null, interval: 1, ease: 2.5, due: 0, reps: 0 };
  if (r.interval === undefined) {
    r.interval = 1;
    r.ease = 2.5;
    r.due = 0;
    r.reps = r.correct >= 3 && r.everWrong && r.weight === 1 ? 3 : 0;
    delete r.weight;
  }
  return r;
}

function computeQuality(r, wasCorrect, answerTimeMs) {
  if (!answerTimeMs || answerTimeMs <= 0) return wasCorrect ? 4 : 1;

  const correctTimes = (r.responseTimes || [])
    .filter(e => e.correct && e.ms > 0)
    .map(e => e.ms)
    .sort((a, b) => a - b);

  if (correctTimes.length < 3) return wasCorrect ? 4 : 1;

  const p33 = correctTimes[Math.floor(correctTimes.length * 0.33)];
  const p66 = correctTimes[Math.floor(correctTimes.length * 0.66)];

  if (wasCorrect) {
    if (answerTimeMs <= p33) return 5;
    if (answerTimeMs <= p66) return 4;
    return 3;
  }
  return 1;
}

export function v1UpdateRec(mem, id, wasCorrect, answerTimeMs = null) {
  const r = v1GetRec(mem, id);
  r.total++;
  r.lastResult = wasCorrect ? 'correct' : 'wrong';

  r.responseTimes = r.responseTimes || [];
  if (answerTimeMs && answerTimeMs > 0 && answerTimeMs < 60000) {
    r.responseTimes.push({ ms: answerTimeMs, correct: wasCorrect, ts: Date.now() });
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

  r.due = Date.now() + r.interval * DAY_MS;
  mem[id] = r;
  return mem;
}
