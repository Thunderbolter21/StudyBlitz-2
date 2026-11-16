# CLAUDE.md — StudyBlitz 2

Guidance for Claude Code sessions working in this repo. Read this first;
it is the source of truth for architecture decisions and project state.

## What this is

StudyBlitz 2: adaptive quiz app for one student (Matt). Notes go in
(PDF/DOCX/PPTX/images/URLs), Claude generates a quiz deck client-side with
the user's own API key, an SM-2 engine schedules missed questions. Full
rebuild of v1 — **`reference-v1/` holds v1's source and is READ-ONLY.**
Read it to port behavior faithfully; never copy its architecture
(single-blob sync), its 3D code, or its dark-glass styling.

## Current state

- **Phase 2 (design system + app shell) — complete; awaiting Matt's review.**
- The component reference is the `#styleguide` page (viewable WITHOUT
  signing in). If a component isn't shown there, it doesn't exist yet.
  Token contrast is enforced by `src/styles/tokens.test.js`.
- Supabase project is live, 0001_init.sql has been run, and the integration
  suite passes against it (`npm run test:integration`) — schema, triggers,
  and RLS verified for real. The throwaway test account is a confirmed
  dashboard user; its creds live in .env (VITE_SB2_TEST_EMAIL/PASSWORD).
- Netlify site: not yet created.
- Email confirmation is ON in the Supabase project — sign-up flows must
  handle the "check your email" path (AuthPage does).

## Commands

```bash
npm run dev               # Vite dev server
npm run build             # production build (watch gzip sizes — budget below)
npm test                  # Vitest unit suite (offline, fast, always safe)
npm run test:watch
npm run test:integration  # REAL-Supabase test; needs .env + the throwaway
                          # test account (VITE_SB2_TEST_EMAIL/PASSWORD in .env)
```

## Locked decisions (do not relitigate)

- Vanilla JS ES modules + Vite + Supabase. **No React/Vue/Svelte/Tailwind/
  TypeScript.** Code must stay readable by a beginner; comment the "why".
- Fresh start: zero decks, no v1 importer.
- Credentials only from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
  **Never a service-role key in the frontend.**
- Supabase Auth (email/password + magic link). All data behind RLS
  (`auth.uid() = user_id`).
- AI calls are client-side with the user's Anthropic key (header
  `anthropic-dangerous-direct-browser-access: true`). Key is stored in
  `user_settings` under RLS and synced across devices. Settings must show:
  "Your key is stored in your account so it works on every device."
- Generation model is named in exactly ONE place:
  `GENERATION_MODEL_DEFAULT` in `src/config.js` (user override in
  `user_settings.model`). Default: `claude-sonnet-5`.
- Quiz feel is sacred: v1's feedback logic, sequence, and timing are
  preserved exactly (see "Quiz timing contract" below). Only visuals change.
- Builder keeps BOTH methods: direct API and copy-prompt-for-claude.ai +
  paste-JSON import.
- New source inputs vs v1: DOCX (mammoth, lazy-loaded), PPTX (zip+XML text
  extraction, lazy-loaded), URLs (API url-source / web-fetch tool). v1 only
  had images+PDF.
- PWA (vite-plugin-pwa) added in Phase 6.

## Architecture

```
src/
  config.js    env + GENERATION_MODEL_DEFAULT (the one place models are named)
  data/        db.js (IndexedDB), repositories.js, sync.js (outbox+pull), store.js (pub/sub)
  engine/      sm2.js, grading.js, quiz modes (ported from reference-v1)
  ai/          generation.js, presets.js, json-repair.js
  ui/          reusable components
  pages/       screens (never touch Supabase/IndexedDB directly — repositories only)
  styles/      tokens.css (ALL design values) + per-component css
supabase/migrations/   SQL to paste into the Supabase SQL editor
```

- Screens call repositories; repositories hit IndexedDB first, sync layer
  mirrors to Supabase. One pub/sub store for state.
- Hash routing with deep links, including `#review?deck=ID`.
- All styling through `src/styles/tokens.css` custom properties —
  no one-off hex values in components. CSS layers: tokens → global →
  surfaces (paper/cards/tabs/decor) → components (buttons/forms/chrome).
  Text ALWAYS sits on paper surfaces, never directly on the desk.
- Decoration (SVG pencils/erasers, paper texture) lives AROUND study
  surfaces, never inside quiz screens. No WebGL, no video, no big rasters.
- Performance budget: initial JS < 150 kB gzipped. Heavy parsers
  (DOCX/PPTX) are dynamic imports.

## SYNC RULES (non-negotiable — from the product spec)

1. Local-first: all reads/writes hit IndexedDB first, instantly, even
   offline. A change is durable locally the moment it happens.
