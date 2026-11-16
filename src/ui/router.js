// router.js — tiny hash router with deep-link support.
// A route handler is (outlet, params) → optional teardown function.
// Deep links like #review?deck=ID arrive as URLSearchParams.

export function startRouter({ routes, outlet, onNavigate }) {
  let teardown = null;

  function apply() {
    const [route, queryString] = location.hash.slice(1).split('?');
    const handler = routes[route] ?? routes[''];
    teardown?.();
    teardown = handler(outlet, new URLSearchParams(queryString || '')) || null;
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
