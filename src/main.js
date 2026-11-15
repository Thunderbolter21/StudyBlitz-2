// main.js — boot sequence.
// Phase 0: renders a scaffold screen that proves the toolchain and env
// handling work. Later phases replace this with the real router + pages.

import './styles/tokens.css';
import { isSupabaseConfigured } from './config.js';

function boot() {
  const app = document.getElementById('app');
  if (!app) return;

  const envOk = isSupabaseConfigured();

  // Phase 0 placeholder screen (replaced in Phase 1+).
  app.innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;
                 background:var(--desk);font-family:var(--font-sans);">
      <div style="background:var(--paper);color:var(--ink);padding:2rem 2.5rem;
                  border-radius:var(--radius-card);box-shadow:var(--shadow-card);
                  max-width:28rem;text-align:center;">
        <h1 style="font-family:var(--font-serif);margin:0 0 0.5rem;">StudyBlitz 2</h1>
        <p style="margin:0 0 1rem;color:var(--ink-soft);">Phase 0 scaffold</p>
        <p style="margin:0;font-size:0.9rem;">
          Supabase env vars: <strong>${envOk ? 'found ✓' : 'missing ✗'}</strong>
        </p>
        ${envOk ? '' : `<p style="font-size:0.8rem;color:var(--pen-red);">
          Copy .env.example to .env and fill in your project values.</p>`}
      </div>
    </main>`;
}

boot();
