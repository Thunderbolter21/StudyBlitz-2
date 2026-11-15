// config.js — environment variables and app-wide constants.
//
// Credentials come ONLY from environment variables (never hardcoded):
//   - locally:   a `.env` file in the repo root (gitignored; see .env.example)
//   - on Netlify: Site settings → Environment variables
//
// The anon key is safe to ship to browsers BECAUSE every table is protected
// by Row Level Security — the key alone grants access to nothing.

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// The ONE place the generation model is named. Users can override it in
// Settings (stored in user_settings.model); everything else imports this.
export const GENERATION_MODEL_DEFAULT = 'claude-sonnet-5';

// True when both Supabase env vars are present. The app refuses to start
// without them (cloud-first — there is no local-only mode in v2).
export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
