// generation.js — client-side Claude API calls for quiz generation.
// Ported faithfully from v1 (reference-v1/src/pages/Generator.js): the
// friendly error mapping, the 529-overload backoff, the outer retry that
// re-calls the API when JSON parsing fails, and the prompt itself.
//
// The user's OWN key is used directly from the browser — that requires the
// anthropic-dangerous-direct-browser-access header. The model name comes
// from ONE place (config.js), overridable in settings.

import { GENERATION_MODEL_DEFAULT } from '../config.js';
import { extractAndRepairJSON } from './json-repair.js';

export const API_URL = 'https://api.anthropic.com/v1/messages';

// ── Friendly error messages (v1: parseApiError) ─────────────────────────────
export function parseApiError(status, responseText) {
  let errorType = null;
  try { errorType = JSON.parse(responseText)?.error?.type; } catch { /* opaque body */ }
  const messages = {
    overloaded_error: 'Claude is busy right now — retrying in a moment…',
    rate_limit_error: 'Too many requests — please wait a moment and try again',
    invalid_api_key: 'Your API key is invalid — check it in the Quiz Builder',
    invalid_request_error: 'Something went wrong with the request — try again',
    authentication_error: 'API key not recognized — check your key in the Quiz Builder',
  };
  return {
    message: messages[errorType] || `Generation failed (${status}) — please try again`,
    type: errorType || 'unknown',
  };
}

// ── Retry layer 1: network + 529 overload backoff (v1: fetchWithRetry) ──────
// Overloaded → wait attempt*8s and retry; network blips → 5s; clean API
// errors (bad key, rate limit) throw immediately with a friendly message.
export async function fetchWithRetry(url, options, onRetryStatus, maxRetries = 3, sleep = defaultSleep) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      const text = await response.text();
      const { message, type } = parseApiError(response.status, text);
      if (type === 'overloaded_error' && attempt < maxRetries) {
        const delay = attempt * 8000;
        onRetryStatus?.(`Claude is busy — retrying in ${delay / 1000}s (attempt ${attempt}/${maxRetries})…`);
        await sleep(delay);
        continue;
      }
      const apiError = new Error(message);
      apiError.isApiError = true;
      throw apiError;
    } catch (err) {
      if (err.isApiError) throw err; // clean API error — don't retry
      lastErr = err;
      if (attempt < maxRetries) await sleep(5000);
    }
  }
  throw lastErr || new Error('Network error — check your connection');
}

// ── Retry layer 2: whole-call retry on unparseable JSON (v1: generateWithRetry)
export async function generateWithRetry({ apiKey, requestBody, extraHeaders = {}, onStatus, maxAttempts = 3, sleep = defaultSleep }) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetchWithRetry(
        API_URL,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
            ...extraHeaders,
          },
          body: JSON.stringify(requestBody),
        },
        onStatus,
        3,
        sleep
      );
      const data = await resp.json();
      const rawText = (data.content || [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('');
      const questions = extractAndRepairJSON(rawText);
      if (questions && questions.length > 0) return questions;
      lastError = new Error('No valid questions in the response');
    } catch (err) {
      if (err.isApiError && !err.message.includes('busy')) throw err; // hopeless — bad key etc.
      lastError = err;
    }
    if (attempt < maxAttempts) {
      onStatus?.(`Attempt ${attempt} failed, retrying… (${attempt}/${maxAttempts})`);
      await sleep(2000);
    }
  }
  throw lastError || new Error('Generation failed after 3 attempts');
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── The prompt (v1: buildPromptText — structure preserved) ──────────────────
export function buildPromptText({ deckName = 'Study Deck', count, instructions = '', notesText = '', urls = [] }) {
  const instr = instructions.trim();
  const instrBlock = instr
    ? `\n<special_instructions>\n${instr}\nThese instructions take priority where they conflict with the defaults above. Follow them precisely.\n</special_instructions>\n`
    : '';
  const urlBlock = urls.length
    ? `\nAlso fetch and use these web pages as study material:\n${urls.map((u) => `- ${u}`).join('\n')}\n`
    : '';
  const studyMaterial = notesText.trim() || '(see attached files above)';

  return `<role>
You are an expert exam writer with 15 years of experience writing multiple-choice assessments for college courses. You write questions that test genuine understanding, not pattern recognition. Your distractors are plausible to a student who partially understands the material. Your correct answers are never identifiable by length, specificity, or phrasing alone.
</role>

<task>
Generate EXACTLY ${count} questions (a mix of mc, multi-select, and free-response types) for a study deck called "${deckName}" from the material below.
Output ONLY a raw JSON array — no explanation, no markdown fences, no text before or after.
The first character of your response must be [ and the last must be ].
</task>

<critical_rules>
ANSWER POSITION — Before writing each question, mentally commit to a random position (0, 1, 2, or 3) as the correct answer slot. Write the options so the correct answer falls in that slot. Across all ${count} questions, correct answers must be distributed roughly equally across positions 0, 1, 2, and 3. Never default to position 1.

ANSWER LENGTH — All four options in a question must be within 5 words of each other in length. If your correct answer runs 10 words, every distractor must run 5–15 words. Never make the correct answer more detailed, more specific, or more qualified than the distractors.

DISTRACTOR QUALITY — Each wrong answer must be plausible to a student who partially knows the topic. Use specific terms, numbers, and concepts from the material in distractors. Never use "all of the above" or "none of the above."

COVERAGE — Spread questions across all major topics in the material. No single section should account for more than 30% of questions.
</critical_rules>

<question_types>
Generate a mix of all three question types. Aim for roughly 60% mc, 25% multi-select, 15% free-response.

TYPE 1 — Multiple Choice (mc):
{
  "q": "Question text ending with a question mark?",
  "type": "mc",
  "cat": "Short Topic Label",
  "opts": ["Option A", "Option B", "Option C", "Option D"],
  "ans": 2,
  "explain": "One sentence explaining why the correct answer is right."
}
"ans" is a single NUMBER (0–3), the index of the correct option.

TYPE 2 — Multiple Correct Answers (multi-select):
{
  "q": "Which of the following are characteristics of X? (Select all that apply)",
  "type": "multi-select",
  "cat": "Short Topic Label",
  "opts": ["Option A", "Option B", "Option C", "Option D"],
  "ans": [0, 2],
  "explain": "Options A and C are correct because..."
}
"ans" is an ARRAY of correct indices (minimum 2, maximum 3 correct answers).
Always signal multiple answers in the question: "Which of the following…", "Select all that apply", "Which THREE of these…"

TYPE 3 — Free Response:
{
  "q": "The ___ is the powerhouse of the cell.",
  "type": "free-response",
  "cat": "Short Topic Label",
  "opts": null,
  "ans": ["mitochondria", "mitochondrion", "the mitochondria"],
  "explain": "The mitochondria produces ATP through cellular respiration."
}
"ans" is an ARRAY of accepted answer variants (2–4 variants covering common spellings and phrasings).
Use fill-in-the-blank style with ___ OR "What is the term for…" style.
The answer must be a SHORT phrase (1–4 words max).
</question_types>

<examples>
GOOD MC — all four options at similar length, correct answer not identifiable by detail:
{
  "q": "What does the Federal Reserve primarily adjust to control inflation?",
  "type": "mc",
  "opts": [
    "The federal funds interest rate target",
    "The maximum price ceiling on groceries",
    "The annual federal government deficit limit",
    "The reserve requirement for commercial banks"
  ],
  "ans": 0,
  "explain": "The Fed raises the federal funds rate to raise borrowing costs, reducing spending and cooling inflation."
}

BAD MC — correct answer is obviously longer and more detailed than the distractors:
{
  "q": "What causes inflation?",
  "opts": [
    "Too much money",
    "High taxes",
    "When the supply of money in an economy grows faster than the production of goods and services, causing prices to rise across the board",
    "Government spending"
  ],
  "ans": 2
}
</examples>

<thinking>
Before writing questions:
1. List the 4–6 main topics in the study material
2. Decide how many questions per topic to reach exactly ${count} total
3. For each question: commit to a random correct-answer position BEFORE writing any options, then write all four options at roughly equal length
</thinking>
${instrBlock}${urlBlock}---
STUDY MATERIAL:
${studyMaterial}`;
}

