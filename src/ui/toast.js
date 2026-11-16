// toast.js — the one toast. Same behavior contract as v1's toast
// (reference-v1/src/main.js): slide up, hold ~2.8s, slide away.

let hideTimer = null;

export function showToast(message, duration = 2800) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status'); // announced politely by screen readers
    document.body.appendChild(el);
  }
  el.textContent = message;
  // Force a reflow so re-showing while visible still animates.
  el.classList.remove('show');
  void el.offsetHeight;
  el.classList.add('show');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => el.classList.remove('show'), duration);
}
