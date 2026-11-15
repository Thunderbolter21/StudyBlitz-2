# StudyBlitz 2

Adaptive quiz app: drop in class notes, Claude generates a quiz deck, and an
SM-2 spaced-repetition engine brings missed questions back right before you'd
forget them.

Full rebuild of v1 (kept read-only in [`reference-v1/`](reference-v1/)):
same quiz brain, new per-row cloud sync, new semester → class → deck
organization, new paper-and-desk design.

**Stack:** vanilla JS (ES modules) + Vite + Supabase. No frameworks.

## Quick start

```bash
npm install
cp .env.example .env   # then fill in your Supabase URL + anon key
npm run dev
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | local dev server |
| `npm run build` | production build to `dist/` |
| `npm test` | run the Vitest suite |

Being built in phases — see [`CLAUDE.md`](CLAUDE.md) for architecture,
sync rules, and current phase status. Full setup guide lands in Phase 6.
