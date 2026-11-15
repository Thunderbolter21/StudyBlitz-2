# src/ai — quiz generation (Phase 4)

- `generation.js` — client-side Anthropic API calls (user's own key,
  `anthropic-dangerous-direct-browser-access` header), 529 backoff, retries
- `json-repair.js` — self-healing JSON extraction (fences → array →
  jsonrepair), ported from v1's Generator.js
- `presets.js` — built-in instruction presets + user presets

Model name comes ONLY from src/config.js / user_settings.model.
