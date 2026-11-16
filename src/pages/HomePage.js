// HomePage.js — the current-semester home view.
// Folder tabs switch semesters; the sheet below shows that semester's
// classes, each holding its decks as index cards. All create/rename/
// archive/move/delete flows live here. Decks get their questions in
// Phase 4 (builder) and their quizzes in Phase 5.

import { promptModal, confirmModal, selectModal, classFormModal } from '../ui/dialogs.js';
import { openMenu } from '../ui/menu.js';
import { showToast } from '../ui/toast.js';
import { EMPTY_PENCIL } from '../ui/decorations.js';
import { openRegenerateModal } from './RegenModal.js';

export function renderHomePage(outlet, { repos, sync, appStore, sources }) {
  let renderToken = 0; // ignore stale async renders
  let sawHydrated = false;

  async function render() {
    const token = ++renderToken;

    const semesters = await repos.semesters.list();
    const settings = await repos.settings.get();
    const hydrated = await sync.isHydrated();
    sawHydrated = hydrated;
    if (token !== renderToken) return;

    if (semesters.length === 0) {
      // Before the first full pull finishes we can't know whether this
      // account is genuinely new — showing the "welcome" CTA too early
      // invites creating duplicates of data that's still downloading.
      if (!hydrated) {
        outlet.innerHTML = `
          <div class="paper-sheet">
            <div class="empty-state">
              <h3>Opening your notebook…</h3>
              <p class="hand">pulling your classes from the cloud ☁️</p>
            </div>
          </div>`;
        return;
      }
      renderFirstRun();
      return;
    }

    const active = semesters.filter((s) => !s.archivedAt);
    const archived = semesters.filter((s) => s.archivedAt);

    // Which semester is open? Last choice if it still exists, else first.
    const wanted = settings.preferences?.currentSemesterId;
    const current =
      semesters.find((s) => s.id === wanted) || active[0] || archived[0];

    const classes = (await repos.classes.listBySemester(current.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    const decksByClass = new Map();
    const countByDeck = new Map();
    for (const cls of classes) {
      const decks = (await repos.decks.listByClass(cls.id))
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      decksByClass.set(cls.id, decks);
      for (const deck of decks) {
        countByDeck.set(deck.id, (await repos.questions.listByDeck(deck.id)).length);
      }
    }
    if (token !== renderToken) return;

    outlet.innerHTML = `
      <div class="tab-strip" id="sem-tabs">
        ${active.map((s) => `
          <button class="folder-tab${s.id === current.id ? ' active' : ''}"
                  data-sem="${s.id}">${esc(s.name)}</button>`).join('')}
        ${archived.length ? `
          <button class="folder-tab${current.archivedAt ? ' active' : ''}" data-archived>
            Archived (${archived.length})</button>` : ''}
        <button class="folder-tab" data-new-sem title="New semester">+</button>
      </div>

      <div class="paper-sheet" style="border-top-left-radius:0">
        <div class="sem-header">
          <h2>${esc(current.name)}
            ${current.archivedAt ? '<span class="archived-badge">archived</span>' : ''}</h2>
          <button class="icon-btn" data-sem-menu aria-label="Semester options">⋯</button>
        </div>

        ${classes.length === 0 ? `
          <div class="empty-state">
            ${EMPTY_PENCIL}
            <h3>No classes in ${esc(current.name)} yet</h3>
            <p class="hand">one per subject — like folders ✏️</p>
            <button class="btn-primary" data-new-class>+ Add your first class</button>
          </div>`
        : `
          ${classes.map((cls) => {
            const decks = decksByClass.get(cls.id);
            return `
              <section class="class-section" style="--cls-color:${esc(cls.color)}">
                <div class="class-section-header">
                  <span class="class-dot"></span>
                  <h3>${esc(cls.name)}</h3>
                  <button class="btn-ghost" data-new-deck="${cls.id}"
                          style="min-height:36px;padding:2px var(--space-3);font-size:var(--text-sm)">+ Deck</button>
                  <button class="icon-btn" data-class-menu="${cls.id}" aria-label="Class options">⋯</button>
                </div>
                ${decks.length === 0
                  ? `<p class="class-empty">No decks yet — add one, then fill it from the
                     Quiz Builder <span class="hand">(coming in Phase 4)</span>.</p>`
                  : `<div class="deck-grid">
                      ${decks.map((d) => `
                        <div class="index-card lift deck-card" style="--card-color:${esc(cls.color)}">
                          <div class="index-card-topline"></div>
                          <button class="icon-btn" data-deck-menu="${d.id}" aria-label="Deck options">⋯</button>
                          <span class="deck-title">${esc(d.name)}</span>
                          <span class="deck-meta">
                            ${countByDeck.get(d.id)} question${countByDeck.get(d.id) === 1 ? '' : 's'}
                            · ${new Date(d.createdAt).toLocaleDateString()}
                          </span>
                        </div>`).join('')}
                    </div>`}
              </section>`;
          }).join('')}
          <button class="btn-ghost" data-new-class>+ New class</button>
        `}
      </div>`;

    wire(current, { active, archived, classes, decksByClass });
  }

  function renderFirstRun() {
    outlet.innerHTML = `
      <div class="paper-sheet">
        <div class="empty-state">
          ${EMPTY_PENCIL}
          <h3>Welcome to StudyBlitz</h3>
          <p class="hand">start with a semester — it holds your classes 📓</p>
          <button class="btn-primary" data-new-sem>+ Set up this semester</button>
        </div>
      </div>`;
    outlet.querySelector('[data-new-sem]').onclick = () => createSemester();
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  async function createSemester() {
    const name = await promptModal({
      title: 'New semester', label: 'Semester name',
      initial: suggestSemesterName(), submitLabel: 'Create',
    });
    if (!name) return;
    const sem = await repos.semesters.create(name);
    await repos.settings.patchPreferences({ currentSemesterId: sem.id });
  }

  function suggestSemesterName() {
    const now = new Date();
    const term = now.getMonth() >= 6 ? 'Fall' : 'Spring';
    return `${term} ${now.getFullYear()}`;
  }

  function semesterMenu(anchor, current) {
    openMenu(anchor, [
      { label: 'Rename', onClick: async () => {
          const name = await promptModal({ title: 'Rename semester', initial: current.name });
          if (name) await repos.semesters.rename(current.id, name);
        } },
      { label: current.archivedAt ? 'Unarchive' : 'Archive', onClick: async () => {
          await repos.semesters.setArchived(current.id, !current.archivedAt);
          showToast(current.archivedAt ? 'Semester restored to your tabs' : 'Semester moved to Archived');
        } },
      { label: 'Delete…', danger: true, onClick: async () => {
          const ok = await confirmModal({
            title: `Delete ${current.name}?`,
            bodyText: 'This permanently deletes the semester and every class, deck, and question inside it — on all your devices. There is no undo.',
          });
          if (!ok) return;
          await repos.semesters.remove(current.id);
          showToast('Semester deleted');
        } },
    ]);
  }

  function classMenu(anchor, cls, otherSemesters) {
    openMenu(anchor, [
      { label: 'Rename / recolor', onClick: async () => {
          const result = await classFormModal({
            title: 'Edit class', name: cls.name, color: cls.color,
          });
          if (!result) return;
          await repos.classes.rename(cls.id, result.name);
          await repos.classes.setColor(cls.id, result.color);
        } },
      ...(otherSemesters.length ? [{
        label: 'Move to another semester…', onClick: async () => {
          const semId = await selectModal({
            title: `Move ${cls.name}`, label: 'Semester',
            options: otherSemesters.map((s) => ({ value: s.id, label: s.name })),
          });
          if (semId) {
            await repos.classes.moveToSemester(cls.id, semId);
            showToast(`${cls.name} moved`);
          }
        } }] : []),
      { label: 'Delete…', danger: true, onClick: async () => {
          const ok = await confirmModal({
            title: `Delete ${cls.name}?`,
            bodyText: 'This permanently deletes the class and all of its decks and questions, on every device. There is no undo.',
          });
          if (ok) { await repos.classes.remove(cls.id); showToast('Class deleted'); }
        } },
    ]);
  }

  async function deckMenu(anchor, deck) {
    // Build the move-target list fresh: classes across all semesters.
    const semesters = await repos.semesters.list();
    const options = [];
    for (const s of semesters) {
      for (const c of await repos.classes.listBySemester(s.id)) {
        if (c.id !== deck.classId) options.push({ value: c.id, label: c.name, group: s.name });
      }
    }
    openMenu(anchor, [
      { label: 'Fill from Quiz Builder…', onClick: () => {
          location.hash = `builder?deck=${deck.id}`;
        } },
      { label: 'Regenerate…', onClick: () => {
          void openRegenerateModal({ deck, repos, sources });
        } },
      { label: 'Rename', onClick: async () => {
          const name = await promptModal({ title: 'Rename deck', initial: deck.name });
          if (name) await repos.decks.update(deck.id, { name });
        } },
      ...(options.length ? [{
        label: 'Move to another class…', onClick: async () => {
          const classId = await selectModal({
            title: `Move ${deck.name}`, label: 'Class', options,
          });
          if (classId) { await repos.decks.moveToClass(deck.id, classId); showToast('Deck moved'); }
        } }] : []),
      { label: 'Delete…', danger: true, onClick: async () => {
          const ok = await confirmModal({
            title: `Delete ${deck.name}?`,
            bodyText: 'This permanently deletes the deck and its questions on every device. There is no undo.',
          });
          if (ok) { await repos.decks.remove(deck.id); showToast('Deck deleted'); }
        } },
    ]);
  }

  // ── Event wiring for one rendered view ───────────────────────────────────
  function wire(current, { archived, classes, decksByClass }) {
    outlet.querySelector('#sem-tabs').onclick = async (e) => {
      const tab = e.target.closest('.folder-tab');
      if (!tab) return;
      if (tab.hasAttribute('data-new-sem')) return createSemester();
      if (tab.hasAttribute('data-archived')) {
        const semId = await selectModal({
          title: 'Archived semesters', label: 'Open',
          options: archived.map((s) => ({ value: s.id, label: s.name })),
          submitLabel: 'Open',
        });
        if (semId) await repos.settings.patchPreferences({ currentSemesterId: semId });
        return;
      }
      await repos.settings.patchPreferences({ currentSemesterId: tab.dataset.sem });
    };

    outlet.querySelector('[data-sem-menu]').onclick = (e) => {
      semesterMenu(e.currentTarget, current);
    };

    for (const btn of outlet.querySelectorAll('[data-new-class]')) {
      btn.onclick = async () => {
        const result = await classFormModal({ title: 'New class', submitLabel: 'Create' });
        if (result) {
          await repos.classes.create({ semesterId: current.id, ...result });
        }
      };
    }

    for (const btn of outlet.querySelectorAll('[data-new-deck]')) {
      btn.onclick = async () => {
        const name = await promptModal({
          title: 'New deck', label: 'Deck name',
          initial: '', submitLabel: 'Create',
        });
        if (name) {
          await repos.decks.create({ classId: btn.dataset.newDeck, name });
          showToast('Deck created — fill it from the Quiz Builder (Phase 4)');
        }
      };
    }

    for (const btn of outlet.querySelectorAll('[data-class-menu]')) {
      btn.onclick = async (e) => {
        // currentTarget is only valid during dispatch — capture before await.
        const anchor = e.currentTarget;
        const cls = classes.find((c) => c.id === btn.dataset.classMenu);
        const others = (await repos.semesters.list()).filter((s) => s.id !== current.id);
        classMenu(anchor, cls, others);
      };
    }

    for (const btn of outlet.querySelectorAll('[data-deck-menu]')) {
      btn.onclick = (e) => {
        for (const decks of decksByClass.values()) {
          const deck = decks.find((d) => d.id === btn.dataset.deckMenu);
          if (deck) return deckMenu(e.currentTarget, deck);
        }
      };
    }
  }

  const unsubData = repos.events.subscribe(() => void render());
  // Re-render on sync-status changes until hydration has been observed,
  // so the loading sheet resolves even when the account is truly empty
  // (an empty pull applies no rows and fires no data event).
  const unsubStore = appStore.subscribe(() => {
    if (!sawHydrated) void render();
  });
  void render();
  return () => {
    unsubData();
    unsubStore();
  };
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
