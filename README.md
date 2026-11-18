# StudyBlitz 2

Adaptive quiz app: drop in class notes, Claude generates a quiz deck, and an
SM-2 spaced-repetition engine brings missed questions back right before you'd
forget them.

Full rebuild of v1 (kept read-only in [`reference-v1/`](reference-v1/)):
same quiz brain, new per-row cloud sync, new semester → class → deck
organization, new paper-and-desk design, installable as a phone app.

**Stack:** vanilla JS (ES modules) + Vite + Supabase. No frameworks.

## Quick start (local)

```bash
npm install
cp .env.example .env     # then fill in your Supabase URL + anon key
npm run dev              # http://localhost:5173
```

The style guide (every UI component) is at `#styleguide` and needs no login.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | local dev server |
| `npm run build` | production build to `dist/` (prints gzip sizes) |
| `npm run preview` | serve the production build locally |
| `npm test` | Vitest unit suite (offline, fast) |
| `npm run test:integration` | live tests against the real Supabase project (needs `.env` + the throwaway test account) |

E2E walkthroughs (headless Edge, dev server must be running) live in
`scripts/`: `e2e-home`, `e2e-builder`, `e2e-quiz`, `e2e-quizstates`, and
`e2e-pwa` (the deploy-swap proof). Credentials come only from `.env`.

## How it works (one paragraph)

Everything you do writes to a per-user IndexedDB first (instant, offline-ok),
then an outbox mirrors each row to Supabase. Reads never touch the network.
Conflicts resolve per row by edit time; deletes are tombstones. The Quiz
Builder calls Claude directly from your browser with **your own** API key
(stored in your account under Row Level Security, synced across devices). The
quiz engine is a faithful port of v1 — SM-2, grading, and the feedback timing
are unchanged; only the look is new. See [`CLAUDE.md`](CLAUDE.md) for the full
architecture and the non-negotiable sync rules.

## First-time setup — Supabase

1. Create a new project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query** → paste and run, in order:
   - `supabase/migrations/0001_init.sql` (tables, RLS, triggers, Storage bucket)
   - `supabase/migrations/0002_preset_description.sql`
3. **Authentication → Providers → Email**: keep Email enabled. Email
   confirmation can be on or off — the app handles both (magic-link sign-in
   is also available).
4. **Project Settings → API**: copy the **Project URL** and the **anon public**
   key into `.env` (local) and into Netlify (below). The anon key is safe in
   the browser — RLS protects every table. **Never** use the service-role key
   in the frontend.

## First-time setup — Netlify

1. **Add new site → Import from Git** → pick this repo. Build settings are read
   from [`netlify.toml`](netlify.toml) (`npm run build` → publish `dist/`, with
   an SPA fallback redirect).
2. **Site configuration → Environment variables** → add:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon public key
3. Deploy. Open the site, create an account, and start building decks.
4. Install on your phone: open the site in mobile Chrome/Safari → **Add to
   Home Screen**.

## Deploy checklist (every release)

- [ ] `npm test` green and `npm run build` clean (initial JS < 150 kB gzipped)
- [ ] New SQL migrations run in the Supabase SQL editor, in filename order
- [ ] Netlify env vars present (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
- [ ] After deploy, hard-load the site once — the service worker auto-updates
      and reloads to the new bundle (no manual cache clear needed)

## Data safety

- **Backups:** Settings → Data backup → Export a JSON of your library; Import
  offers Merge or Replace and never silently overwrites. (API key is never in
  a backup.)
- **Sync:** a fresh device fully pulls before it can push, so it can never
  overwrite your cloud data with less.
