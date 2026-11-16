// main.js — boot sequence.
// Decides between the auth screen and the app, and wires the data layer
// together (per-user IndexedDB → sync engine → repositories → pages).

import './styles/tokens.css';
import './styles/base.css';
import { isSupabaseConfigured } from './config.js';
import { createSupabaseClient } from './data/supabase.js';
import { createSession } from './data/session.js';
import { openDb } from './data/db.js';
import { createSync } from './data/sync.js';
import { createRepos } from './data/repositories.js';
import { createStore } from './data/store.js';
import { renderAuthPage } from './pages/AuthPage.js';
import { renderHomePage } from './pages/HomePage.js';

const app = document.getElementById('app');

// Holds the pieces of the running app so sign-out can tear them down.
let running = null;

async function startApp(client, session, supaSession) {
  const user = supaSession.user;

  // One IndexedDB database per user — accounts can never mix data.
  const db = await openDb(`sb2-${user.id}`);

  const appStore = createStore({
    userEmail: user.email,
    syncStatus: 'syncing',
    pending: 0,
  });

  const sync = createSync({
    db,
    client,
    userId: user.id,
    onChange: (status, { pending }) => appStore.patch({ syncStatus: status, pending }),
  });

  const repos = createRepos({ db, sync, userId: user.id });

  const teardownPage = renderHomePage(app, { repos, appStore, session, sync });
  running = { db, sync, teardownPage };

  // Hydrate (first sign-in pulls everything BEFORE any push is allowed),
  // then start the heartbeat + flush-on-exit listeners.
  await sync.start();
}

function stopApp() {
  if (!running) return;
  running.sync.stop();
  running.teardownPage?.();
  running.db.close();
  running = null;
}

async function boot() {
  if (!isSupabaseConfigured()) {
    app.innerHTML = `
      <main class="auth-wrap"><div class="auth-card">
        <h1>StudyBlitz</h1>
        <p class="auth-error">Supabase is not configured. Copy <code>.env.example</code>
        to <code>.env</code>, fill in your project values, and restart the dev server.</p>
      </div></main>`;
    return;
  }

  const client = createSupabaseClient();
  const session = createSession(client);

  // React to sign-in/sign-out for the life of the page.
  session.onChange((event, supaSession) => {
    if (event === 'SIGNED_IN' && supaSession && !running) {
      void startApp(client, session, supaSession);
    }
    if (event === 'SIGNED_OUT') {
      stopApp();
      renderAuthPage(app, { session });
    }
  });

  const existing = await session.current();
  if (existing) {
    await startApp(client, session, existing);
  } else {
    renderAuthPage(app, { session });
  }
}

void boot();
