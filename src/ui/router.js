// router.js — tiny hash router with deep-link support.
// A route handler is (outlet, params) → optional teardown function.
// Deep links like #review?deck=ID arrive as URLSearchParams.

export function startRouter({ routes, outlet, onNavigate }) {
  let teardown = null;

  function apply() {
    const [route, queryString] = location.hash.slice(1).split('?');
    const handler = routes[route] ?? routes[''];
    try { teardown?.(); } catch { /* tolerate a bad teardown */ }
    try {
      teardown = handler(outlet, new URLSearchParams(queryString || '')) || null;
    } catch (err) {
      // A page that throws must not blank the app — show a recoverable sheet.
      console.error('[router] page error:', err);
      teardown = null;
      outlet.innerHTML = `
        <div class="paper-sheet">
          <div class="empty-state">
            <h3>Something went wrong on this screen</h3>
            <p class="hand">it's not your notes — it's us ✏️</p>
            <button class="btn-primary" onclick="location.reload()">Reload</button>
          </div>
        </div>`;
    }
    onNavigate?.(route || '');
  }

  window.addEventListener('hashchange', apply);
  apply();

  return () => {
    window.removeEventListener('hashchange', apply);
    teardown?.();
    teardown = null;
  };
}

export function navigate(route) {
  location.hash = route;
}
