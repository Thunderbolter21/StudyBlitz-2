// main.js — boot sequence.
// Decides between the auth screen and the app, and wires the data layer
// together (per-user IndexedDB → sync engine → repositories → shell → pages).

// Self-hosted fonts (no external requests; works offline).
// Latin subset only — the app is English; keeps the deploy lean.
import '@fontsource/lora/latin-400.css';
import '@fontsource/lora/latin-600.css';
import '@fontsource/lora/latin-700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/caveat/latin-600.css';

import './styles/tokens.css';
import './styles/global.css';
import './styles/surfaces.css';
import './styles/components.css';

import { isSupabaseConfigured } from './config.js';
import { createSupabaseClient } from './data/supabase.js';
import { createSession } from './data/session.js';
import { openDb } from './data/db.js';
import { createSync } from './data/sync.js';
import { createRepos } from './data/repositories.js';
import { createSourcesService } from './data/sources.js';
import { createStore } from './data/store.js';
import { renderShell } from './ui/shell.js';
import { startRouter } from './ui/router.js';
import { renderAuthPage } from './pages/AuthPage.js';
import { renderHomePage } from './pages/HomePage.js';
import { renderBuilderPage } from './pages/BuilderPage.js';
import { renderStyleGuidePage } from './pages/StyleGuidePage.js';

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
    // A pull brought changes from another device → re-render open pages.
    onApplied: () => repos.events.patch({ dataVersion: repos.events.get().dataVersion + 1 }),
  });

  const repos = createRepos({ db, sync, userId: user.id });
  const sources = createSourcesService({ client, userId: user.id, repos });

  // Cross-tab: tell sibling tabs when this tab writes, and re-render when
  // they do. The `remote` flag prevents an echo loop between tabs.
  const channel = 'BroadcastChannel' in globalThis ? new BroadcastChannel('sb2-data') : null;
  let applyingRemote = false;
  channel?.addEventListener('message', () => {
    applyingRemote = true;
    repos.events.patch({ dataVersion: repos.events.get().dataVersion + 1 });
    applyingRemote = false;
  });
  repos.events.subscribe(() => {
    if (!applyingRemote) channel?.postMessage('changed');
  });

  const shell = renderShell(app, {
    appStore,
    onSignOut: () => session.signOut(),
  });

  const stopRouter = startRouter({
    outlet: shell.outlet,
    routes: {
      '': (outlet) => renderHomePage(outlet, { repos, sync, appStore, sources }),
      'home': (outlet) => renderHomePage(outlet, { repos, sync, appStore, sources }),
      'builder': (outlet, params) => renderBuilderPage(outlet, { repos, sources, params }),
      'styleguide': (outlet) => renderStyleGuidePage(outlet),
    },
    onNavigate: (route) => shell.setActive(route || 'home'),
  });

  running = { db, sync, shell, stopRouter, channel };

  // Hydrate (first sign-in pulls everything BEFORE any push is allowed),
  // then start the heartbeat + flush-on-exit listeners.
  await sync.start();
}

function stopApp() {
  if (!running) return;
  running.stopRouter();
  running.sync.stop();
  running.shell.destroy();
  running.channel?.close();
  running.db.close();
  running = null;
}

async function boot() {
  if (!isSupabaseConfigured()) {
    app.innerHTML = `
      <main class="auth-wrap app-layer"><div class="auth-card paper-sheet">
        <h1 class="wordmark">Study<span class="accent">Blitz</span></h1>
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
  } else if (location.hash.startsWith('#styleguide')) {
    // The style guide is static — viewable without an account.
    const { mountDeskDecorations } = await import('./ui/decorations.js');
    mountDeskDecorations();
    app.innerHTML = `<div class="shell app-layer"><main id="sg-standalone"></main></div>`;
    renderStyleGuidePage(document.getElementById('sg-standalone'));
  } else {
    renderAuthPage(app, { session });
  }
}

void boot();
