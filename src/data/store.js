// store.js — one tiny subscribe/notify state store for the whole app.
// Pages subscribe, repositories/sync patch it, subscribers re-render.

export function createStore(initial = {}) {
  let state = { ...initial };
  const listeners = new Set();

  return {
    get() {
      return state;
    },
    patch(partial) {
      state = { ...state, ...partial };
      for (const fn of listeners) fn(state);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