2. Outbox: every local change is queued and pushed to Supabase as a
   row-level upsert. Flush immediately, and again on pagehide,
   visibilitychange (hidden), and reconnect. No debounce-only writes.
3. Pull before push. Never overwrite a remote row without reconciling it.
4. Conflicts resolve PER ROW by `updated_at` (latest edit wins, that row
   only). Different rows never conflict.
5. Deletes are soft (`deleted_at` tombstones) and TERMINAL: a tombstone
   beats any concurrent edit, even a newer one, and there is no restore.
   Stale devices can never resurrect or wipe rows.
6. Never-clobber: a fresh/empty device must fully pull (hydrate) before it
   may push. Structurally there is NO code path that writes a whole
   collection — only per-row upserts.
7. Sync state (synced / syncing / offline / error) is visible in the UI;
   failed writes surface, never swallowed.
8. The merge/outbox logic has unit tests for: two devices editing different
   rows; same row; offline edits replayed later; delete-vs-edit; fresh
   device first sign-in.

Implementation details: client-set `updated_at` is the merge key;
trigger-set `server_updated_at` is the pull cursor (`where
server_updated_at > cursor`). See `supabase/migrations/0001_init.sql`.

## Quiz timing contract (port of v1 — do not change)

- Answer → lockout + verdict + explanation render synchronously (0 ms).
  Explanation shows on correct AND wrong answers.
- Wrong answers: "— Added to weak spots." suffix; source-image thumbnail
  +50 ms; MC shows chosen=red + correct=green.
- Next button available immediately; Enter/Space advances; A–D / 1–4 answer.
- Time challenge: auto-advance +400 ms after answering (while timer alive);
  urgency pulse under 10 s; timeout → +300 ms → results.
- Free-response input autofocus +80 ms.
- Results: v1 letter-grade scale; confetti ≥80 % or new TC high score.
- Drill mode re-filters to still-weak after every answer and loops.
- SM-2 formulas ported byte-identical from `reference-v1/src/engine/memory.js`
  (quality from p33/p66 response-time percentiles; timing appended BEFORE
  quality is computed; `responseTimes` capped at 20, only 0<ms<60000).

## Conventions

- Small single-purpose modules; short functions; beginner-readable
  comments explaining "why" on anything non-obvious.
- Tests: Vitest. SM-2 parity (against an in-test copy of v1's algorithm),
  grading (all 3 types), JSON repair, merge/outbox scenarios. Tests must
  pass before a phase is declared done.
- Each phase ends: tests green → build clean → phase report → update this
  file → commit → STOP for Matt's review.

## Data-layer conventions (Phase 1)

- One IndexedDB database per user: `sb2-<userId>` — accounts never mix.
- Local rows are camelCase (v1 data-shape parity, e.g. `everWrong`,
  `interval`); remote columns are snake_case. The ONLY mapping point is
  `toRemote`/`toLocal` in `src/data/schema.js` (note `interval` ↔
  `interval_days`).
- `card_memory` row id IS the question id (1 record per user per question,
  so two devices merge instead of colliding on the unique constraint).
- `high_scores` row id is derived from deckId+seconds (same reason) —
  see `deriveScoreId` in repositories.js.
- `user_settings` pk is `userId`, not `id`.
- Supabase URL from env is normalized to its origin in config.js — users
  paste `/rest/v1` suffixes and trailing slashes; never read raw env.
- Tests: `src/data/testing/` holds the mock server + device harness. A
  "device" = fresh fake IndexedDB + REAL sync/repo code.

## Phase plan

0. ✅ Foundation: scaffold, tokens skeleton, migration SQL, env, Netlify.
1. ✅ Data layer + Auth + Sync — unit matrix green + live integration test
   passing against the real project.
2. ✅ Design system + app shell: tokens (AA-audited by test), paper/desk
   surfaces, @fontsource latin fonts, shell (header/tabs/outlet), hash
   router, toast/modal, SVG desk decorations, `#styleguide` page.
3. Hierarchy UI: semesters/classes/decks CRUD, move, archive.
4. Quiz Builder + presets + API key (+ DOCX/PPTX/URL inputs).
5. Quiz engine port (parity tests, feedback reskin with v1 timing).
6. Polish & ship: backup, onboarding, a11y, perf, PWA, deploy checklist.

## Gotchas

- Repo lives inside OneDrive — if git behaves oddly, that's the first
  suspect (`.git` + `node_modules` sync friction).
- `Login Stuff.txt` in the repo root folder is Matt's private notes:
  gitignored, NEVER commit or read it into context.
- `reference-v1/` is missing its `index.html` and `vite.config.js` — v1's
  DOM skeleton is only inferable from its JS/CSS. All ported behavior
  comes from the JS, which is complete.
