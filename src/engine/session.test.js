// session.test.js — the quiz session state machine: scoring, streaks,
// mastery messages, drill looping, TC wraparound, exam grading, the
// letter-grade scale, and the v1 free-response bug fix (feedback must
// always come before advancing).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSession, gradeExam, letterGrade, TIMING } from './session.js';

const NOW = Date.parse('2026-11-16T12:00:00Z');
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const mc = (id, ans = 0, cat = 'General') => ({
  id, type: 'mc', q: `Q ${id}?`, opts: ['a', 'b', 'c', 'd'], ans, explain: `because ${id}`, cat,
});
const fr = (id) => ({ id, type: 'free-response', q: '___?', opts: null, ans: ['two'], explain: 'e', cat: 'X' });

// rng that never shuffles → answer positions stay put, tests stay simple.
const noShuffle = () => 0.999999;

function makeSession(overrides = {}) {
  const records = new Map();
  const saved = [];
  const session = createSession({
    questions: [mc('q1', 1), mc('q2', 2), fr('q3')],
    records,
    onRecord: (id, rec) => saved.push({ id, rec }),
    rng: noShuffle,
    ...overrides,
  });
  return { session, records, saved };
}

describe('standard mode flow', () => {
  it('tracks correct/wrong/streak and persists every record', () => {
    const { session, saved } = makeSession();
    expect(session.answer(1).correct).toBe(true);     // q1 right
    session.next();
    expect(session.answer(0).correct).toBe(false);    // q2 wrong
    session.next();
    expect(session.answer('TWO!').correct).toBe(true); // q3 fr right
    const end = session.next();

    expect(end.type).toBe('results');
    expect(end.results.correct).toBe(2);
    expect(end.results.total).toBe(3);
    expect(end.results.pct).toBe(67);
    expect(end.results.grade).toBe('D+');
    expect(end.results.missed.map((q) => q.id)).toEqual(['q2']);
    expect(saved).toHaveLength(3); // one persist per answer
  });

  it('explanation is included for correct AND wrong answers (v1 behavior)', () => {
    const { session } = makeSession();
    const right = session.answer(1);
    expect(right.explanation).toBe('because q1');
    session.next();
    const wrong = session.answer(0);
    expect(wrong.explanation).toBe('because q2');
    expect(wrong.explanationSuffix).toBe(' — Added to weak spots.');
    expect(right.explanationSuffix).toBe('');
  });

  it('v1 wrong-message formats: mc text, fr first variant, ms letters, timeout', () => {
    const records = new Map();
    const session = createSession({
      questions: [
        mc('m', 2), fr('f'),
        { id: 's', type: 'multi-select', q: '?', opts: ['a', 'b', 'c', 'd'], ans: [0, 2], explain: '', cat: 'X' },
        mc('t', 1),
      ],
      records, rng: noShuffle,
    });
    expect(session.answer(0).message).toBe('Not quite. Answer: c');
    session.next();
    expect(session.answer('nope').message).toBe('Not quite. Correct: two');
    session.next();
    expect(session.answer([1]).message).toBe('Not quite. Correct: A, C');
    session.next();
    expect(session.answer(null).message).toBe("Time's up! Answer: b");
  });

  it('mastery messages: "Cleared from weak spots!" then "Mastered!"', () => {
    const records = new Map();
    const q = mc('w1', 0);
    // Make it weak first: one wrong answer on a fresh record.
    const session1 = createSession({ questions: [q], records, rng: noShuffle });
    session1.answer(3);
    expect(records.get('w1').everWrong).toBe(true);

    // Right answer #1: still weak (reps 1) → plain "Correct!".
    const s2 = createSession({ questions: [q], records, rng: noShuffle });
    expect(s2.answer(0).message).toBe('Correct!');
    // Right answer #2: reps 2 → cleared.
    const s3 = createSession({ questions: [q], records, rng: noShuffle });
    expect(s3.answer(0).message).toBe('Correct! Cleared from weak spots!');
    // Right answer #3: reps 3 → mastered.
    const s4 = createSession({ questions: [q], records, rng: noShuffle });
    expect(s4.answer(0).message).toBe('Correct! Mastered!');
  });
});

