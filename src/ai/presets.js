// presets.js — instruction presets for the Quiz Builder.
// A preset is pre-written test instructions sent to Claude WITH the notes.
// The free-text instruction box ADDS to the chosen preset (never replaces).
// Built-ins ship here; user-saved presets live in the presets table.

export const BUILT_IN_PRESETS = [
  {
    id: 'builtin-exam-mc',
    name: 'Exam-style multiple choice',
    description: 'Four-option MC that mimics real exam phrasing and difficulty.',
    body: `Generate ONLY multiple-choice questions (type "mc").
Write them the way a professor writes a midterm: formal exam register, precise wording, one clearly best answer.
Distractors must be the classic exam traps — common misconceptions, right concept wrong detail, or correct-sounding reversals.
Include a few "Which of the following is NOT…" style items (at most 20%).`,
  },
  {
    id: 'builtin-application',
    name: 'Application & scenario problems',
    description: 'Scenario-first questions that make you apply concepts, not recall them.',
    body: `Every question must open with a short concrete scenario (a company, a person, a situation) and ask the student to APPLY a concept to it — never to merely recall a definition.
Prefer "What should X do…", "What happens to Y when…", "Which principle explains…" framings.
Mix mc and multi-select; keep scenarios to 2–3 sentences.`,
  },
  {
    id: 'builtin-definitions',
    name: 'Definitions & terms drill',
    description: 'Rapid-fire terminology: term↔definition in both directions.',
    body: `Focus entirely on vocabulary and key terms.
Half the questions give the TERM and ask for the definition (mc); the other half give the DEFINITION and ask for the term (prefer free-response with the term as the answer).
Keep questions short — this is a rapid drill, not an essay.`,
  },
  {
    id: 'builtin-free-response',
    name: 'Free-response heavy',
    description: 'Mostly type-the-answer recall (~60% free-response).',
    body: `Make roughly 60% of the questions free-response, 30% mc, 10% multi-select.
Free-response answers must stay short (1–4 words) with 2–4 accepted variants covering spellings, abbreviations, and phrasings.
Use fill-in-the-blank (___) and "What is the term for…" styles.`,
  },
  {
    id: 'builtin-calculation',
    name: 'Calculation & problem sets',
    description: 'Numeric problems with the setup in the question and worked logic in the explanation.',
    body: `Prioritize quantitative problems: give the numbers in the question, ask for a computed result.
For mc, distractors must be the results of REALISTIC mistakes (sign errors, swapped formula terms, skipped steps).
The explain field must show the calculation path (formula → substitution → result).
Keep arithmetic clean enough to do without a calculator unless the material demands one.`,
  },
  {
    id: 'builtin-final-review',
    name: 'Mixed final review',
    description: 'Broad cumulative coverage across every topic in the material.',
    body: `This is a cumulative FINAL review: cover every major topic in the material at least once, weighted toward the hardest ideas.
Mix all three question types and difficulty levels, easier first is NOT required — shuffle difficulty.
Favor questions that connect two or more topics together.`,
  },
];
