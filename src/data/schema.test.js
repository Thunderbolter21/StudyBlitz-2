// schema.test.js — local(camelCase) ↔ remote(snake_case) mapping.

import { describe, it, expect } from 'vitest';
import { toRemote, toLocal, TABLES, TABLE_NAMES } from './schema.js';

describe('schema mapping', () => {
  it('maps a question row both ways without loss', () => {
    const local = {
      id: 'q1', userId: 'u1', deckId: 'd1', type: 'mc',
      q: 'What?', opts: ['a', 'b', 'c', 'd'], ans: 2, explain: 'because',
      cat: 'Topic', sortOrder: 3, sourceImagePath: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
      deletedAt: null,
    };
    const remote = toRemote('questions', local);
    expect(remote.deck_id).toBe('d1');
    expect(remote.sort_order).toBe(3);
    expect(remote.user_id).toBe('u1');
    expect(toLocal('questions', remote)).toEqual(local);
  });

  it('card_memory: local `interval` ↔ remote `interval_days` (reserved word)', () => {
    const local = { id: 'q1', userId: 'u1', questionId: 'q1', interval: 6, everWrong: true, updatedAt: 'x' };
    const remote = toRemote('card_memory', local);
    expect(remote.interval_days).toBe(6);
    expect(remote.interval).toBeUndefined();
    expect(remote.ever_wrong).toBe(true);
    expect(toLocal('card_memory', remote).interval).toBe(6);
  });

  it('strips unknown local fields so they can never 400 at the server', () => {
    const remote = toRemote('semesters', { id: 's1', userId: 'u1', name: 'Fall', aLocalOnlyThing: 1 });
    expect(remote.a_local_only_thing).toBeUndefined();
  });

  it('never pushes serverUpdatedAt (trigger-owned column)', () => {
    for (const table of TABLE_NAMES) {
      const row = { [TABLES[table].pk]: 'x', userId: 'u1', serverUpdatedAt: 'nope' };
      expect(toRemote(table, row).server_updated_at).toBeUndefined();
    }
  });

  it('user_settings uses userId as its primary key', () => {
    const remote = toRemote('user_settings', { userId: 'u1', anthropicApiKey: 'sk', model: 'm' });
    expect(remote.user_id).toBe('u1');
    expect(remote.anthropic_api_key).toBe('sk');
  });
});
