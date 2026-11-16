// HomePage.js — Phase 1/2 placeholder home content (renders into the shell).
// Still carries the TEMPORARY semesters debug panel so the data layer can be
// exercised by hand (two browsers side by side = a real two-device test).
// Phase 3 replaces this with the real semester → class → deck home view.

export function renderHomePage(outlet, { repos, sync }) {
  async function render() {
    const semesters = await repos.semesters.list();

    outlet.innerHTML = `
      <div class="paper-sheet">
        <!-- TEMPORARY Phase 1 debug panel — replaced by the real UI in Phase 3 -->
        <section>
          <h2>Semesters <span class="debug-tag">debug</span></h2>
          <form id="sem-form" class="debug-row">
            <input id="sem-name" placeholder="e.g. Spring 2027" required aria-label="Semester name" />
            <button type="submit" class="btn-primary">Add</button>
          </form>
          <ul class="debug-list" id="sem-list">
            ${semesters.map((s) => `
              <li data-id="${s.id}">
                <span>${escapeHtml(s.name)}${s.archivedAt ? ' <em>(archived)</em>' : ''}</span>
                <span class="debug-actions">
                  <button data-act="rename">Rename</button>
                  <button data-act="archive">${s.archivedAt ? 'Unarchive' : 'Archive'}</button>
                  <button data-act="delete">Delete</button>
                </span>
              </li>`).join('')}
          </ul>
          <button class="btn-ghost" id="sync-now">Sync now</button>
        </section>
      </div>`;

    outlet.querySelector('#sync-now').onclick = () =>
      sync.pullAll().then(() => sync.flush()).catch(() => {});

    outlet.querySelector('#sem-form').onsubmit = async (e) => {
      e.preventDefault();
      const name = outlet.querySelector('#sem-name').value.trim();
      if (name) await repos.semesters.create(name);
    };

    outlet.querySelector('#sem-list').onclick = async (e) => {
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

  const unsub = repos.events.subscribe(() => void render());
  void render();
  return unsub;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