describe('the v1 free-response bug fix', () => {
  it('next() before answering is a hard no-op — feedback always first', () => {
    const { session } = makeSession();
    expect(session.next().type).toBe('noop');        // Enter mashed early
    expect(session.state.current).toBe(0);           // did not move
    session.answer(1);                               // feedback beat happens
    expect(session.next().type).toBe('question');    // NOW it advances
  });

  it('double-answering the same question is locked out (v1 :520)', () => {
    const { session, saved } = makeSession();
    expect(session.answer(1)).not.toBeNull();
    expect(session.answer(2)).toBeNull(); // second click ignored
    expect(saved).toHaveLength(1);
  });
});

describe('drill mode', () => {
  it('re-filters to still-weak after each answer and finishes when cleared', () => {
    const records = new Map();
    const q = mc('d1', 0);
    // Seed as weak: wrong once (reps 0, everWrong).
    createSession({ questions: [q], records, rng: noShuffle }).answer(3);

    const drill = createSession({ questions: [q], records, mode: 'drill', rng: noShuffle });
    drill.answer(0);                      // reps 1 — still weak
    expect(drill.next().type).toBe('question'); // loops back to it
    drill.answer(0);                      // reps 2 — cleared
    const end = drill.next();
    expect(end.type).toBe('drill-complete');
    expect(end.cleared).toBe(1);
  });
});

describe('time challenge mode', () => {
  it('questions loop with modulo and timeUp reports attempted totals', () => {
    const { session } = makeSession({ mode: 'timechallenge' });
    session.answer(1); session.next();
    session.answer(2); session.next();
    session.answer('two');
    expect(session.next().question.id).toBe('q1'); // wrapped around
    session.answer(1);
    const tc = session.timeUp();
    expect(tc.correct).toBe(4);
    expect(tc.total).toBe(4);
    expect(tc.pct).toBe(100);
  });
});

describe('exam grading (no timing → binary SM-2 quality)', () => {
  it('grades all at once, counts unanswered as wrong, updates records', () => {
    const records = new Map();
    const saved = [];
    const result = gradeExam({
      questions: [mc('e1', 1), mc('e2', 2), fr('e3')],
      answers: { 0: 1, 1: 0 }, // e3 unanswered
      records,
      onRecord: (id, rec) => saved.push({ id, rec }),
    });
    expect(result.correct).toBe(1);
    expect(result.total).toBe(3);
    expect(result.missed.map((q) => q.id)).toEqual(['e2', 'e3']);
    expect(saved).toHaveLength(3);
    expect(records.get('e1').responseTimes ?? []).toHaveLength(0); // no timing
    expect(records.get('e2').everWrong).toBe(true);
  });
});

describe('letter grades + timing constants (the sacred numbers)', () => {
  it.each([
    [100, 'A+'], [97, 'A+'], [95, 'A'], [91, 'A-'], [88, 'B+'], [85, 'B'],
    [80, 'B-'], [78, 'C+'], [75, 'C'], [71, 'C-'], [68, 'D+'], [63, 'D'], [50, 'F'],
  ])('%i%% → %s', (pct, grade) => {
    expect(letterGrade(pct).grade).toBe(grade);
  });

  it('timing constants match the v1 measurements exactly', () => {
    expect(TIMING).toEqual({
      SOURCE_IMAGE_DELAY: 50,
      FR_FOCUS_DELAY: 80,
      TC_TIMEOUT_RESULTS_DELAY: 300,
      TC_AUTO_ADVANCE: 400,
      TC_TICK: 1000,
      TC_URGENT_UNDER_S: 10,
      CONFETTI_CLEANUP: 4000,
      CONFETTI_MIN_PCT: 80,
    });
  });
});
