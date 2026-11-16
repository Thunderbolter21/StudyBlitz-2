// schema.js — the single source of truth for what tables exist, what their
// primary keys are, and how LOCAL field names (camelCase, used everywhere in
// app code) map to REMOTE column names (snake_case, used by Postgres).
//
// Why two shapes? The app keeps v1's data shapes (e.g. a memory record has
// `everWrong` and `interval`) so the quiz engine ports over unchanged, while
// the database uses SQL-friendly snake_case. The mapping happens in exactly
// one place: toRemote() / toLocal() below.

export const TABLES = {
  semesters: {
    pk: 'id',
    columns: ['name', 'sortOrder', 'archivedAt'],
    indexes: [],
  },
  classes: {
    pk: 'id',
    columns: ['semesterId', 'name', 'color'],
    indexes: ['semesterId'],
  },
  decks: {
    pk: 'id',
    columns: [
      'classId', 'name', 'color', 'lastScore',
      'generationInstructions', 'generationNotes', 'generationCount',
    ],
    indexes: ['classId'],
  },
  questions: {
    pk: 'id',
    columns: [
      'deckId', 'type', 'q', 'opts', 'ans', 'explain', 'cat',
      'sortOrder', 'sourceImagePath',
    ],
    indexes: ['deckId'],
  },
  card_memory: {
    pk: 'id',
    columns: [
      'questionId', 'correct', 'total', 'everWrong', 'lastResult',
      'reps', 'ease', 'interval', 'due', 'responseTimes',
    ],
    // `interval` is a reserved word in SQL, so the column is interval_days.
    // Locally we keep `interval` for v1 parity.
    renames: { interval: 'interval_days' },
    indexes: ['questionId'],
  },
  presets: {
    pk: 'id',
    columns: ['name', 'body', 'sortOrder'],
    indexes: [],
  },
  user_settings: {
    // One row per user; its primary key IS the user id.
    pk: 'userId',
    columns: ['anthropicApiKey', 'model', 'preferences'],
    indexes: [],
  },
  source_files: {
    pk: 'id',
    columns: [
      'deckId', 'name', 'kind', 'mediaType', 'sizeBytes',
      'originalSize', 'storagePath', 'sourceUrl',
    ],
    indexes: ['deckId'],
  },
  high_scores: {
    pk: 'id',
    columns: ['deckId', 'seconds', 'correct', 'total', 'achievedAt'],
    indexes: ['deckId'],
  },
};

export const TABLE_NAMES = Object.keys(TABLES);

// Columns every table shares. serverUpdatedAt is read-only (set by a DB
// trigger) — we receive it on pulls but never push it.
const COMMON_COLUMNS = ['createdAt', 'updatedAt', 'deletedAt'];

const camelToSnake = (k) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
const snakeToCamel = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

// Local row (camelCase) → remote row (snake_case), including only known
// columns so a stray local field can never cause a Postgres error.
export function toRemote(table, row) {
  const def = TABLES[table];
  const renames = def.renames || {};
  const out = {};
  const keys = [def.pk, 'userId', ...COMMON_COLUMNS, ...def.columns];
  for (const key of keys) {
    if (row[key] === undefined) continue;
    const remoteKey = renames[key] || camelToSnake(key);
    out[remoteKey] = row[key];
  }
  return out;
}

// Remote row (snake_case) → local row (camelCase).
export function toLocal(table, remoteRow) {
  const def = TABLES[table];
  const renames = def.renames || {};
  // Invert the rename map: { interval: 'interval_days' } → { interval_days: 'interval' }
  const reverse = {};
  for (const [localKey, remoteKey] of Object.entries(renames)) reverse[remoteKey] = localKey;

  const out = {};
  for (const [remoteKey, value] of Object.entries(remoteRow)) {
    const localKey = reverse[remoteKey] || snakeToCamel(remoteKey);
    out[localKey] = value;
  }
  return out;
}
