# src/data — the data layer (Phase 1)

Screens never touch Supabase or IndexedDB directly; they go through here.

- `db.js` — thin IndexedDB wrapper (object store per table + outbox + meta)
- `repositories.js` — CRUD per entity; stamps `updated_at`, enqueues outbox
- `sync.js` — outbox flush (pull-before-push, per-row LWW) + cursor pulls
- `store.js` — tiny subscribe/notify state store

The SYNC RULES in /CLAUDE.md govern everything in this folder.
