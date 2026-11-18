// sources.test.js — reference-aware storage cleanup on deck delete.
// A stored object is removed ONLY when no other live deck references it;
// per-question images (unique to a question) are always removed.

import { describe, it, expect, beforeEach } from 'vitest';
import { makeDevice, createWallClock } from './testing/make-device.js';
import { createMockServer } from './testing/mock-supabase.js';
import { createSourcesService } from './sources.js';

const USER = '44444444-4444-4444-8444-444444444444';

let server, clock, removed;
beforeEach(() => {
  server = createMockServer();
  clock = createWallClock();
  removed = [];
});

// Fake Storage client that records which paths get removed.
function fakeStorageClient() {
  return {
    storage: {
      from: () => ({
        remove: (paths) => { removed.push(...paths); return Promise.resolve({ error: null }); },
      }),
    },
  };
}

describe('reference-aware source cleanup', () => {
  it('keeps a shared path, removes unique files and the question image', async () => {
    const d = await makeDevice({ server, userId: USER, clock, name: 'gc' });
    await d.settle();
    const sources = createSourcesService({ client: fakeStorageClient(), userId: USER, repos: d.repos });

    const sem = await d.repos.semesters.create('S');
    const cls = await d.repos.classes.create({ semesterId: sem.id, name: 'C', color: '#000' });
    const deckA = await d.repos.decks.create({ classId: cls.id, name: 'A' });
    const deckB = await d.repos.decks.create({ classId: cls.id, name: 'B (Save-as-New of A)' });

    // 'shared' is referenced by BOTH decks (as Save-as-New does); 'onlyA' by A.
    await d.repos.sourceFiles.create({ deckId: deckA.id, name: 's.pdf', kind: 'pdf', storagePath: 'u/shared' });
    await d.repos.sourceFiles.create({ deckId: deckB.id, name: 's.pdf', kind: 'pdf', storagePath: 'u/shared' });
    await d.repos.sourceFiles.create({ deckId: deckA.id, name: 'a.pdf', kind: 'pdf', storagePath: 'u/onlyA' });

    const [q] = await d.repos.questions.createMany(deckA.id, [
      { type: 'mc', q: '?', opts: ['a', 'b', 'c', 'd'], ans: 0, explain: '', cat: 'X' },
    ]);
    await d.repos.questions.update(q.id, { sourceImagePath: 'u/qimg/q1' });

    await sources.deleteForDeck(deckA.id);

    // shared path stays (deck B still references it); unique file + image go.
    expect(removed.sort()).toEqual(['u/onlyA', 'u/qimg/q1']);
    expect(removed).not.toContain('u/shared');

    // A's source_files metadata is tombstoned; B's is untouched.
    expect(await d.repos.sourceFiles.listByDeck(deckA.id)).toEqual([]);
    expect((await d.repos.sourceFiles.listByDeck(deckB.id)).map((r) => r.storagePath)).toEqual(['u/shared']);
  });

  it('removes a path once the LAST referencing deck is deleted', async () => {
    const d = await makeDevice({ server, userId: USER, clock, name: 'gc2' });
    await d.settle();
    const sources = createSourcesService({ client: fakeStorageClient(), userId: USER, repos: d.repos });

    const sem = await d.repos.semesters.create('S');
    const cls = await d.repos.classes.create({ semesterId: sem.id, name: 'C', color: '#000' });
    const deckA = await d.repos.decks.create({ classId: cls.id, name: 'A' });
    const deckB = await d.repos.decks.create({ classId: cls.id, name: 'B' });
    await d.repos.sourceFiles.create({ deckId: deckA.id, name: 's.pdf', kind: 'pdf', storagePath: 'u/shared' });
    await d.repos.sourceFiles.create({ deckId: deckB.id, name: 's.pdf', kind: 'pdf', storagePath: 'u/shared' });

    await sources.deleteForDeck(deckA.id);   // B still references → kept
    expect(removed).not.toContain('u/shared');
    await d.repos.decks.remove(deckA.id);

    await sources.deleteForDeck(deckB.id);   // now nobody references → removed
    expect(removed).toContain('u/shared');
  });
});
