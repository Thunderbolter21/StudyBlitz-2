// sync.test.js — the SYNC RULES test matrix (CLAUDE.md, rule 8).
// Every scenario runs REAL sync + repository code on two or more simulated
// devices (each with its own fake IndexedDB) against one shared mock server.

import { describe, it, expect, beforeEach } from 'vitest';
import { createMockServer } from './testing/mock-supabase.js';
import { makeDevice, createWallClock } from './testing/make-device.js';
import { mergeRows } from './sync.js';

const USER = '11111111-1111-4111-8111-111111111111';

let server, clock, deviceCount;
beforeEach(() => {
  server = createMockServer();
  clock = createWallClock();
  deviceCount = 0;
});

// Fresh device = fresh fake browser profile sharing the same server + user.
const newDevice = () =>
  makeDevice({ server, userId: USER, clock, name: `d${++deviceCount}` });

async function liveSemesterNames(device) {
  return (await device.repos.semesters.list()).map((s) => s.name).sort();
}

// ─────────────────────────────────────────────────────────────────────────────
describe('mergeRows (per-row conflict rules)', () => {
  const row = (updatedAt, extra = {}) => ({ id: 'x', updatedAt, ...extra });

  it('missing side loses', () => {
    const r = row('2026-01-02T00:00:00.000Z');
    expect(mergeRows(null, r)).toBe(r);
    expect(mergeRows(r, null)).toBe(r);
  });

  it('latest edit wins', () => {
    const older = row('2026-01-01T00:00:00.000Z');
    const newer = row('2026-01-02T00:00:00.000Z');
    expect(mergeRows(older, newer)).toBe(newer);
    expect(mergeRows(newer, older)).toBe(newer);
  });

  it('a tombstone beats a newer edit — deletes are terminal', () => {
    const tombstone = row('2026-01-01T00:00:00.000Z', { deletedAt: '2026-01-01T00:00:00.000Z' });
    const newerEdit = row('2026-01-05T00:00:00.000Z');
    expect(mergeRows(tombstone, newerEdit)).toBe(tombstone);
    expect(mergeRows(newerEdit, tombstone)).toBe(tombstone);
  });

  it('exact tie: keeps a queued local edit, otherwise prefers remote', () => {
    const a = row('2026-01-01T00:00:00.000Z', { name: 'local' });
    const b = row('2026-01-01T00:00:00.000Z', { name: 'remote' });
    expect(mergeRows(a, b, true)).toBe(a);
    expect(mergeRows(a, b, false)).toBe(b);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SYNC RULE 8 scenarios', () => {
  it('two devices editing DIFFERENT rows: both edits survive everywhere', async () => {
    const a = await newDevice();
    const b = await newDevice();
    await a.settle();
    await b.settle();

    await a.repos.semesters.create('Fall 2026');
    await a.sync.flush();
    await b.settle(); // b now has Fall 2026 too

    const [fallOnB] = await b.repos.semesters.list();
    await a.repos.semesters.rename(fallOnB.id, 'Fall 2026 (renamed)');
    await b.repos.semesters.create('Spring 2027'); // a different row
    await a.sync.flush();
    await b.sync.flush();
    await a.settle();
    await b.settle();

    const expected = ['Fall 2026 (renamed)', 'Spring 2027'];
    expect(await liveSemesterNames(a)).toEqual(expected);
    expect(await liveSemesterNames(b)).toEqual(expected);
  });

  it('two devices editing the SAME row: the later edit wins on both', async () => {
    const a = await newDevice();
    const b = await newDevice();
    await a.settle();
    const sem = await a.repos.semesters.create('Original');
    await a.sync.flush();
    await b.settle();

    // a edits first (earlier timestamp), b edits second (later timestamp).
    await a.repos.semesters.rename(sem.id, 'From A');
    await b.repos.semesters.rename(sem.id, 'From B (later)');
    // Flush in BOTH orders relative to edit time — result must be the same.
    await b.sync.flush(); // later edit lands first
    await a.sync.flush(); // earlier edit flushes after — must NOT overwrite
    await a.settle();
    await b.settle();

    expect(await liveSemesterNames(a)).toEqual(['From B (later)']);
    expect(await liveSemesterNames(b)).toEqual(['From B (later)']);
    expect(server.getRow('semesters', sem.id).name).toBe('From B (later)');
  });

  it('offline edits replayed later: an old offline edit never beats a newer one', async () => {
    const a = await newDevice();
    const b = await newDevice();
    await a.settle();
    const sem = await a.repos.semesters.create('Original');
    await a.sync.flush();
    await b.settle();

    a.online = false;
    await a.repos.semesters.rename(sem.id, 'Offline edit (older)'); // t1, stuck in outbox
    await b.repos.semesters.rename(sem.id, 'Online edit (newer)');  // t2
    await b.sync.flush();

    a.online = true;
    await a.settle(); // replays its outbox days later, so to speak

    // The newer online edit wins everywhere, even though A pushed last.
    expect(await liveSemesterNames(a)).toEqual(['Online edit (newer)']);
    expect(server.getRow('semesters', sem.id).name).toBe('Online edit (newer)');
  });

  it('offline edit that is NEWER than the online one wins after replay', async () => {
    const a = await newDevice();
    const b = await newDevice();
    await a.settle();
    const sem = await a.repos.semesters.create('Original');
    await a.sync.flush();
    await b.settle();

    await b.repos.semesters.rename(sem.id, 'Online first'); // earlier edit
    await b.sync.flush();
    a.online = false;
    await a.repos.semesters.rename(sem.id, 'Offline but newer'); // later edit
    a.online = true;
    await a.settle();
    await b.settle();

    expect(await liveSemesterNames(b)).toEqual(['Offline but newer']);
  });

  it('delete on one device while another edits: stays deleted, never resurrects', async () => {
    const a = await newDevice();
    const b = await newDevice();
    await a.settle();
    const sem = await a.repos.semesters.create('Doomed');
    await a.sync.flush();
    await b.settle();

    await a.repos.semesters.remove(sem.id); // tombstone at t1
    await a.sync.flush();
    b.online = false;
    await b.repos.semesters.rename(sem.id, 'Edited after delete'); // t2 > t1
    b.online = true;
    await b.settle();

    expect(await liveSemesterNames(a)).toEqual([]);
    expect(await liveSemesterNames(b)).toEqual([]);
    expect(server.getRow('semesters', sem.id).deleted_at).toBeTruthy();
  });

  it('delete pushed AFTER a newer edit still wins (tombstones are terminal)', async () => {
    const a = await newDevice();
    const b = await newDevice();
    await a.settle();
    const sem = await a.repos.semesters.create('Doomed');
    await a.sync.flush();
    await b.settle();

    a.online = false;
    await a.repos.semesters.remove(sem.id);                  // offline delete (older)
    await b.repos.semesters.rename(sem.id, 'Newer edit');    // online edit (newer)
    await b.sync.flush();
    a.online = true;
    await a.settle(); // delete replays after the newer edit
    await b.settle();

    expect(await liveSemesterNames(a)).toEqual([]);
    expect(await liveSemesterNames(b)).toEqual([]);
    expect(server.getRow('semesters', sem.id).deleted_at).toBeTruthy();
  });

  it('fresh device first sign-in: hydrates everything, remote never shrinks', async () => {
    const a = await newDevice();
    await a.settle();
    await a.repos.semesters.create('S1');
    await a.repos.semesters.create('S2');
    await a.repos.semesters.create('S3');
    await a.sync.flush();
    expect(server.liveCount('semesters')).toBe(3);

    const fresh = await newDevice();
    await fresh.settle();

    expect(await liveSemesterNames(fresh)).toEqual(['S1', 'S2', 'S3']);
    expect(server.liveCount('semesters')).toBe(3); // nothing clobbered
  });

  it('hydration gate: a row created before hydration waits, then pushes', async () => {
    const a = await newDevice();
    await a.settle();
    await a.repos.semesters.create('Existing');
    await a.sync.flush();

    const fresh = await newDevice();
    // User creates a semester BEFORE the first pull has completed.
    await fresh.repos.semesters.create('Created mid-hydration');
    await fresh.sync.flush(); // must be a no-op: not hydrated yet
    expect(server.stats.upsertCalls).toBe(1); // only A's original flush
    expect(server.liveCount('semesters')).toBe(1);

    await fresh.settle(); // hydrate → pull → flush
    expect(server.liveCount('semesters')).toBe(2);
    expect(await liveSemesterNames(fresh)).toEqual(['Created mid-hydration', 'Existing']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('outbox mechanics', () => {
  it('many edits to one row collapse into a single upsert with the final value', async () => {
    const a = await newDevice();
    await a.settle();
    const sem = await a.repos.semesters.create('v1');
    await a.sync.flush();
    const before = server.stats.upsertCalls;

    // Offline so the auto-flush after each edit can't push mid-burst —
    // this is the scenario where outbox dedupe matters.
    a.online = false;
    await a.repos.semesters.rename(sem.id, 'v2');
    await a.repos.semesters.rename(sem.id, 'v3');
    await a.repos.semesters.rename(sem.id, 'v4 final');
    a.online = true;
    await a.sync.flush();

    expect(server.stats.upsertCalls - before).toBe(1);
    expect(server.getRow('semesters', sem.id).name).toBe('v4 final');
  });

  it('a failed push keeps the outbox entry, reports error, and retries clean', async () => {
    const a = await newDevice();
    await a.settle();
    a.online = false; // park the change in the outbox (auto-flush can't run)
    await a.repos.semesters.create('Keep me');
    a.online = true;

    server.failNextUpsert();
    await expect(a.sync.flush()).rejects.toThrow();
    expect(a.statusLog.at(-1).status).toBe('error');
    expect(a.statusLog.at(-1).pending).toBe(1); // change NOT lost

    await a.sync.flush(); // retry succeeds
    expect(a.statusLog.at(-1).status).toBe('synced');
    expect(server.liveCount('semesters')).toBe(1);
  });

  it('offline: writes stay durable locally and status reports offline', async () => {
    const a = await newDevice();
    await a.settle();
    a.online = false;
    await a.repos.semesters.create('Written offline');
    await a.sync.flush();

    expect(a.statusLog.at(-1).status).toBe('offline');
    expect(await liveSemesterNames(a)).toEqual(['Written offline']); // durable
    expect(server.liveCount('semesters')).toBe(0); // nothing pushed yet
  });

  it('pull is cursor-based and idempotent', async () => {
    const a = await newDevice();
    await a.settle();
    await a.repos.semesters.create('S1');
    await a.sync.flush();
    await a.sync.pullAll();

    const cursor = await a.db.metaGet('cursor:semesters');
    expect(cursor).toBeTruthy();

    // Pulling again with no remote changes must not disturb anything.
    const rowsBefore = await a.db.getAll('semesters');
    await a.sync.pullAll();
    expect(await a.db.getAll('semesters')).toEqual(rowsBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('entity behaviors on top of sync', () => {
  it('cascade delete: semester → class → deck → questions all tombstone and sync', async () => {
    const a = await newDevice();
    await a.settle();
    const sem = await a.repos.semesters.create('Fall');
    const cls = await a.repos.classes.create({ semesterId: sem.id, name: 'ACC 210', color: '#1d4f91' });
    const deck = await a.repos.decks.create({ classId: cls.id, name: 'Ch. 1' });
    await a.repos.questions.createMany(deck.id, [
      { type: 'mc', q: '1+1?', opts: ['1', '2', '3', '4'], ans: 1, explain: '', cat: 'Math' },
      { type: 'free-response', q: 'Name it', opts: null, ans: ['two'], explain: '', cat: 'Math' },
    ]);
    await a.sync.flush();
    expect(server.liveCount('questions')).toBe(2);

    await a.repos.semesters.remove(sem.id);
    await a.sync.flush();

    for (const t of ['semesters', 'classes', 'decks', 'questions']) {
      expect(server.liveCount(t)).toBe(0);
      expect(server.count(t)).toBeGreaterThan(0); // tombstones, not wipes
    }

    const fresh = await newDevice();
    await fresh.settle();
    expect(await fresh.repos.decks.list()).toEqual([]);
  });

  it('card memory converges: same question answered on two devices → one row, latest wins', async () => {
    const a = await newDevice();
    const b = await newDevice();
    await a.settle();
    const sem = await a.repos.semesters.create('S');
    const cls = await a.repos.classes.create({ semesterId: sem.id, name: 'C', color: '#000' });
    const deck = await a.repos.decks.create({ classId: cls.id, name: 'D' });
    const [q] = await a.repos.questions.createMany(deck.id, [
      { type: 'mc', q: 'Q?', opts: ['a', 'b', 'c', 'd'], ans: 0, explain: '', cat: 'X' },
    ]);
    await a.sync.flush();
    await b.settle();

    await a.repos.cardMemory.saveForQuestion(q.id, { correct: 1, total: 1, everWrong: false, reps: 1, ease: 2.5, interval: 1, due: 123 });
    await b.repos.cardMemory.saveForQuestion(q.id, { correct: 1, total: 2, everWrong: true, reps: 0, ease: 2.3, interval: 1, due: 456 });
    await a.sync.flush();
    await b.sync.flush();
    await a.settle();
    await b.settle();

    expect(server.count('card_memory')).toBe(1); // ONE row — no constraint collision
    const recA = await a.repos.cardMemory.getForQuestion(q.id);
    const recB = await b.repos.cardMemory.getForQuestion(q.id);
    expect(recA.total).toBe(2); // B's later answer won
    expect(recB.total).toBe(2);
    expect(recA.interval).toBe(1); // interval_days ↔ interval mapping survived
  });

  it('settings sync across devices (user_id primary key path)', async () => {
    const a = await newDevice();
    const b = await newDevice();
    await a.settle();
    await a.repos.settings.save({ model: 'claude-sonnet-5', preferences: { theme: 'paper' } });
    await a.sync.flush();
    await b.settle();

    const onB = await b.repos.settings.get();
    expect(onB.model).toBe('claude-sonnet-5');
    expect(onB.preferences.theme).toBe('paper');
  });

  it('high scores: deterministic row id — two devices, same deck+seconds, no collision', async () => {
    const a = await newDevice();
    const b = await newDevice();
    await a.settle();
    const sem = await a.repos.semesters.create('S');
    const cls = await a.repos.classes.create({ semesterId: sem.id, name: 'C', color: '#000' });
    const deck = await a.repos.decks.create({ classId: cls.id, name: 'D' });
    await a.sync.flush();
    await b.settle();

    await a.repos.highScores.record(deck.id, 60, 10, 12);
    await b.repos.highScores.record(deck.id, 60, 14, 15);
    await a.sync.flush();
    await b.sync.flush();
    await a.settle();

    expect(server.count('high_scores')).toBe(1);
    expect((await a.repos.highScores.best(deck.id, 60)).correct).toBe(14);
  });

  it('editing a deleted row is refused locally', async () => {
    const a = await newDevice();
    await a.settle();
    const sem = await a.repos.semesters.create('Gone');
    await a.repos.semesters.remove(sem.id);
    await expect(a.repos.semesters.rename(sem.id, 'Zombie')).rejects.toThrow(/deleted/);
  });
});
