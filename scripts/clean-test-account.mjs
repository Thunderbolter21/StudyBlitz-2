// clean-test-account.mjs — wipes ALL rows belonging to the throwaway
// integration-test account (and only that account), so e2e runs start
// from a known-empty state.
//
//   node scripts/clean-test-account.mjs
//
// Safe by construction: it signs in as the test account and RLS means it
// can only ever touch that account's rows.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);

const url = new URL(env.VITE_SUPABASE_URL).origin;
const client = createClient(url, env.VITE_SUPABASE_ANON_KEY.trim(), {
  auth: { persistSession: false },
});

const { data, error } = await client.auth.signInWithPassword({
  email: env.VITE_SB2_TEST_EMAIL,
  password: env.VITE_SB2_TEST_PASSWORD,
});
if (error) throw new Error('Test-account sign-in failed: ' + error.message);
const uid = data.session.user.id;

// Children before parents (FKs cascade anyway, but explicit is clearer).
const TABLES = [
  'card_memory', 'questions', 'source_files', 'high_scores',
  'decks', 'classes', 'semesters', 'presets', 'user_settings',
];
for (const table of TABLES) {
  const { error: delErr, count } = await client
    .from(table)
    .delete({ count: 'exact' })
    .eq('user_id', uid);
  if (delErr) throw new Error(`${table}: ${delErr.message}`);
  console.log(`${table}: removed ${count ?? 0}`);
}
await client.auth.signOut();
console.log('Test account is empty.');
