// SettingsPage.js — #settings. Account (email/password/sign out),
// generation (API key + model), and data backup (export/import).
// Everything here is self-contained; it only calls session + repositories.

import { GENERATION_MODEL_DEFAULT } from '../config.js';
import { showToast } from '../ui/toast.js';
import { confirmModal } from '../ui/dialogs.js';
import { downloadJson, pickJsonFile, backupFilename } from '../ui/file-io.js';
import { openModal } from '../ui/modal.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MODELS = [
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — balanced (recommended)' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 — most capable, pricier' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — fastest, cheapest' },
];

export function renderSettingsPage(outlet, { repos, session }) {
  async function render() {
    const settings = await repos.settings.get();
    const user = await session.currentUser();
    const key = settings.anthropicApiKey || '';
    const maskedKey = key ? 'sk-ant-' + '•'.repeat(14) + key.slice(-4) : null;
    const model = settings.model || GENERATION_MODEL_DEFAULT;

    outlet.innerHTML = `
      <div class="paper-sheet">
        <h2>Settings</h2>

        <section class="settings-section">
          <h3>Account</h3>
          <p class="auth-sub">Signed in as <strong>${esc(user?.email || '—')}</strong></p>

          <label for="set-email">Change email</label>
          <div class="debug-row" style="margin-top:0">
            <input id="set-email" type="email" placeholder="new@email.com" />
            <button class="btn-ghost" id="set-email-btn">Update</button>
          </div>
          <p class="auth-sub">You'll get a confirmation link at the new address.</p>

          <label for="set-pw" style="margin-top:var(--space-3)">Change password</label>
          <div class="debug-row" style="margin-top:0">
            <input id="set-pw" type="password" placeholder="New password (min 6)" minlength="6" autocomplete="new-password" />
            <button class="btn-ghost" id="set-pw-btn">Update</button>
          </div>

          <button class="btn-ghost" id="set-signout" style="margin-top:var(--space-3)">Sign out</button>
        </section>

        <section class="settings-section">
          <h3>Quiz generation</h3>
          <label for="set-key">Claude API key</label>
          ${maskedKey ? `<p class="auth-sub">Current: <code>${maskedKey}</code></p>` : ''}
          <div class="debug-row" style="margin-top:0">
            <input id="set-key" type="password" autocomplete="off"
                   placeholder="${maskedKey ? 'Paste a new key to replace' : 'sk-ant-…'}" />
            <button class="btn-primary" id="set-key-save">Save</button>
            ${key ? `<button class="btn-danger" id="set-key-remove">Remove</button>` : ''}
          </div>
          <div class="sticky-note" style="margin-top:var(--space-3)">
            🔒 Your key is stored in your account so it works on every device.
            Only you can read it (Row Level Security). It never goes in a backup file.
          </div>

          <label for="set-model" style="margin-top:var(--space-4)">Generation model</label>
          <select id="set-model">
            ${MODELS.map((m) => `<option value="${m.id}" ${m.id === model ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
          </select>
        </section>

        <section class="settings-section">
          <h3>Data backup</h3>
          <p class="auth-sub">A safety copy of your semesters, classes, decks, questions,
          memory, and presets — as a plain JSON file. (Your API key is never included.)</p>
          <div class="debug-row" style="margin-top:0">
            <button class="btn-ghost" id="set-export">⬇️ Export backup</button>
            <button class="btn-ghost" id="set-import">⬆️ Import backup</button>
          </div>
        </section>
      </div>`;

    wire();
  }

  const g = (id) => outlet.querySelector('#' + id);

  function wire() {
    g('set-email-btn').onclick = async () => {
      const email = g('set-email').value.trim();
      if (!email.includes('@')) return showToast('Enter a valid email');
      const err = await session.changeEmail(email);
      showToast(err || '✓ Confirmation link sent to the new address');
      if (!err) g('set-email').value = '';
    };

    g('set-pw-btn').onclick = async () => {
      const pw = g('set-pw').value;
      if (pw.length < 6) return showToast('Password must be at least 6 characters');
      const err = await session.changePassword(pw);
      showToast(err || '✓ Password updated');
      if (!err) g('set-pw').value = '';
    };

    g('set-signout').onclick = () => session.signOut();

    g('set-key-save').onclick = async () => {
      const k = g('set-key').value.trim();
      if (!k) return showToast('Paste your key first');
      await repos.settings.save({ anthropicApiKey: k });
      showToast('✓ API key saved to your account');
      void render();
    };
    g('set-key-remove')?.addEventListener('click', async () => {
      await repos.settings.save({ anthropicApiKey: null });
      showToast('API key removed');
      void render();
    });

    g('set-model').onchange = async () => {
      await repos.settings.save({ model: g('set-model').value });
      showToast('✓ Model updated');
    };

    g('set-export').onclick = async () => {
      const file = await repos.backup.export();
      downloadJson(file, backupFilename());
      const c = repos.backup.counts(file);
      showToast(`💾 Exported ${c.decks} deck${c.decks === 1 ? '' : 's'}, ${c.questions} questions`);
    };

    g('set-import').onclick = async () => {
      let file;
      try { file = await pickJsonFile(); } catch (e) { return showToast(e.message); }
      const problem = repos.backup.validate(file);
      if (problem) return showToast(problem);
      openImportModal(file);
    };
  }

  function openImportModal(file) {
    const c = repos.backup.counts(file);
    const body = document.createElement('div');
    body.innerHTML = `
      <p>This backup contains
        <strong>${c.decks} deck${c.decks === 1 ? '' : 's'}</strong>,
        <strong>${c.classes} class${c.classes === 1 ? '' : 'es'}</strong>, and
        <strong>${c.questions} questions</strong>${file.exportedAt
          ? `,<br>exported ${new Date(file.exportedAt).toLocaleString()}` : ''}.</p>
      <p class="auth-sub">How should it come in?</p>
      <div style="display:flex;flex-direction:column;gap:var(--space-2)">
        <button class="btn-primary" data-merge>Merge — keep what I have, add from backup</button>
        <button class="btn-danger" data-replace>Replace — wipe current data, use backup</button>
        <button class="btn-ghost" data-cancel>Cancel</button>
      </div>`;
    const close = openModal({ title: 'Import backup', body });
    body.querySelector('[data-cancel]').onclick = () => close();
    body.querySelector('[data-merge]').onclick = async () => {
      close();
      const c2 = await repos.backup.import(file, 'merge');
      showToast(`✅ Merged in ${c2.decks} deck${c2.decks === 1 ? '' : 's'}, ${c2.questions} questions`);
    };
    body.querySelector('[data-replace]').onclick = async () => {
      const ok = await confirmModal({
        title: 'Replace all data?',
        bodyText: 'This removes the decks, classes, and progress currently in your account and replaces them with the backup, on every device.',
        confirmLabel: 'Replace everything',
      });
      if (!ok) return;
      close();
      const c2 = await repos.backup.import(file, 'replace');
      showToast(`✅ Restored ${c2.decks} deck${c2.decks === 1 ? '' : 's'}, ${c2.questions} questions`);
    };
  }

  void render();
  return () => {};
}
