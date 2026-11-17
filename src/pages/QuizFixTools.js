// QuizFixTools.js — "Fix answer" and "Edit question" from the feedback
// area, ported from v1 (quiz.js :1474–1770). Both write through the
// repositories and reset the question's memory the way v1 did:
//   fix MC answer     → fresh record credited with one correct (v1 :1615)
//   fix FR/MS answers → record deleted entirely (v1 :1642, :1664)
//   edit phrasing     → record deleted entirely (v1 :1743)
//
// The session question has SHUFFLED options, so corrections are mapped
// back to the stored row by option TEXT (v1 :1596–1608).

import { openModal } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import { emptyRecord, updateRecord } from '../engine/sm2.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// `liveQ` is the session's (shuffled) question; records is the session map.
export function openFixAnswer({ liveQ, repos, records, onFixed }) {
  const letters = ['A', 'B', 'C', 'D'];
  const body = document.createElement('form');

  if (liveQ.type === 'free-response') {
    body.innerHTML = `
      <label for="fix-fr">Accepted answers (comma-separated)</label>
      <input id="fix-fr" type="text" value="${esc((liveQ.ans || []).join(', '))}" />
      ${buttons('Save answers')}`;
  } else if (liveQ.type === 'multi-select') {
    body.innerHTML = `
      <p class="auth-sub">Select every correct answer:</p>
      ${liveQ.opts.map((o, i) => `
        <label class="check"><input type="checkbox" data-idx="${i}"
          ${liveQ.ans.includes(i) ? 'checked' : ''} /><span class="box">✓</span> ${letters[i]}) ${esc(o)}</label>`).join('')}
      ${buttons('Save')}`;
  } else {
    body.innerHTML = `
      <p class="auth-sub">Pick the correct answer:</p>
      ${liveQ.opts.map((o, i) => `
        <button type="button" class="btn-ghost" data-pick="${i}"
          style="width:100%;justify-content:flex-start;margin-bottom:var(--space-1);
                 ${i === liveQ.ans ? 'color:var(--pen-green);border-color:var(--pen-green)' : ''}">
          ${letters[i]}) ${esc(o)}${i === liveQ.ans ? ' ✓ (current)' : ''}
        </button>`).join('')}
      <div style="display:flex;justify-content:flex-end">
        <button type="button" class="btn-ghost" data-cancel>Cancel</button>
      </div>`;
  }

  const close = openModal({ title: '✏️ Fix answer', body });
  body.querySelector('[data-cancel]')?.addEventListener('click', () => close());

  async function applyToStored(mutate) {
    const stored = await repos.questions.get(liveQ.id);
    if (!stored) return showToast('Question not found');
    await repos.questions.update(liveQ.id, mutate(stored));
  }

  if (liveQ.type === 'mc') {
    body.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-pick]');
      if (!btn) return;
      const newAns = Number(btn.dataset.pick);
      if (newAns === liveQ.ans) { showToast('That is already the correct answer'); close(); return; }
      const correctText = liveQ.opts[newAns];
      await applyToStored((stored) => {
        const storageIdx = (stored.opts || []).indexOf(correctText);
        return { ans: storageIdx >= 0 ? storageIdx : newAns };
      });
      liveQ.ans = newAns;
      // v1: fresh record credited with one correct (:1615–1617).
      const fresh = updateRecord(emptyRecord(), true, null, Date.now());
      records.set(liveQ.id, fresh);
      await repos.cardMemory.saveForQuestion(liveQ.id, fresh);
      showToast('Answer updated!');
      close();
      onFixed?.();
    });
  } else {
    body.onsubmit = async (e) => {
      e.preventDefault();
      if (liveQ.type === 'free-response') {
        const variants = body.querySelector('#fix-fr').value
          .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
        if (!variants.length) return showToast('Enter at least one accepted answer');
        await applyToStored(() => ({ ans: variants }));
        liveQ.ans = variants;
      } else {
        const picked = [...body.querySelectorAll('input[type=checkbox]')]
          .filter((c) => c.checked).map((c) => Number(c.dataset.idx));
        if (!picked.length) return showToast('Select at least one correct answer');
        await applyToStored((stored) => ({
          // Map live (shuffled) indices → storage indices by text (v1 :1653).
          ans: picked.map((i) => {
            const idx = (stored.opts || []).indexOf(liveQ.opts[i]);
            return idx >= 0 ? idx : i;
          }),
        }));
        liveQ.ans = picked;
      }
      // v1: FR/MS fixes wipe the memory record (:1642, :1664).
      await resetMemory(liveQ.id, repos, records);
      showToast('✓ Answers updated');
      close();
      onFixed?.();
    };
  }
}

export function openEditQuestion({ liveQ, repos, records, onSaved }) {
  const body = document.createElement('form');
  body.innerHTML = `
    <label for="fix-text">Question text</label>
    <textarea id="fix-text" rows="4">${esc(liveQ.q)}</textarea>
    <div style="display:flex;gap:var(--space-2);justify-content:flex-end;margin-top:var(--space-3)">
      <button type="button" class="btn-ghost" data-cancel>Cancel</button>
      <button type="submit" class="btn-primary">Save changes</button>
    </div>`;
  const close = openModal({ title: '✏️ Edit question', body });
  body.querySelector('[data-cancel]').onclick = () => close();
  body.onsubmit = async (e) => {
    e.preventDefault();
    const text = body.querySelector('#fix-text').value.trim();
    if (!text || text === liveQ.q) { close(); return; }
    await repos.questions.update(liveQ.id, { q: text });
    liveQ.q = text;
    // Fresh start since the question changed (v1 :1741–1744).
    await resetMemory(liveQ.id, repos, records);
    showToast('✓ Question updated');
    close();
    onSaved?.();
  };
}

async function resetMemory(questionId, repos, records) {
  records.delete(questionId);
  await repos.cardMemory.saveForQuestion(questionId, emptyRecord());
}

function buttons(submitLabel) {
  return `
    <div style="display:flex;gap:var(--space-2);justify-content:flex-end;margin-top:var(--space-3)">
      <button type="button" class="btn-ghost" data-cancel>Cancel</button>
      <button type="submit" class="btn-primary">${submitLabel}</button>
    </div>`;
}
