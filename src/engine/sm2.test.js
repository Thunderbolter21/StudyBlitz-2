// sm2.test.js — SM-2 parity against v1.
// Part 1: named scenario cases (the table shown in the phase report).
// Part 2: randomized fuzz — hundreds of answer sequences fed to BOTH the
// v2 port and a verbatim copy of v1's code; records must match exactly.
// Part 3: selection helpers (interleave / weightedSample) and state rules.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  emptyRecord, updateRecord, isMastered, drillCleared, isWeak, isDue,
  interleaveQuestions, weightedSample,
} from './sm2.js';
import { v1UpdateRec, v1GetRec } from './testing/v1-oracle.js';

const NOW = Date.parse('2026-11-16T12:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW); // oracle uses Date.now(); v2 gets nowMs = NOW
});
afterEach(() => vi.useRealTimers());

// Runs one answer sequence through BOTH implementations, returns both
// final records. steps: [{ correct: bool, ms: number|null }]
function runBoth(steps) {
  const mem = {}; // v1 oracle state
  let v2 = undefined; // v2 starts with no record, like a fresh question
  for (const step of steps) {
    v1UpdateRec(mem, 'q1', step.correct, step.ms);
    v2 = updateRecord(v2 ?? {}, step.correct, step.ms, Date.now());
  }
  return { v1: v1GetRec(mem, 'q1'), v2 };
}

const expectParity = ({ v1, v2 }) => {
  // Compare every SM-2 field v1 tracks (v2 may not add anything else).
  expect(v2.correct).toBe(v1.correct);
  expect(v2.total).toBe(v1.total);
  expect(v2.everWrong).toBe(v1.everWrong);
  expect(v2.lastResult).toBe(v1.lastResult);
  expect(v2.reps).toBe(v1.reps);
  expect(v2.ease).toBe(v1.ease);
  expect(v2.interval).toBe(v1.interval);
  expect(v2.due).toBe(v1.due);
  expect(v2.responseTimes ?? []).toEqual(v1.responseTimes ?? []);
  return { v1, v2 };
};

// ── Part 1: the named scenario table ────────────────────────────────────────
// Each case is asserted for parity AND against hand-derived v1 expectations.
export const TABLE_CASES = [
  // NOTE: at quality 4 (normal correct) the ease delta is +0.1 − 1×(0.08+0.02)
  // = exactly 0 — ease only RISES on fast q5 answers. The oracle run exposed
  // my first hand-derived expectations as wrong; these are v1's real numbers.
  { name: '1. new card, first correct (no timing)',
    steps: [{ correct: true, ms: null }],
    expected: { reps: 1, interval: 1, ease: 2.5, everWrong: false } },
  { name: '2. new card, first wrong',
    steps: [{ correct: false, ms: null }],
    expected: { reps: 0, interval: 1, ease: 2.3, everWrong: true } },
  { name: '3. two consecutive correct → interval jumps to 6, ease flat',
    steps: [{ correct: true }, { correct: true }],
    expected: { reps: 2, interval: 6, ease: 2.5 } },
  { name: '4. three consecutive correct → interval = round(6 × ease) = 15',
    steps: [{ correct: true }, { correct: true }, { correct: true }],
    expected: { reps: 3, interval: 15, ease: 2.5 } },
  { name: '5. correct then wrong → full reset + ease −0.2',
    steps: [{ correct: true }, { correct: false }],
    expected: { reps: 0, interval: 1, ease: 2.3, everWrong: true } },
  { name: '6. ease floor: five wrongs never drop below 1.3',
    steps: Array(5).fill({ correct: false }),
    expected: { ease: 1.5, reps: 0, interval: 1 } }, // 2.5 − 5×0.2
  { name: '7. ten wrongs clamp at the 1.3 floor',
    steps: Array(10).fill({ correct: false }),
    expected: { ease: 1.3 } },
  { name: '8. timing with thin history (<3 correct samples) stays binary q4',
    steps: [{ correct: true, ms: 1200 }, { correct: true, ms: 1300 }],
    expected: { reps: 2, interval: 6, ease: 2.5 } },
  { name: '9. FAST correct with history → q5 (full +0.1 ease reward)',
    // three correct build history (1000/2000/3000ms), then a 500ms answer
    steps: [{ correct: true, ms: 1000 }, { correct: true, ms: 2000 },
            { correct: true, ms: 3000 }, { correct: true, ms: 500 }],
    expected: { reps: 4 } },
  { name: '10. SLOW correct with history → q3 (reps advance, ease penalty)',
    steps: [{ correct: true, ms: 1000 }, { correct: true, ms: 1100 },
            { correct: true, ms: 1200 }, { correct: true, ms: 9000 }],
    expected: { reps: 4 } },
  { name: '11. wrong WITH timing → q1 reset (speed never softens a miss)',
    steps: [{ correct: true, ms: 1000 }, { correct: true, ms: 1100 },
            { correct: true, ms: 1200 }, { correct: false, ms: 400 }],
    expected: { reps: 0, interval: 1, everWrong: true } },
  { name: '12. responseTimes capped at the last 20 entries',
    steps: Array.from({ length: 25 }, (_, i) => ({ correct: true, ms: 1000 + i })),
    expected: {} },
  { name: '13. timing ≥ 60000ms is NOT recorded (walked away mid-question)',
    steps: [{ correct: true, ms: 65000 }],
    expected: { reps: 1 } },
];