// ── System prompt (v1 had this duplicated in two call sites) ────────────────
export const SYSTEM_PROMPT = `You are an expert exam writer. Generate a mix of these question types based on the study material and any special instructions provided. Aim for roughly 60% mc, 25% multi-select, 15% free-response unless instructions specify otherwise.

TYPE 1 - Multiple Choice (mc):
{"q":"Question?","type":"mc","cat":"Topic","opts":["Option A","Option B","Option C","Option D"],"ans":2,"explain":"Why correct."}
ans is a NUMBER (0-3). Distribute correct answers evenly across positions 0-3, never default to position 1.

TYPE 2 - Multiple Correct Answers (multi-select):
{"q":"Which of the following are examples of X? Select all that apply.","type":"multi-select","cat":"Topic","opts":["Option A","Option B","Option C","Option D"],"ans":[0,2],"explain":"A and C are correct because..."}
ans is an ARRAY of correct index numbers (2-3 correct answers). opts must always have exactly 4 non-empty strings.

TYPE 3 - Free Response:
{"q":"The ___ is responsible for X in the cell.","type":"free-response","cat":"Topic","opts":null,"ans":["mitochondria","the mitochondria","mitochondrion"],"explain":"The mitochondria produces ATP."}
ans is an ARRAY of 2-4 accepted answer variants. opts must be null. Question must use ___ fill-in-the-blank or start with "What term..." / "Name the...". Answer must be 1-4 words.

CRITICAL RULES:
- opts must NEVER be an empty array [], NEVER contain empty strings "", NEVER be undefined
- For mc and multi-select: opts must have exactly 4 meaningful non-empty answer choices
- For free-response: opts must be null (not [] or undefined)
- ans for mc: single number 0-3
- ans for multi-select: array of numbers
- ans for free-response: array of strings
- Every question must have a non-empty explain field
- Output only a raw JSON array, no markdown fences
- If web pages are provided, fetch them and use their content as study material`;

// ── One call to Claude ──────────────────────────────────────────────────────
// contentParts: already-built API content blocks (images/documents/text).
// When URLs are present we enable the server-side web-fetch tool so Claude
// reads the pages itself (the browser can't — CORS).
export function generateQuestions({ apiKey, model, contentParts, hasUrls = false, onStatus, sleep }) {
  const requestBody = {
    model: model || GENERATION_MODEL_DEFAULT,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: contentParts }],
    ...(hasUrls
      ? { tools: [{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 8 }] }
      : {}),
  };
  const extraHeaders = hasUrls ? { 'anthropic-beta': 'web-fetch-2025-09-10' } : {};
  return generateWithRetry({ apiKey, requestBody, extraHeaders, onStatus, sleep });
}
