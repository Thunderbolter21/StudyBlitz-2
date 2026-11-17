// grading.test.js — all three question types, ported v1 semantics.

import { describe, it, expect } from 'vitest';
import { gradeFreeResponse, gradeMultiSelect, gradeMC, gradeAnswer } from './grading.js';

describe('gradeFreeResponse (case/punctuation-insensitive variants)', () => {
  const variants = ['mitochondria', 'the mitochondria', 'mitochondrion'];

  it.each([
    ['mitochondria', true],
    ['  Mitochondria  ', true],       // case + outer whitespace
    ['THE MITOCHONDRIA', true],       // variant 2, caps
    ['mitochondria!', true],          // trailing punctuation
    ['"mitochondria"', true],         // quotes
    ['the   mitochondria', true],     // internal whitespace collapse
    ['(mitochondrion)', true],        // parens
    ['mito chondria', false],         // wrong split
    ['mitochondrias', false],         // wrong word
    ['', false],                      // empty
    ['   ', false],                   // whitespace only
  ])('%j → %s', (typed, expected) => {
    expect(gradeFreeResponse(typed, variants)).toBe(expected);
  });

  it('punctuation stripping matches v1 exactly: .,!?;:\'"()[]{}', () => {
    expect(gradeFreeResponse(`[t.e,s!t?;:'"(){}]`, ['test'])).toBe(true);
  });

  it('hyphens and symbols are NOT stripped (v1 behavior)', () => {
    expect(gradeFreeResponse('co-op', ['coop'])).toBe(false);
    expect(gradeFreeResponse('co-op', ['co-op'])).toBe(true);
  });

  it('handles missing variants array', () => {
    expect(gradeFreeResponse('x', undefined)).toBe(false);
  });
});

describe('gradeMultiSelect (all-or-nothing exact match)', () => {
  it.each([
    [[0, 2], [0, 2], true],
    [[2, 0], [0, 2], true],      // order ignored
    [[0], [0, 2], false],        // missing one → wrong
    [[0, 1, 2], [0, 2], false],  // extra one → wrong
    [[1, 3], [0, 2], false],
    [[], [0, 2], false],
  ])('%j vs %j → %s', (sel, cor, expected) => {
    expect(gradeMultiSelect(sel, cor)).toBe(expected);
  });

  it('rejects non-arrays', () => {
    expect(gradeMultiSelect(null, [0])).toBe(false);
    expect(gradeMultiSelect([0], 'x')).toBe(false);
  });
});

describe('gradeAnswer dispatch', () => {
  it('routes by question type', () => {
    expect(gradeMC(2, 2)).toBe(true);
    expect(gradeAnswer({ type: 'mc', ans: 1 }, 1)).toBe(true);
    expect(gradeAnswer({ type: 'mc', ans: 1 }, 0)).toBe(false);
    expect(gradeAnswer({ type: 'free-response', ans: ['two'] }, 'Two')).toBe(true);
    expect(gradeAnswer({ type: 'multi-select', ans: [0, 1] }, [1, 0])).toBe(true);
    expect(gradeAnswer({ type: 'free-response', ans: ['two'] }, 5)).toBe(false); // wrong payload type
  });
});