describe('SM-2 parity — named scenarios (report table)', () => {
  for (const c of TABLE_CASES) {
    it(c.name, () => {
      const { v1, v2 } = expectParity(runBoth(c.steps));
      for (const [key, value] of Object.entries(c.expected)) {
        expect(v2[key], `${c.name} → ${key}`).toBeCloseTo(value, 10);
        expect(v1[key], `${c.name} (oracle) → ${key}`).toBeCloseTo(value, 10);
      }
      if (c.name.startsWith('12.')) {
        expect(v2.responseTimes).toHaveLength(20);
        expect(v2.responseTimes[0].ms).toBe(1005); // first 5 dropped
      }
      if (c.name.startsWith('13.')) {
        expect(v2.responseTimes ?? []).toHaveLength(0);
      }
    });
  }

  it('due date = now + interval days, both implementations', () => {
    const { v1, v2 } = runBoth([{ correct: true }, { correct: true }]);
    expect(v2.due).toBe(NOW + 6 * 86400000);
    expect(v1.due).toBe(v2.due);
  });
});

// ── Part 2: randomized fuzz parity ──────────────────────────────────────────
describe('SM-2 parity — randomized sequences', () => {
  it('400 random answer sequences produce byte-identical records', () => {
    let seed = 1234567;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let run = 0; run < 400; run++) {
      const len = 1 + Math.floor(rnd() * 30);
      const steps = Array.from({ length: len }, () => ({
        correct: rnd() < 0.6,
        // Mix of null, negative, zero, normal, boundary, and oversized times
        ms: [null, -50, 0, 400, 1500, 4000, 25000, 59999, 60000, 90000][
          Math.floor(rnd() * 10)],
      }));
      expectParity(runBoth(steps));
    }
  });
});

// ── Part 3: card states + selection ─────────────────────────────────────────
describe('card states (v1 thresholds)', () => {
  it('weak = everWrong && reps < 2; cleared at reps ≥ 2; mastered at ≥ 3', () => {
    let r = updateRecord(emptyRecord(), false, null, NOW);
    expect(isWeak(r)).toBe(true);
    r = updateRecord(r, true, null, NOW);
    expect(isWeak(r)).toBe(true);     // reps 1 — still weak
    r = updateRecord(r, true, null, NOW);
    expect(isWeak(r)).toBe(false);    // reps 2 — cleared
    expect(drillCleared(r)).toBe(true);
    expect(isMastered(r)).toBe(false);
    r = updateRecord(r, true, null, NOW);
    expect(isMastered(r)).toBe(true); // reps 3
  });

  it('due only applies to ever-wrong cards whose due time has passed', () => {
    const neverWrong = updateRecord(emptyRecord(), true, null, NOW);
    expect(isDue(neverWrong, NOW + 999 * 86400000)).toBe(false); // never wrong → never due
    const wrong = updateRecord(emptyRecord(), false, null, NOW);
    expect(isDue(wrong, NOW)).toBe(false);                 // due is tomorrow
    expect(isDue(wrong, NOW + 86400000)).toBe(true);       // now it's due
  });
});

describe('selection (v1 behavior)', () => {
  const q = (id, cat) => ({ id, cat });
  const recs = new Map();
  const getRecord = (question) => recs.get(question.id) || emptyRecord();

  it('interleave: no same category back-to-back when avoidable', () => {
    recs.clear();
    const questions = [q('a1', 'A'), q('a2', 'A'), q('b1', 'B'), q('b2', 'B')];
    const out = interleaveQuestions(questions, getRecord);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].cat, `position ${i}`).not.toBe(out[i - 1].cat);
    }
  });

  it('interleave: weak and strong alternate, weak first', () => {
    recs.clear();
    recs.set('w1', updateRecord(emptyRecord(), false, null, NOW));
    recs.set('w2', updateRecord(emptyRecord(), false, null, NOW));
    const questions = [q('s1', 'A'), q('w1', 'B'), q('s2', 'C'), q('w2', 'D')];
    const out = interleaveQuestions(questions, getRecord);
    expect(isWeak(getRecord(out[0]))).toBe(true);   // starts weak
    expect(isWeak(getRecord(out[1]))).toBe(false);  // then strong
    expect(isWeak(getRecord(out[2]))).toBe(true);
    expect(isWeak(getRecord(out[3]))).toBe(false);
  });

  it('weightedSample puts due/unseen cards ahead of scheduled-out ones', () => {
    recs.clear();
    // "scheduled" was answered correctly → due tomorrow (not due now)
    recs.set('scheduled', updateRecord(emptyRecord(), true, null, NOW));
    const pool = [q('scheduled', 'A'), q('unseen1', 'B'), q('unseen2', 'C')];
    const out = weightedSample(pool, getRecord, 3, NOW, () => 0.5);
    expect(out[2].id).toBe('scheduled'); // always last
    expect(out.map((x) => x.id).sort()).toEqual(['scheduled', 'unseen1', 'unseen2']);
  });
});
