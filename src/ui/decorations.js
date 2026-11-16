// decorations.js — the SVG pencil/eraser/paper-clip set that dresses the
// desk EDGES of non-quiz screens. Pure inline SVG (no images), aria-hidden,
// pointer-events none. Quiz screens never mount these — they stay calm.

const PENCIL = `
<svg class="decor-pencil" width="220" height="36" viewBox="0 0 220 36" aria-hidden="true">
  <rect x="28" y="10" width="160" height="16" rx="2" fill="#e8b23c"/>
  <rect x="28" y="10" width="160" height="5" rx="2" fill="#f3c968" opacity="0.9"/>
  <rect x="28" y="22" width="160" height="4" rx="2" fill="#b9871f" opacity="0.7"/>
  <polygon points="28,10 6,18 28,26" fill="#e9d9b8"/>
  <polygon points="12,15.8 6,18 12,20.2" fill="#3a3f4e"/>
  <rect x="188" y="10" width="10" height="16" fill="#9aa2b1"/>
  <rect x="198" y="10" width="16" height="16" rx="4" fill="#d98a94"/>
</svg>`;

const ERASER = `
<svg class="decor-eraser" width="92" height="44" viewBox="0 0 92 44" aria-hidden="true">
  <rect x="2" y="8" width="88" height="28" rx="6" fill="#d98a94"/>
  <rect x="2" y="8" width="36" height="28" rx="6" fill="#4a5fa5"/>
  <rect x="2" y="8" width="88" height="9" rx="6" fill="#ffffff" opacity="0.22"/>
</svg>`;

const PAPER_CLIP = `
<svg class="decor-clip" width="40" height="96" viewBox="0 0 40 96" aria-hidden="true">
  <path d="M20 8 a10 10 0 0 1 10 10 v56 a14 14 0 0 1 -28 0 V30 a7 7 0 0 1 14 0 v44"
        fill="none" stroke="#9aa2b1" stroke-width="5" stroke-linecap="round"/>
</svg>`;

// A small pencil drawing for empty states (sits inside paper, so it is
// deliberately quieter than the desk decorations).
export const EMPTY_PENCIL = `
<svg width="120" height="26" viewBox="0 0 120 26" aria-hidden="true">
  <rect x="18" y="7" width="84" height="12" rx="2" fill="#e8b23c"/>
  <polygon points="18,7 4,13 18,19" fill="#e9d9b8"/>
  <polygon points="8,11.5 4,13 8,14.5" fill="#3a3f4e"/>
  <rect x="102" y="7" width="6" height="12" fill="#9aa2b1"/>
  <rect x="108" y="7" width="9" height="12" rx="3" fill="#d98a94"/>
</svg>`;

// Mounts the decoration layer (idempotent — at most one on the page).
// Returns the element so a caller can remove it (e.g. quiz screens, which
// stay calm and undecorated).
export function mountDeskDecorations(parent = document.body) {
  const existing = document.getElementById('desk-decor');
  if (existing) return existing;
  const el = document.createElement('div');
  el.id = 'desk-decor';
  el.className = 'desk-decor';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = PENCIL + ERASER + PAPER_CLIP;
  parent.appendChild(el);
  return el;
}
