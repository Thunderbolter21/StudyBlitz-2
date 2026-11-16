// json-repair.js — the self-healing JSON pipeline, ported from v1
// (reference-v1/src/pages/Generator.js). Claude usually returns a clean
// array, but when it adds fences, chatter, or malformed JSON we repair
// instead of failing.

import { jsonrepair } from 'jsonrepair';

// Strips markdown fences, extracts the JSON array, tries direct parse,
// then jsonrepair on the extracted string, then on the full text.
// Returns an array or null. (v1: extractAndRepairJSON)
export function extractAndRepairJSON(rawText) {
  const cleaned = rawText
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/gi, '')
    .trim();
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return null;
  const jsonStr = arrayMatch[0];
  try { return JSON.parse(jsonStr); } catch { /* try repair */ }
  try { return JSON.parse(jsonrepair(jsonStr)); } catch { /* try full text */ }
  try {
    const match = jsonrepair(cleaned).match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
  } catch { /* give up */ }
  return null;
}

// Coerces a raw type string to one of our three types. (v1: getQType)
export function normalizeType(raw) {
  const t = String(raw || '').toLowerCase().replace(/[\s_]/g, '-').trim();
  if (t === 'free-response' || t === 'freeresponse') return 'free-response';
  if (t === 'multi-select' || t === 'multiselect') return 'multi-select';
  return 'mc';
}

// Validates + normalizes Claude's output into clean question rows.
// Ported from v1's validation (it was copy-pasted three times there; this
// is the single shared copy). Invalid items are silently dropped.
export function normalizeQuestions(parsed) {
  if (!Array.isArray(parsed)) return [];
  const valid = [];

  parsed.forEach((item) => {
    if (!item || !item.q || !String(item.q).trim()) return;
    const type = normalizeType(item.type);
    const base = {
      q: String(item.q),
      cat: String(item.cat || 'General'),
      explain: String(item.explain || ''),
    };

    if (type === 'free-response') {
      let ans = Array.isArray(item.ans) ? item.ans : typeof item.ans === 'string' ? [item.ans] : [];
      ans = ans.map((a) => String(a).toLowerCase().trim()).filter((a) => a.length > 0);
      if (!ans.length) return;
      valid.push({ ...base, type: 'free-response', opts: null, ans });
      return;
    }

    // mc and multi-select share option handling: pad to 4, cap at 4.
    if (!Array.isArray(item.opts)) return;
    let opts = item.opts.map((o) => String(o ?? '')).filter((o) => o.trim().length > 0);
    if (opts.length < 2) return;
    while (opts.length < 4) opts.push('—');
    if (opts.length > 4) opts = opts.slice(0, 4);

    if (type === 'multi-select') {
      if (!Array.isArray(item.ans) || item.ans.length === 0) return;
      const ans = item.ans
        .map((a) => parseInt(a, 10))
        .filter((a) => !isNaN(a) && a >= 0 && a < opts.length);
      if (!ans.length) return;
      valid.push({ ...base, type: 'multi-select', opts, ans });
    } else {
      let ans = parseInt(item.ans, 10);
      if (isNaN(ans) || ans < 0 || ans > 3) ans = 0;
      valid.push({ ...base, type: 'mc', opts, ans });
    }
  });

  return valid;
}

// Randomizes which slot holds the correct answer, remapping `ans`, so any
// positional bias in Claude's output is neutralized at import. (v1 ran
// this once at import AND once per quiz session; same here.)
export function shuffleAnswerPositions(question, random = Math.random) {
  if (question.type === 'free-response') return { ...question };
  const q = { ...question };
  const len = (q.opts || []).length;
  if (!len) return q;
  const indices = Array.from({ length: len }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const newOpts = indices.map((i) => q.opts[i]);
  if (q.type === 'multi-select') {
    return { ...q, opts: newOpts, ans: (q.ans || []).map((ci) => indices.indexOf(ci)) };
  }
  return { ...q, opts: newOpts, ans: indices.indexOf(q.ans) };
}
