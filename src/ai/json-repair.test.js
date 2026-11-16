// json-repair.test.js — the self-healing JSON pipeline + question
// normalization, ported from v1 and proven here.

import { describe, it, expect } from 'vitest';
import {
  extractAndRepairJSON, normalizeQuestions, normalizeType, shuffleAnswerPositions,
} from './json-repair.js';

const MC = { q: 'Q?', type: 'mc', cat: 'T', opts: ['a', 'b', 'c', 'd'], ans: 2, explain: 'e' };

describe('extractAndRepairJSON', () => {
  it('parses a clean array', () => {
    expect(extractAndRepairJSON(JSON.stringify([MC]))).toHaveLength(1);
  });

  it('strips markdown fences', () => {
    const raw = '```json\n' + JSON.stringify([MC]) + '\n```';
    expect(extractAndRepairJSON(raw)).toHaveLength(1);
  });

  it('extracts the array out of surrounding chatter', () => {
    const raw = 'Here are your questions!\n' + JSON.stringify([MC]) + '\nGood luck!';
    expect(extractAndRepairJSON(raw)[0].q).toBe('Q?');
  });

  it('repairs malformed JSON (trailing commas, single quotes)', () => {
    const raw = `[{'q': 'Q?', 'type': 'mc', 'opts': ['a','b','c','d',], 'ans': 1, 'explain': 'e',},]`;
    const out = extractAndRepairJSON(raw);
    expect(out).toHaveLength(1);
    expect(out[0].ans).toBe(1);
  });

  it('mid-object truncation (max_tokens cutoff) → null, so the outer retry re-calls the API', () => {
    // Same contract as v1: hopeless truncation is not silently patched into
    // half-questions — it fails parsing and generateWithRetry calls again.
    const full = JSON.stringify([MC, MC]);
    const truncated = full.slice(0, full.length - 20) + ']';
    expect(extractAndRepairJSON(truncated)).toBeNull();
  });

  it('returns null when there is no array at all', () => {
    expect(extractAndRepairJSON('Sorry, I cannot help with that.')).toBeNull();
  });
});

describe('normalizeType', () => {
  it.each([
    ['mc', 'mc'], ['MC', 'mc'], ['multiple choice', 'mc'], [undefined, 'mc'],
    ['free-response', 'free-response'], ['free_response', 'free-response'],
    ['freeresponse', 'free-response'], ['Free Response', 'free-response'],
    ['multi-select', 'multi-select'], ['multi_select', 'multi-select'],
    ['multiselect', 'multi-select'], ['Multi Select', 'multi-select'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeType(input)).toBe(expected);
  });
});

describe('normalizeQuestions (v1 validation, one shared copy)', () => {
  it('pads short option lists to 4 with em-dashes', () => {
    const [q] = normalizeQuestions([{ ...MC, opts: ['a', 'b'] }]);
    expect(q.opts).toEqual(['a', 'b', '—', '—']);
  });

  it('caps long option lists at 4', () => {
    const [q] = normalizeQuestions([{ ...MC, opts: ['a', 'b', 'c', 'd', 'e', 'f'] }]);
    expect(q.opts).toHaveLength(4);
  });

  it('clamps an out-of-range mc answer to 0', () => {
    expect(normalizeQuestions([{ ...MC, ans: 9 }])[0].ans).toBe(0);
    expect(normalizeQuestions([{ ...MC, ans: 'x' }])[0].ans).toBe(0);
  });

  it('lowercases and trims free-response variants, accepts a bare string', () => {
    const [q] = normalizeQuestions([
      { q: 'The ___?', type: 'free-response', ans: ['  Mitochondria ', 'THE MITOCHONDRIA'] },
    ]);
    expect(q.ans).toEqual(['mitochondria', 'the mitochondria']);
    expect(q.opts).toBeNull();

    const [q2] = normalizeQuestions([{ q: 'X?', type: 'free-response', ans: 'Answer' }]);
    expect(q2.ans).toEqual(['answer']);
  });

  it('filters multi-select answers to valid indices, drops empty', () => {
    const [q] = normalizeQuestions([
      { ...MC, type: 'multi-select', ans: [0, 2, 9, 'x'] },
    ]);
    expect(q.ans).toEqual([0, 2]);
    expect(normalizeQuestions([{ ...MC, type: 'multi-select', ans: [] }])).toHaveLength(0);
  });

  it('drops garbage: missing q, missing opts, FR without answers', () => {
    expect(normalizeQuestions([
      { type: 'mc', opts: ['a', 'b', 'c', 'd'], ans: 0 },              // no q
      { q: 'X?', type: 'mc', ans: 0 },                                 // no opts
      { q: 'X?', type: 'free-response', ans: [] },                     // no answers
      { q: 'X?', type: 'mc', opts: ['only one'], ans: 0 },             // <2 opts
      null,
    ])).toHaveLength(0);
  });

  it('defaults cat to General and explain to empty string', () => {
    const [q] = normalizeQuestions([{ q: 'Q?', opts: ['a', 'b', 'c', 'd'], ans: 1 }]);
    expect(q.cat).toBe('General');
    expect(q.explain).toBe('');
    expect(q.type).toBe('mc');
  });
});

describe('shuffleAnswerPositions', () => {
  it('keeps the correct option text under the remapped index (mc)', () => {
    for (let i = 0; i < 25; i++) {
      const shuffled = shuffleAnswerPositions(MC);
      expect(shuffled.opts[shuffled.ans]).toBe(MC.opts[MC.ans]);
    }
  });

  it('keeps every correct option tracked for multi-select', () => {
    const ms = { ...MC, type: 'multi-select', ans: [0, 3] };
    for (let i = 0; i < 25; i++) {
      const shuffled = shuffleAnswerPositions(ms);
      const correctTexts = shuffled.ans.map((a) => shuffled.opts[a]).sort();
      expect(correctTexts).toEqual(['a', 'd']);
    }
  });

  it('leaves free-response untouched', () => {
    const fr = { q: 'X?', type: 'free-response', opts: null, ans: ['x'] };
    expect(shuffleAnswerPositions(fr)).toEqual(fr);
  });

  it('actually moves answers around (not an identity shuffle)', () => {
    const positions = new Set();
    for (let i = 0; i < 60; i++) positions.add(shuffleAnswerPositions(MC).ans);
    expect(positions.size).toBeGreaterThan(1);
  });
});
