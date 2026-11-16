// HomePage.js — Phase 1 placeholder home screen.
// Shows the sync status chip and a TEMPORARY semesters debug panel so the
// data layer can be exercised end-to-end by hand (two browsers side by
// side = a real two-device test). Phase 2/3 replace this with the real UI.

export function renderHomePage(container, { repos, appStore, session, sync }) {
  let unsubStore = () => {};
  let unsubData = () => {};

  async function render() {
    const { syncStatus, pending, userEmail } = appStore.get();
    const semesters = await repos.semesters.list();

    container.innerHTML = `
      <main class="home-wrap">
        <header class="home-header">
          <h1>StudyBlitz</h1>
          <div class="home-header-right">
            <span class="sync-chip sync-${syncStatus}" title="Sync status">
              ${chipLabel(syncStatus, pending)}
            </span>
            <button class="btn-ghost" id="sign-out">Sign out</button>
          </div>
        </header>

        <p class="home-sub">Signed in as <strong>${userEmail}</strong></p>

        <!-- TEMPORARY Phase 1 debug panel — replaced by the real UI in Phase 3 -->
        <section class="debug-panel">
          <h2>Semesters <span class="debug-tag">debug</span></h2>
          <form id="sem-form" class="debug-row">
            <input id="sem-name" placeholder="e.g. Spring 2027" required />
            <button type="submit" class="btn-primary">Add</button>
          </form>
          <ul class="debug-list" id="sem-list">
            ${semesters.map((s) => `
              <li data-id="${s.id}">
                <span class="sem-name">${escapeHtml(s.name)}${s.archivedAt ? ' <em>(archived)</em>' : ''}</span>
                <span class="debug-actions">
                  <button data-act="rename">Rename</button>
                  <button data-act="archive">${s.archivedAt ? 'Unarchive' : 'Archive'}</button>
                  <button data-act="delete">Delete</button>
                </span>
              </li>`).join('')}
          </ul>
          <button class="btn-ghost" id="sync-now">Sync now</button>
        </section>
      </main>`;

    container.querySelector('#sign-out').onclick = () => session.signOut();
    container.querySelector('#sync-now').onclick = () =>
      sync.pullAll().then(() => sync.flush()).catch(() => {});

    container.querySelector('#sem-form').onsubmit = async (e) => {
      e.preventDefault();
      const name = container.querySelector('#sem-name').value.trim();
      if (name) await repos.semesters.create(name);
    };

    container.querySelector('#sem-list').onclick = async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const id = btn.closest('li').dataset.id;
      const act = btn.dataset.act;
      if (act === 'rename') {
        const name = prompt('New name?');
        if (name?.trim()) await repos.semesters.rename(id, name.trim());
      } else if (act === 'archive') {
        const sem = await repos.semesters.get(id);
        await repos.semesters.setArchived(id, !sem.archivedAt);
      } else if (act === 'delete') {
        if (confirm('Delete this semester (and everything in it)? This cannot be undone.')) {
          await repos.semesters.remove(id);
        }
      }
    };
  }

  function chipLabel(status, pending) {
    if (status === 'offline') return `⛅ Offline${pending ? ` · ${pending} pending` : ''}`;
    if (status === 'error') return `⚠ Sync error · ${pending ?? 0} pending`;
    if (status === 'syncing' || pending > 0) return '⟳ Syncing…';
    return '✓ Synced';
  }

  // Re-render when sync status changes or any data changes.
  unsubStore = appStore.subscribe(() => void render());
  unsubData = repos.events.subscribe(() => void render());
  void render();

  return () => {
    unsubStore();
    unsubData();
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
