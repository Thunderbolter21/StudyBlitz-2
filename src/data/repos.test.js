// repos.test.js — hierarchy operations (Phase 3): archive, moves,
// preference patching, and that every one of them syncs between devices.

import { describe, it, expect, beforeEach } from 'vitest';
import { createMockServer } from './testing/mock-supabase.js';
import { makeDevice, createWallClock } from './testing/make-device.js';

const USER = '22222222-2222-4222-8222-222222222222';

let server, clock, n;
beforeEach(() => {
  server = createMockServer();
  clock = createWallClock();
  n = 0;
});
const newDevice = () => makeDevice({ server, userId: USER, clock, name: `r${++n}` });

async function seed(device) {
  const sem = await device.repos.semesters.create('Fall 2026');
  const cls = await device.repos.classes.create({
    semesterId: sem.id, name: 'ACC 210', color: 'var(--class-2)',
  });
  const deck = await device.repos.decks.create({ classId: cls.id, name: 'Chapter 1' });
  return { sem, cls, deck };
}

describe('hierarchy operations', () => {
  it('archive hides a semester without deleting anything, and round-trips', async () => {
    const a = await newDevice();
    await a.settle();
    const { sem, deck } = await seed(a);

    await a.repos.semesters.setArchived(sem.id, true);
    await a.sync.flush();

    const archived = (await a.repos.semesters.list()).find((s) => s.id === sem.id);
    expect(archived.archivedAt).toBeTruthy();
    // Nothing was deleted — the deck is still there.
    expect(await a.repos.decks.get(deck.id)).toBeTruthy();

    // Unarchive restores it.
    await a.repos.semesters.setArchived(sem.id, false);
    expect((await a.repos.semesters.list()).find((s) => s.id === sem.id).archivedAt).toBeNull();
  });

  it('moving a class to another semester carries its decks with it', async () => {
    const a = await newDevice();
    await a.settle();
    const { sem, cls, deck } = await seed(a);
    const spring = await a.repos.semesters.create('Spring 2027');

    await a.repos.classes.moveToSemester(cls.id, spring.id);
    await a.sync.flush();

    expect(await a.repos.classes.listBySemester(sem.id)).toEqual([]);
    const moved = await a.repos.classes.listBySemester(spring.id);
    expect(moved.map((c) => c.id)).toEqual([cls.id]);
    // The deck still belongs to the class — nothing else changed.
    expect((await a.repos.decks.listByClass(cls.id)).map((d) => d.id)).toEqual([deck.id]);

    // And another device sees the move.
    const b = await newDevice();
    await b.settle();
    expect((await b.repos.classes.listBySemester(spring.id)).map((c) => c.id)).toEqual([cls.id]);
  });

  it('moving a deck to another class syncs across devices', async () => {
    const a = await newDevice();
    await a.settle();
    const { cls, deck } = await seed(a);
    const cls2 = await a.repos.classes.create({
      semesterId: (await a.repos.semesters.list())[0].id, name: 'MKT 300', color: 'var(--class-4)',
    });

    await a.repos.decks.moveToClass(deck.id, cls2.id);
    await a.sync.flush();

    expect(await a.repos.decks.listByClass(cls.id)).toEqual([]);
    const b = await newDevice();
    await b.settle();
    expect((await b.repos.decks.listByClass(cls2.id)).map((d) => d.id)).toEqual([deck.id]);
  });

  it('patchPreferences merges instead of replacing', async () => {
    const a = await newDevice();
    await a.settle();
    await a.repos.settings.patchPreferences({ currentSemesterId: 'sem-1' });
    await a.repos.settings.patchPreferences({ theme: 'paper' });

    const prefs = (await a.repos.settings.get()).preferences;
    expect(prefs.currentSemesterId).toBe('sem-1'); // first key survived
    expect(prefs.theme).toBe('paper');
  });

  it('deleting a class removes its decks but leaves sibling classes alone', async () => {
    const a = await newDevice();
    await a.settle();
    const { sem, cls, deck } = await seed(a);
    const keep = await a.repos.classes.create({
      semesterId: sem.id, name: 'MATH 125', color: 'var(--class-6)',
    });
    const keepDeck = await a.repos.decks.create({ classId: keep.id, name: 'Limits' });

    await a.repos.classes.remove(cls.id);
    await a.sync.flush();

    expect(await a.repos.decks.get(deck.id)).toBeNull();
    expect(await a.repos.decks.get(keepDeck.id)).toBeTruthy();
    expect((await a.repos.classes.listBySemester(sem.id)).map((c) => c.id)).toEqual([keep.id]);
  });
});
