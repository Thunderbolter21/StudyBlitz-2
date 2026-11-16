// StyleGuidePage.js — every design-system piece on one page (#styleguide).
// This is the component reference for all later phases: if a component
// isn't shown here, it doesn't exist yet.

import { showToast } from '../ui/toast.js';
import { openModal } from '../ui/modal.js';
import { EMPTY_PENCIL } from '../ui/decorations.js';

const COLOR_TOKENS = [
  'paper', 'paper-shade', 'rule-line', 'margin-red', 'desk',
  'ink', 'ink-soft', 'graphite', 'pen-red', 'pen-green', 'pen-blue',
  'class-1', 'class-2', 'class-3', 'class-4', 'class-5', 'class-6', 'class-7', 'class-8',
];

export function renderStyleGuidePage(outlet) {
  outlet.innerHTML = `
    <div class="paper-sheet">
      <h2>Style Guide</h2>
      <p class="auth-sub">Every component in the system. Tokens live in <code>src/styles/tokens.css</code>;
      contrast is enforced by <code>npm test</code>.</p>

      <section class="sg-section">
        <h3>Color tokens</h3>
        <div class="sg-grid">
          ${COLOR_TOKENS.map((t) => `
            <div class="sg-swatch">
              <div class="color" style="background:var(--${t})"></div>
              <div class="meta">--${t}</div>
            </div>`).join('')}
        </div>
      </section>

      <section class="sg-section">
        <h3>Type</h3>
        <p style="font-family:var(--font-serif);font-size:var(--text-xl)">Lora — headings &amp; question text</p>
        <p style="font-family:var(--font-sans)">Inter — interface text, labels, buttons</p>
        <p class="hand">Caveat — sparse handwritten annotations ✎</p>
        <p>Highlighter marks: <span class="hl">key term</span>,
           <span class="hl green">correct idea</span>,
           <span class="hl pink">watch out</span>.</p>
      </section>

      <section class="sg-section">
        <h3>Buttons</h3>
        <div class="sg-row">
          <button class="btn-primary">Primary — ink pen</button>
          <button class="btn-ghost">Ghost — pencil outline</button>
          <button class="btn-danger">Danger — red pen</button>
          <button class="btn-link">Link button</button>
          <button class="btn-primary" disabled>Disabled</button>
        </div>
      </section>

      <section class="sg-section">
        <h3>Forms</h3>
        <div style="max-width:22rem;display:flex;flex-direction:column;gap:var(--space-3)">
          <div><label for="sg-in">Text input</label><input id="sg-in" type="text" placeholder="Write on the line…" /></div>
          <div><label for="sg-sel">Select</label>
            <select id="sg-sel"><option>Standard</option><option>Exam mode</option><option>Time challenge</option></select>
          </div>
          <div><label for="sg-ta">Textarea</label><textarea id="sg-ta" rows="3" placeholder="Paste your notes…"></textarea></div>
          <label class="check"><input type="checkbox" checked /><span class="box">✓</span> Pen-check checkbox</label>
        </div>
      </section>

      <section class="sg-section">
        <h3>Index cards (decks)</h3>
        <div class="sg-row">
          ${[['ACC 210 — Ch. 4', 'class-2', '32 questions · 12 mastered'],
             ['MKT 300 — Exam 2', 'class-4', '48 questions · 3 weak'],
             ['MATH 125 — Limits', 'class-6', '20 questions · new']]
            .map(([name, color, meta]) => `
              <div class="index-card lift" style="--card-color:var(--${color});width:15rem">
                <div class="index-card-topline"></div>
                <strong style="font-family:var(--font-serif)">${name}</strong>
                <div style="font-size:var(--text-xs);color:var(--ink-soft);margin-top:var(--space-3)">${meta}</div>
              </div>`).join('')}
        </div>
      </section>

      <section class="sg-section">
        <h3>Folder tabs (semester switcher)</h3>
        <div class="tab-strip" id="sg-tabs">
          <button class="folder-tab active">Fall 2026</button>
          <button class="folder-tab">Spring 2027</button>
          <button class="folder-tab">+ New semester</button>
        </div>
        <div class="paper-sheet" style="border-top-left-radius:0;box-shadow:var(--shadow-card)">
          The active tab connects to its sheet of paper.
        </div>
      </section>

      <section class="sg-section">
        <h3>Chips, tags &amp; sync states</h3>
        <div class="sg-row">
          <span class="chip"><span class="dot" style="--chip-color:var(--class-2)"></span> ACC 210 · 4 due</span>
          <span class="class-tag" style="--tag-color:var(--class-5)">MKT 300</span>
          <span class="sync-chip sync-synced">✓ Synced</span>
          <span class="sync-chip sync-syncing">⟳ Syncing…</span>
          <span class="sync-chip sync-offline">⛅ Offline · 3 pending</span>
          <span class="sync-chip sync-error">⚠ Sync error · 2 pending</span>
        </div>
      </section>

      <section class="sg-section">
        <h3>Progress</h3>
        <div class="pencil-progress" style="max-width:20rem"><div class="fill" style="width:62%"></div></div>
      </section>

      <section class="sg-section">
        <h3>Toast &amp; modal</h3>
        <div class="sg-row">
          <button class="btn-ghost" id="sg-toast">Show toast</button>
          <button class="btn-ghost" id="sg-modal">Open modal</button>
        </div>
      </section>

      <section class="sg-section">
        <h3>Sticky note</h3>
        <div class="sticky-note">
          <span class="hand">Reminder:</span> your API key is stored in your account
          so it works on every device.
        </div>
      </section>

      <section class="sg-section">
        <h3>Ruled paper</h3>
        <div class="paper-sheet ruled">
          <div class="ruled-content">
            <p>Question text sits on ruled paper with a red margin line,
            like the notebook it came from.</p>
            <p class="hand" style="color:var(--pen-red)">— graded in red pen</p>
          </div>
        </div>
      </section>

      <section class="sg-section">
        <h3>Empty state</h3>
        <div class="empty-state">
          ${EMPTY_PENCIL}
          <h3>No decks yet</h3>
          <p class="hand">drop some notes in and let's make one ✏️</p>
          <button class="btn-primary">Build your first deck</button>
        </div>
      </section>
    </div>`;

  outlet.querySelector('#sg-toast').onclick = () => showToast('✓ Saved to your library');
  outlet.querySelector('#sg-modal').onclick = () => {
    const close = openModal({
      title: 'Assign to a class',
      body: `<p>Modals are plain paper sheets over a dimmed desk.</p>
             <button class="btn-primary" id="sg-modal-close">Done</button>`,
    });
    document.getElementById('sg-modal-close').onclick = close;
  };
  outlet.querySelector('#sg-tabs').onclick = (e) => {
    const tab = e.target.closest('.folder-tab');
    if (!tab) return;
    outlet.querySelectorAll('#sg-tabs .folder-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
  };
}
