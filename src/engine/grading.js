// grading.js — answer grading for all three question types.
// Ported character-for-character from reference-v1/src/engine/quiz.js
// (gradeFreeResponse :28, gradeMultiSelect :35, MC index compare).

// Free response: case-insensitive, punctuation-insensitive exact match
// against the accepted variants.
export function gradeFreeResponse(typed, answerVariants) {
  const normalize = (s) =>
    s.toLowerCase().trim().replace(/[.,!?;:'"()[\]{}]/g, '').replace(/\s+/g, ' ');
  const n = normalize(typed);
  if (!n) return false;
  return (answerVariants || []).some((v) => normalize(v) === n);
}

// Multi-select: all-or-nothing exact set match.
export function gradeMultiSelect(selectedIndices, correctIndices) {
  if (!Array.isArray(selectedIndices) || !Array.isArray(correctIndices)) return false;
  if (selectedIndices.length !== correctIndices.length) return false;
  const sel = [...selectedIndices].sort((a, b) => a - b);
  const cor = [...correctIndices].sort((a, b) => a - b);
  return sel.every((v, i) => v === cor[i]);
}

// Multiple choice: index equality.
export function gradeMC(selectedIndex, correctIndex) {
  return selectedIndex === correctIndex;
}

// Grade any question against a raw answer payload:
//   mc → number · free-response → string · multi-select → number[]
export function gradeAnswer(question, answer) {
  if (question.type === 'free-response') {
    return gradeFreeResponse(typeof answer === 'string' ? answer : '', question.ans);
  }
  if (question.type === 'multi-select') {
    return gradeMultiSelect(Array.isArray(answer) ? answer : [], question.ans);
  }
  return gradeMC(answer, question.ans);
}
