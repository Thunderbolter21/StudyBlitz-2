// generation.test.js — retry/backoff behavior with a mocked fetch,
// friendly error mapping, prompt construction, and preset shape.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseApiError, fetchWithRetry, generateWithRetry, buildPromptText, API_URL,
} from './generation.js';
import { BUILT_IN_PRESETS } from './presets.js';

afterEach(() => vi.unstubAllGlobals());

const apiResponse = (questions) => ({
  ok: true,
  json: async () => ({ content: [{ type: 'text', text: JSON.stringify(questions) }] }),
});
const apiError = (status, type) => ({
  ok: false,
  status,
  text: async () => JSON.stringify({ error: { type } }),
});
const MC = { q: 'Q?', type: 'mc', opts: ['a', 'b', 'c', 'd'], ans: 1, explain: 'e' };

// Collects requested sleep delays instead of actually waiting.
function fakeSleep(log) {
  return (ms) => { log.push(ms); return Promise.resolve(); };
}

describe('parseApiError', () => {
  it('maps known error types to friendly messages', () => {
    expect(parseApiError(529, JSON.stringify({ error: { type: 'overloaded_error' } })).message)
      .toMatch(/busy/);
    expect(parseApiError(401, JSON.stringify({ error: { type: 'authentication_error' } })).message)
      .toMatch(/key/i);
    expect(parseApiError(429, JSON.stringify({ error: { type: 'rate_limit_error' } })).message)
      .toMatch(/wait a moment/);
  });

  it('falls back to a generic message with the status code', () => {
    expect(parseApiError(500, 'not json').message).toMatch(/500/);
  });
});

describe('fetchWithRetry — 529 overload backoff (v1 behavior)', () => {
  it('backs off attempt*8s on overload, then succeeds', async () => {
    const sleeps = [];
    const statuses = [];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(apiError(529, 'overloaded_error'))
      .mockResolvedValueOnce(apiError(529, 'overloaded_error'))
      .mockResolvedValueOnce(apiResponse([MC]));
    vi.stubGlobal('fetch', fetchMock);

    const resp = await fetchWithRetry(API_URL, {}, (s) => statuses.push(s), 3, fakeSleep(sleeps));
    expect(resp.ok).toBe(true);
    expect(sleeps).toEqual([8000, 16000]); // attempt 1 → 8s, attempt 2 → 16s
    expect(statuses[0]).toMatch(/retrying in 8s/);
    expect(statuses[1]).toMatch(/retrying in 16s/);
  });

  it('throws the friendly message immediately on a bad key (no retry)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(apiError(401, 'authentication_error'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchWithRetry(API_URL, {}, null, 3, fakeSleep([])))
      .rejects.toThrow(/key/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries network failures after 5s', async () => {
    const sleeps = [];
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(apiResponse([MC]));
    vi.stubGlobal('fetch', fetchMock);
    const resp = await fetchWithRetry(API_URL, {}, null, 3, fakeSleep(sleeps));
    expect(resp.ok).toBe(true);
    expect(sleeps).toEqual([5000]);
  });
});

describe('generateWithRetry — whole-call retry on bad JSON (v1 behavior)', () => {
  it('re-calls the API when the response has no parseable questions', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'I refuse.' }] }) })
      .mockResolvedValueOnce(apiResponse([MC]));
    vi.stubGlobal('fetch', fetchMock);

    const out = await generateWithRetry({
      apiKey: 'sk-test', requestBody: {}, sleep: fakeSleep([]),
    });
    expect(out).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends the required browser-access and version headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(apiResponse([MC]));
    vi.stubGlobal('fetch', fetchMock);
    await generateWithRetry({ apiKey: 'sk-test', requestBody: {}, sleep: fakeSleep([]) });
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['x-api-key']).toBe('sk-test');
  });

  it('gives up with the last error after 3 attempts', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ content: [{ type: 'text', text: 'junk' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateWithRetry({ apiKey: 'k', requestBody: {}, sleep: fakeSleep([]) }))
      .rejects.toThrow(/No valid questions/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('buildPromptText (v1 structure preserved)', () => {
  it('embeds count, deck name, and the study material', () => {
    const p = buildPromptText({ deckName: 'ACC 210 Ch. 4', count: 25, notesText: 'Debits and credits.' });
    expect(p).toContain('EXACTLY 25 questions');
    expect(p).toContain('"ACC 210 Ch. 4"');
    expect(p).toContain('Debits and credits.');
    expect(p).not.toContain('<special_instructions>');
  });

  it('adds the special_instructions block only when instructions exist', () => {
    const p = buildPromptText({ count: 10, instructions: 'Only definitions.', notesText: 'x' });
    expect(p).toContain('<special_instructions>');
    expect(p).toContain('Only definitions.');
    expect(p).toContain('take priority');
  });

  it('lists URLs for the web-fetch tool when present', () => {
    const p = buildPromptText({ count: 10, notesText: 'x', urls: ['https://example.com/notes'] });
    expect(p).toContain('https://example.com/notes');
  });

  it('falls back to "(see attached files above)" with no notes', () => {
    expect(buildPromptText({ count: 10 })).toContain('(see attached files above)');
  });
});

describe('built-in presets', () => {
  it('ships the six required presets, each with name/description/body', () => {
    expect(BUILT_IN_PRESETS).toHaveLength(6);
    for (const p of BUILT_IN_PRESETS) {
      expect(p.id).toMatch(/^builtin-/);
      expect(p.name.length).toBeGreaterThan(3);
      expect(p.description.length).toBeGreaterThan(10);
      expect(p.body.length).toBeGreaterThan(40);
    }
  });
});
