// repositories.js — the ONLY way app code reads or writes data.
// Pages never import Supabase or IndexedDB directly; they call these.
//
// Every write:
//   1. stamps `updatedAt` with the edit time (the per-row merge key),
//   2. saves to IndexedDB (durable immediately, even offline),
//   3. enqueues the row in the sync outbox,
//   4. notifies the store so the UI re-renders.
//
// Deletes are soft and TERMINAL: we set `deletedAt` and the row is gone for
// good (tombstones sync so no stale device can bring it back). Deleting a
// parent cascades tombstones to its children, row by row.

import { createStore } from './store.js';

export function createRepos({ db, sync, userId, now = () => Date.now() }) {
  // Bumps `dataVersion` after every local write; pages subscribe to this.
  const events = createStore({ dataVersion: 0 });
  const notify = () => events.patch({ dataVersion: events.get().dataVersion + 1 });

  const iso = () => new Date(now()).toISOString();
  const newId = () => crypto.randomUUID();

  const isLive = (row) => row && !row.deletedAt;

  // ── Generic helpers every entity shares ─────────────────────────────────
  async function getLive(table, id) {
    const row = await db.get(table, id);
    return isLive(row) ? row : null;
  }

  async function listLive(table) {
    return (await db.getAll(table)).filter(isLive);
  }

  async function listByIndex(table, index, value) {
    return (await db.byIndex(table, index, value)).filter(isLive);
  }

  // Create or update one row, stamp it, queue it for sync.
  async function save(table, pk, partial) {
    const existing = partial[pk] ? await db.get(table, partial[pk]) : null;
    if (existing?.deletedAt) {
      // Deletes are terminal — editing a tombstone is a programming error.
      throw new Error(`Cannot edit deleted row ${table}/${partial[pk]}`);
    }
    const row = {
      ...(existing || { [pk]: partial[pk] ?? newId(), userId, createdAt: iso() }),
      ...partial,
      updatedAt: iso(),
    };
    await db.put(table, row);
    await sync.enqueue(table, row[pk]);
    notify();
    return row;
  }

  async function softDelete(table, pk, id) {
    const row = await db.get(table, id);
    if (!row || row.deletedAt) return;
    row.deletedAt = iso();
    row.updatedAt = row.deletedAt;
    await db.put(table, row);
    await sync.enqueue(table, id);
    notify();
  }

  const byOrder = (a, b) =>
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
    String(a.createdAt).localeCompare(String(b.createdAt));

  // ── Semesters ────────────────────────────────────────────────────────────
  const semesters = {
    async list() {
      return (await listLive('semesters')).sort(byOrder);
    },
    get: (id) => getLive('semesters', id),
    async create(name) {
      const all = await this.list();
      const sortOrder = all.length ? Math.max(...all.map((s) => s.sortOrder ?? 0)) + 1 : 0;
      return save('semesters', 'id', { name, sortOrder, archivedAt: null });
    },
    rename: (id, name) => save('semesters', 'id', { id, name }),
    setArchived: (id, archived) =>
      save('semesters', 'id', { id, archivedAt: archived ? new Date(now()).toISOString() : null }),
    // Cascades: semester → classes → decks → questions (all tombstoned).
    async remove(id) {
      for (const cls of await classes.listBySemester(id)) {
        await classes.remove(cls.id);
      }
      await softDelete('semesters', 'id', id);
    },
  };

  // ── Classes ──────────────────────────────────────────────────────────────
  const classes = {
    list: () => listLive('classes'),
    listBySemester: (semesterId) => listByIndex('classes', 'semesterId', semesterId),
    get: (id) => getLive('classes', id),
    create: ({ semesterId, name, color }) =>
      save('classes', 'id', { semesterId, name, color }),
    rename: (id, name) => save('classes', 'id', { id, name }),
    setColor: (id, color) => save('classes', 'id', { id, color }),
    moveToSemester: (id, semesterId) => save('classes', 'id', { id, semesterId }),
    async remove(id) {
      for (const deck of await decks.listByClass(id)) {
        await decks.remove(deck.id);
      }
      await softDelete('classes', 'id', id);
    },
  };

  // ── Decks ────────────────────────────────────────────────────────────────
  const decks = {
    list: () => listLive('decks'),
    listByClass: (classId) => listByIndex('decks', 'classId', classId),
    get: (id) => getLive('decks', id),
    create: (fields) => save('decks', 'id', { generationCount: 1, ...fields }),
    update: (id, fields) => save('decks', 'id', { id, ...fields }),
    moveToClass: (id, classId) => save('decks', 'id', { id, classId }),
    async remove(id) {
      for (const q of await questions.listByDeck(id)) {
        await softDelete('questions', 'id', q.id);
      }
      await softDelete('decks', 'id', id);
    },
  };

  // ── Questions ────────────────────────────────────────────────────────────
  const questions = {
    async listByDeck(deckId) {
      return (await listByIndex('questions', 'deckId', deckId)).sort(byOrder);
    },
    get: (id) => getLive('questions', id),
    // Saving a generated deck writes many rows; each gets its own outbox
    // entry and the flush batches them into one upsert per table.
    async createMany(deckId, questionRows) {
      const saved = [];
      for (const [i, q] of questionRows.entries()) {
        saved.push(await save('questions', 'id', { ...q, deckId, sortOrder: i }));
      }
      return saved;
    },
    update: (id, fields) => save('questions', 'id', { id, ...fields }),
    remove: (id) => softDelete('questions', 'id', id),
  };

  // ── Card memory (SM-2 records) ───────────────────────────────────────────
  // One record per question per user. The row id IS the question id: both
  // are uuids the user owns, so this is unique — and it means two devices
  // answering the same question create the SAME row and merge by updatedAt
  // instead of colliding on the (user_id, question_id) constraint.
  const cardMemory = {
    async getForQuestion(questionId) {
      return getLive('card_memory', questionId);
    },
    async saveForQuestion(questionId, record) {
      return save('card_memory', 'id', { ...record, id: questionId, questionId });
    },
    list: () => listLive('card_memory'),
  };

  // ── Presets (user-saved quiz instructions) ───────────────────────────────
  const presets = {
    async list() {
      return (await listLive('presets')).sort(byOrder);
    },
    create: (name, body) => save('presets', 'id', { name, body, sortOrder: 0 }),
    update: (id, fields) => save('presets', 'id', { id, ...fields }),
    remove: (id) => softDelete('presets', 'id', id),
  };

  // ── Settings (one row; primary key is the user id) ───────────────────────
  const settings = {
    async get() {
      return (await getLive('user_settings', userId)) || { userId, preferences: {} };
    },
    async save(partial) {
      const current = await this.get();
      return save('user_settings', 'userId', { ...current, ...partial, userId });
    },
  };

  // ── High scores (time challenge bests) ───────────────────────────────────
  // Deterministic id derived from (deckId, seconds) so two devices recording
  // a best for the same deck+time write the SAME row instead of violating
  // the unique constraint. We replace the last 8 hex chars of the deck's
  // uuid with the seconds value — still a valid, collision-safe uuid.
  const deriveScoreId = (deckId, seconds) =>
    deckId.slice(0, 28) + seconds.toString(16).padStart(8, '0');

  const highScores = {
    async best(deckId, seconds) {
      return getLive('high_scores', deriveScoreId(deckId, seconds));
    },
    async record(deckId, seconds, correct, total) {
      const prev = await this.best(deckId, seconds);
      if (prev && prev.correct >= correct) return prev; // only keep improvements
      return save('high_scores', 'id', {
        id: deriveScoreId(deckId, seconds),
        deckId, seconds, correct, total,
        achievedAt: new Date(now()).toISOString(),
      });
    },
  };

  return {
    events,
    semesters,
    classes,
    decks,
    questions,
    cardMemory,
    presets,
    settings,
    highScores,
  };
}
