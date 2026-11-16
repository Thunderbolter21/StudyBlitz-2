// sync.integration.test.js — runs against the REAL Supabase project.
//
//   npm run test:integration
//
// The simulated two-device tests prove the merge logic; THIS file proves the
// things a mock cannot: that RLS policies actually deny strangers, that the
// trigger really preserves client `updated_at`, and that the production
// sync path round-trips through PostgREST.
//
// It uses a throwaway test account (sb2-integration-test@example.com with a
// password derived from the public anon key). If email confirmation is ON in
// Supabase, either disable it (Authentication → Providers → Email) or create
// that user once in the dashboard (Authentication → Users → Add user, which
// auto-confirms) and put the credentials in .env as
// VITE_SB2_TEST_EMAIL / VITE_SB2_TEST_PASSWORD.
//
// Every row it creates is removed again in afterAll.

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { IDBFactory } from 'fake-indexeddb';
import { openDb } from './db.js';
import { createSync } from './sync.js';
import { createRepos } from './repositories.js';

// Use config.js (not raw env) so URL cleanup there applies here too.
import { SUPABASE_URL as URL, SUPABASE_ANON_KEY as KEY } from '../config.js';

const EMAIL = import.meta.env.VITE_SB2_TEST_EMAIL || 'sb2-integration-test@example.com';
// Derived from the (public) anon key so it's stable per project with zero setup.
const PASSWORD = import.meta.env.VITE_SB2_TEST_PASSWORD || 'Sb2!' + KEY?.slice(-14);

const configured = Boolean(URL && KEY);

describe.skipIf(!configured)('real Supabase integration (throwaway account)', () => {
  let client;      // authed as the test user
  let userId;
  let device;      // real db+sync+repos stack against the real server

  const runTag = `IT-${Date.now()}`; // unique per run, used for cleanup

  async function makeRealDevice(name) {
    const db = await openDb(`sb2-it-${name}`, new IDBFactory());
    const sync = createSync({ db, client, userId, isOnline: () => true });
    const repos = createRepos({ db, sync, userId });
    return { db, sync, repos };
  }

  beforeAll(async () => {
    client = createClient(URL, KEY, { auth: { persistSession: false } });

    let { data, error } = await client.auth.signInWithPassword({
      email: EMAIL,
      password: PASSWORD,
    });
    if (error) {
      ({ data, error } = await client.auth.signUp({ email: EMAIL, password: PASSWORD }));
      if (error) {
        throw new Error(
          `Could not sign in or create the test account (${error.message}). ` +
          `Create it in the Supabase dashboard (Authentication → Users → Add user: ${EMAIL}) ` +
          `and set VITE_SB2_TEST_EMAIL / VITE_SB2_TEST_PASSWORD in .env.`
        );
      }
      if (!data.session) {
        throw new Error(
          'Email confirmation is ON, so the fresh test account has no session. ' +
          'Either disable confirmation (Authentication → Providers → Email) or create a ' +
          'confirmed user in the dashboard and set VITE_SB2_TEST_EMAIL / VITE_SB2_TEST_PASSWORD.'
        );
      }
    }
    userId = data.session.user.id;
    device = await makeRealDevice('primary');
    await device.sync.hydrate();
  });

  afterAll(async () => {
    if (!userId) return;
    // Remove everything this run created (real deletes — test hygiene only;
    // the app itself never hard-deletes).
    await client.from('semesters').delete().eq('user_id', userId).like('name', `${runTag}%`);
    await client.from('user_settings').delete().eq('user_id', userId);
    await client.auth.signOut();
  });

  it('pushes a created row and the trigger PRESERVES client updated_at', async () => {
    const sem = await device.repos.semesters.create(`${runTag} trigger check`);
    await device.sync.flush();

    const { data, error } = await client
      .from('semesters').select('*').eq('id', sem.id).single();
    expect(error).toBeNull();
    expect(data.name).toBe(`${runTag} trigger check`);
    // The trigger must set server time WITHOUT clobbering the client edit time.
    expect(data.server_updated_at).toBeTruthy();
    expect(new Date(data.updated_at).getTime()).toBe(new Date(sem.updatedAt).getTime());
  });

  it('advances server_updated_at on update while keeping the client edit time', async () => {
    const sem = await device.repos.semesters.create(`${runTag} advance check`);
    await device.sync.flush();
    const { data: v1 } = await client.from('semesters').select('*').eq('id', sem.id).single();

    const renamed = await device.repos.semesters.rename(sem.id, `${runTag} advance check v2`);
    await device.sync.flush();
    const { data: v2 } = await client.from('semesters').select('*').eq('id', sem.id).single();

    expect(new Date(v2.server_updated_at).getTime())
      .toBeGreaterThan(new Date(v1.server_updated_at).getTime());
    expect(new Date(v2.updated_at).getTime()).toBe(new Date(renamed.updatedAt).getTime());
  });

  it('RLS: an anonymous client reads nothing and cannot write', async () => {
    const anon = createClient(URL, KEY, { auth: { persistSession: false } });

    const { data: rows, error: readErr } = await anon.from('semesters').select('*');
    expect(readErr).toBeNull();
    expect(rows).toEqual([]); // our rows exist, but RLS hides every one

    const { error: writeErr } = await anon.from('semesters').insert({
      id: crypto.randomUUID(),
      user_id: userId,
      name: `${runTag} should never exist`,
      updated_at: new Date().toISOString(),
    });
    expect(writeErr).not.toBeNull(); // insert denied
  });

  it('RLS: an authed user cannot write rows under someone else\'s user_id', async () => {
    const { error } = await client.from('semesters').insert({
      id: crypto.randomUUID(),
      user_id: crypto.randomUUID(), // a stranger
      name: `${runTag} forged row`,
      updated_at: new Date().toISOString(),
    });
    expect(error).not.toBeNull(); // WITH CHECK (auth.uid() = user_id) rejects it
  });

  it('soft delete syncs as a tombstone, not a removal', async () => {
    const sem = await device.repos.semesters.create(`${runTag} doomed`);
    await device.sync.flush();
    await device.repos.semesters.remove(sem.id);
    await device.sync.flush();

    const { data } = await client.from('semesters').select('*').eq('id', sem.id).single();
    expect(data).toBeTruthy(); // row still exists…
    expect(data.deleted_at).toBeTruthy(); // …as a tombstone
  });

  it('user_settings round-trips on its user_id primary key', async () => {
    await device.repos.settings.save({ model: 'claude-sonnet-5', preferences: { it: runTag } });
    await device.sync.flush();

    const { data, error } = await client
      .from('user_settings').select('*').eq('user_id', userId).single();
    expect(error).toBeNull();
    expect(data.model).toBe('claude-sonnet-5');
    expect(data.preferences.it).toBe(runTag);
  });

  it('a second fresh device hydrates the data through the real server', async () => {
    const sem = await device.repos.semesters.create(`${runTag} cross-device`);
    await device.sync.flush();

    const second = await makeRealDevice('second');
    await second.sync.hydrate();

    const names = (await second.repos.semesters.list()).map((s) => s.name);
    expect(names).toContain(`${runTag} cross-device`);
  });
});

if (!configured) {
  describe('real Supabase integration', () => {
    it.skip('skipped — VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set in .env', () => {});
  });
}
