// shell.js — the app chrome: paper header (wordmark, sync chip, sign out),
// folder-tab navigation, the main content outlet, and desk decorations.
// Pages render INTO shell.outlet; the shell itself renders once.

import { mountDeskDecorations } from './decorations.js';

const NAV_TABS = [
  { route: 'home', label: 'Home' },
  { route: 'styleguide', label: 'Style Guide' },
];

export function renderShell(container, { appStore, onSignOut }) {
  const decor = mountDeskDecorations(document.body);

  container.innerHTML = `
    <div class="shell app-layer">
      <header class="shell-header">
        <h1 class="wordmark">Study<span class="accent">Blitz</span></h1>
        <div class="shell-header-right">
          <span class="sync-chip" id="shell-sync" role="status"></span>
          <button class="btn-ghost" id="shell-signout">Sign out</button>
        </div>
      </header>

      <nav class="shell-nav" aria-label="Main">
        <div class="tab-strip" id="shell-tabs">
          ${NAV_TABS.map(
            (t) => `<button class="folder-tab" data-route="${t.route}">${t.label}</button>`
          ).join('')}
        </div>
      </nav>

      <main class="shell-main" id="shell-outlet"></main>
    </div>`;

  const outlet = container.querySelector('#shell-outlet');
  const syncChip = container.querySelector('#shell-sync');

  container.querySelector('#shell-signout').onclick = onSignOut;
  container.querySelector('#shell-tabs').onclick = (e) => {
    const tab = e.target.closest('[data-route]');
    if (tab) location.hash = tab.dataset.route;
  };

  function renderChip() {
    const { syncStatus, pending } = appStore.get();
    syncChip.className = `sync-chip sync-${syncStatus}`;
    syncChip.textContent =
      syncStatus === 'offline' ? `⛅ Offline${pending ? ` · ${pending} pending` : ''}`
      : syncStatus === 'error' ? `⚠ Sync error · ${pending ?? 0} pending`
      : syncStatus === 'syncing' || pending > 0 ? '⟳ Syncing…'
      : '✓ Synced';
  }
  const unsub = appStore.subscribe(renderChip);
  renderChip();

  function setActive(route) {
    for (const tab of container.querySelectorAll('.folder-tab')) {
      tab.classList.toggle('active', tab.dataset.route === route);
    }
  }

  return {
    outlet,
    setActive,
    destroy() {
      unsub();
      decor.remove();
      container.innerHTML = '';
    },
  };
}
