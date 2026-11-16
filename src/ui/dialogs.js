// dialogs.js — small promise-based dialogs built on the modal.
// Each resolves with the user's answer, or null/false when dismissed.

import { openModal } from './modal.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Ask for one line of text. Resolves string (trimmed) or null.
export function promptModal({ title, label = 'Name', initial = '', submitLabel = 'Save' }) {
  return new Promise((resolve) => {
    const body = document.createElement('form');
    body.innerHTML = `
      <label for="dlg-input">${esc(label)}</label>
      <input id="dlg-input" type="text" value="${esc(initial)}" required
             style="margin-bottom:var(--space-4)" />
      <div style="display:flex;gap:var(--space-2);justify-content:flex-end">
        <button type="button" class="btn-ghost" data-cancel>Cancel</button>
        <button type="submit" class="btn-primary">${esc(submitLabel)}</button>
      </div>`;
    const close = openModal({ title, body, onClose: () => resolve(null) });
    const input = body.querySelector('#dlg-input');
    input.focus();
    input.select();
    body.querySelector('[data-cancel]').onclick = () => close();
    body.onsubmit = (e) => {
      e.preventDefault();
      const value = input.value.trim();
      if (!value) return;
      resolve(value);
      // Resolve BEFORE close so onClose's resolve(null) loses the race.
      close();
    };
  });
}

// Yes/no confirmation. Resolves true only on explicit confirm.
export function confirmModal({ title, bodyText, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    const body = document.createElement('div');
    body.innerHTML = `
      <p>${esc(bodyText)}</p>
      <div style="display:flex;gap:var(--space-2);justify-content:flex-end">
        <button type="button" class="btn-ghost" data-cancel>Cancel</button>
        <button type="button" class="${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmLabel)}</button>
      </div>`;
    const close = openModal({ title, body, onClose: () => resolve(false) });
    body.querySelector('[data-cancel]').onclick = () => close();
    body.querySelector('[data-ok]').onclick = () => {
      resolve(true);
      close();
    };
  });
}

// Pick one option from a list. options: [{ value, label, group? }].
// Resolves the chosen value or null.
export function selectModal({ title, label = 'Choose', options, submitLabel = 'Move' }) {
  return new Promise((resolve) => {
    const groups = new Map();
    for (const opt of options) {
      const g = opt.group ?? '';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(opt);
    }
    const optionsHtml = [...groups.entries()]
      .map(([group, opts]) => {
        const inner = opts
          .map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`)
          .join('');
        return group ? `<optgroup label="${esc(group)}">${inner}</optgroup>` : inner;
      })
      .join('');

    const body = document.createElement('form');
    body.innerHTML = `
      <label for="dlg-select">${esc(label)}</label>
      <select id="dlg-select" style="margin-bottom:var(--space-4)">${optionsHtml}</select>
      <div style="display:flex;gap:var(--space-2);justify-content:flex-end">
        <button type="button" class="btn-ghost" data-cancel>Cancel</button>
        <button type="submit" class="btn-primary">${esc(submitLabel)}</button>
      </div>`;
    const close = openModal({ title, body, onClose: () => resolve(null) });
    body.querySelector('[data-cancel]').onclick = () => close();
    body.onsubmit = (e) => {
      e.preventDefault();
      resolve(body.querySelector('#dlg-select').value);
      close();
    };
  });
}

const CLASS_COLORS = [
  'var(--class-1)', 'var(--class-2)', 'var(--class-3)', 'var(--class-4)',
  'var(--class-5)', 'var(--class-6)', 'var(--class-7)', 'var(--class-8)',
];

// Create/edit a class: name + color swatches. Resolves {name, color} or null.
export function classFormModal({ title, name = '', color = CLASS_COLORS[1], submitLabel = 'Save' }) {
  return new Promise((resolve) => {
    let picked = color;
    const body = document.createElement('form');
    body.innerHTML = `
      <label for="dlg-cname">Class name</label>
      <input id="dlg-cname" type="text" value="${esc(name)}" required
             placeholder="e.g. Accounting 210" style="margin-bottom:var(--space-3)" />
      <label>Color</label>
      <div class="swatch-row" role="radiogroup" aria-label="Class color">
        ${CLASS_COLORS.map((c) => `
          <button type="button" class="swatch${c === picked ? ' picked' : ''}"
                  data-color="${c}" role="radio" aria-checked="${c === picked}"
                  style="--swatch:${c}" aria-label="Color"></button>`).join('')}
      </div>
      <div style="display:flex;gap:var(--space-2);justify-content:flex-end;margin-top:var(--space-4)">
        <button type="button" class="btn-ghost" data-cancel>Cancel</button>
        <button type="submit" class="btn-primary">${esc(submitLabel)}</button>
      </div>`;
    const close = openModal({ title, body, onClose: () => resolve(null) });
    const input = body.querySelector('#dlg-cname');
    input.focus();
    input.select();
    body.querySelector('.swatch-row').onclick = (e) => {
      const sw = e.target.closest('.swatch');
      if (!sw) return;
      picked = sw.dataset.color;
      for (const el of body.querySelectorAll('.swatch')) {
        el.classList.toggle('picked', el === sw);
        el.setAttribute('aria-checked', String(el === sw));
      }
    };
    body.querySelector('[data-cancel]').onclick = () => close();
    body.onsubmit = (e) => {
      e.preventDefault();
      const value = input.value.trim();
      if (!value) return;
      resolve({ name: value, color: picked });
      close();
    };
  });
}
