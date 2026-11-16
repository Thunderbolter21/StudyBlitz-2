// modal.js — one reusable modal. Returns a close() function.
// Esc and clicking the backdrop close it; focus moves into the box.

export function openModal({ title = '', body = '', onClose } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" ${title ? 'aria-label="' + title + '"' : ''}>
      ${title ? `<h2>${title}</h2>` : ''}
      <div class="modal-body"></div>
    </div>`;

  const bodyEl = overlay.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else bodyEl.appendChild(body); // accepts a pre-built element too

  function close() {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    onClose?.();
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);

  // Move focus to the first focusable thing inside the dialog.
  overlay.querySelector('button, input, select, textarea, [tabindex]')?.focus();

  return close;
}
