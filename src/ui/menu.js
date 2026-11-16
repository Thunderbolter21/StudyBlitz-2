// menu.js — a small "⋯" popover menu anchored to a button.
// Closes on outside click, Esc, or choosing an item.

export function openMenu(anchor, items) {
  document.getElementById('popover-menu')?.remove();

  const menu = document.createElement('div');
  menu.id = 'popover-menu';
  menu.className = 'menu-pop';
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.className = 'menu-item' + (item.danger ? ' danger' : '');
    btn.textContent = item.label;
    btn.onclick = () => {
      destroy();
      item.onClick();
    };
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);

  // Position under the anchor, kept inside the viewport.
  const r = anchor.getBoundingClientRect();
  const menuWidth = menu.offsetWidth;
  menu.style.top = `${r.bottom + 4 + window.scrollY}px`;
  menu.style.left = `${Math.max(8, Math.min(r.right - menuWidth, window.innerWidth - menuWidth - 8)) + window.scrollX}px`;

  function onDocClick(e) {
    if (!menu.contains(e.target) && e.target !== anchor) destroy();
  }
  function onKey(e) {
    if (e.key === 'Escape') destroy();
  }
  function destroy() {
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onKey);
    menu.remove();
  }
  document.addEventListener('click', onDocClick, true);
  document.addEventListener('keydown', onKey);
  menu.querySelector('.menu-item')?.focus();
}
