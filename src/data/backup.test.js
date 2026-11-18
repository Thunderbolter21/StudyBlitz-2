// backup.test.js — export/import round trip and merge/replace semantics.

import { describe, it, expect, beforeEach } from 'vitest';
import { createMockServer } from './testing/mock-supabase.js';
import { makeDevice, createWallClock } from './testing/make-device.js';

const USER = '33333333-3333-4333-8333-333333333333';

let server, clock, n;
beforeEach(() => {
  server = createMockServer();
  clock = createWallClock();
  n = 0;
});
const newDevice = () => makeDevice({ server, userId: USER, clock, name: `b${++n}` });

async function buildLibrary(d) {
  const sem = await d.repos.semesters.create('Fall 2026');
  const cls = await d.repos.classes.create({ semesterId: sem.id, name: 'ACC 210', color: 'var(--class-2)' });
  const deck = await d.repos.decks.create({ classId: cls.id, name: 'Chapter 1' });
  const [q1, q2] = await d.repos.questions.createMany(deck.id, [
    { type: 'mc', q: '1+1?', opts: ['1', '2', '3', '4'], ans: 1, explain: 'two', cat: 'Math' },
    { type: 'free-response', q: 'Name it', opts: null, ans: ['two'], explain: '', cat: 'Math' },
  ]);
  await d.repos.cardMemory.saveForQuestion(q1.id, { correct: 2, total: 3, everWrong: true, reps: 1, ease: 2.3, interval: 1, due: 999 });
  await d.repos.presets.create({ name: 'My preset', body: 'Focus on journal entries', description: 'custom' });
  await d.repos.highScores.record(deck.id, 60, 8, 10);
  return { sem, cls, deck, q1, q2 };
}

// Snapshot comparable content (ignore sync bookkeeping).
async function snapshot(d) {
  // Ignore sync bookkeeping; compare only content + relationships.
  const strip = (r) => {
    const { userId, serverUpdatedAt, createdAt, updatedAt, deletedAt, ...rest } = r;
    return rest;
  };
  const byId = (a, b) => a.id.localeCompare(b.id);
  return {
    semesters: (await d.repos.semesters.list()).map(strip).sort(byId),
    classes: (await d.repos.classes.list()).map(strip).sort(byId),
    decks: (await d.repos.decks.list()).map(strip).sort(byId),
    questions: (await Promise.all((await d.repos.decks.list()).map((dk) => d.repos.questions.listByDeck(dk.id))))
      .flat().map(strip).sort(byId),
    memory: (await d.repos.cardMemory.list()).map(strip).sort(byId),
    presets: (await d.repos.presets.list()).map(strip).sort(byId),
  };
}

describe('backup export/import', () => {
  it('round trips: export → fresh account → import = identical content', async () => {
    const a = await newDevice();
    await a.settle();
    await buildLibrary(a);
    const file = await a.repos.backup.export();
    const before = await snapshot(a);

    // The counts the UI would show.
    expect(a.repos.backup.counts(file)).toEqual({
      semesters: 1, classes: 1, decks: 1, questions: 2, memory: 1, presets: 1,
    });

    // A brand-new device (empty) imports the file.
    const b = await newDevice();
    await b.settle();
    await b.repos.backup.import(file, 'replace');
    const after = await snapshot(b);

    expect(after).toEqual(before); // everything matches, relationships intact
    // Deck still points at its class; question still points at its deck.
    expect(after.decks[0].classId).toBe(after.classes[0].id);
    expect(after.questions[0].deckId).toBe(after.decks[0].id);
  });

  it('import validates the file shape', async () => {
    const a = await newDevice();
    await a.settle();
    expect(a.repos.backup.validate({ type: 'nope' })).toMatch(/not a StudyBlitz 2 backup/);
    expect(a.repos.backup.validate({ type: 'studyblitz2-backup', version: 99, data: {} }))
      .toMatch(/newer version/);
    expect(a.repos.backup.validate(await a.repos.backup.export())).toBeNull();
  });

  it('merge keeps a NEWER local edit and never clobbers it', async () => {
    const a = await newDevice();
    await a.settle();
    const { sem } = await buildLibrary(a);
    const file = await a.repos.backup.export();

    // Locally rename the semester AFTER the export (newer updatedAt).
    await a.repos.semesters.rename(sem.id, 'Fall 2026 (edited)');
    await a.repos.backup.import(file, 'merge');

    // The newer local name survived the merge.
    expect((await a.repos.semesters.get(sem.id)).name).toBe('Fall 2026 (edited)');
  });

  it('merge ADDS backup rows that are missing locally', async () => {
    const a = await newDevice();
    await a.settle();
    await buildLibrary(a);
    const file = await a.repos.backup.export();

    const b = await newDevice();
    await b.settle();
    await b.repos.semesters.create('Spring 2027'); // unrelated local data
    await b.repos.backup.import(file, 'merge');

    const names = (await b.repos.semesters.list()).map((s) => s.name).sort();
    expect(names).toEqual(['Fall 2026', 'Spring 2027']); // both kept
  });

  it('replace tombstones local rows the backup does not contain', async () => {
    const a = await newDevice();
    await a.settle();
    await buildLibrary(a);
    const file = await a.repos.backup.export();

    const b = await newDevice();
    await b.settle();
    await b.repos.semesters.create('Doomed semester');
    await b.repos.backup.import(file, 'replace');

    const names = (await b.repos.semesters.list()).map((s) => s.name);
    expect(names).toEqual(['Fall 2026']); // "Doomed" was tombstoned
  });

  it('imported data syncs to the cloud through the outbox', async () => {
    const a = await newDevice();
    await a.settle();
    await buildLibrary(a);
    const file = await a.repos.backup.export();

    const b = await newDevice();
    await b.settle();
    await b.repos.backup.import(file, 'replace');
    await b.sync.flush();

    expect(server.liveCount('questions')).toBe(2);
    expect(server.liveCount('decks')).toBe(1);
  });
});
