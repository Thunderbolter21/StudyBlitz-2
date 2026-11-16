// RegenModal.js — regenerate a deck from its STORED source files
// (ported from v1's openRegenerateModal / triggerRegeneration).
// Downloads the originals from Storage, decompresses, re-calls Claude with
// optionally tweaked instructions, then Replaces the deck or Saves as New.
// With no stored sources it falls back to topics + sample questions (v1).

import { GENERATION_MODEL_DEFAULT } from '../config.js';
import { buildPromptText, generateQuestions } from '../ai/generation.js';
import { normalizeQuestions, shuffleAnswerPositions } from '../ai/json-repair.js';
import { extractDocxText, extractPptxText } from '../ai/extract-files.js';
import { base64ToBytes, formatBytes } from '../engine/compress.js';
import { openModal } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function openRegenerateModal({ deck, repos, sources }) {
  const sourceRows = await repos.sourceFiles.listByDeck(deck.id);
  const questions = await repos.questions.listByDeck(deck.id);

  const icon = (k) => ({ pdf: '📄', image: '🖼️', docx: '📝', pptx: '📝', url: '🔗' }[k] || '📎');
  const sourceListHtml = sourceRows.length
    ? sourceRows.map((s) => `
        <div class="file-row">
          <span>${icon(s.kind)}</span>
          <span class="file-name">${esc(s.name)}</span>
          <span class="file-size">${s.kind === 'url' ? '' : formatBytes(s.sizeBytes || 0)}${
            s.kind !== 'url' && !s.storagePath ? ' · ⚠ not stored' : ''}</span>
        </div>`).join('')
    : `<p class="auth-sub">No stored source files — regeneration will use the existing
       questions' topics as context instead.</p>`;

  const body = document.createElement('div');
  body.innerHTML = `
    ${sourceListHtml}
    <label for="rg-instructions" style="margin-top:var(--space-3)">Instructions (edit to steer it)</label>
    <textarea id="rg-instructions" rows="3"
      placeholder="e.g. Focus on application questions…">${esc(deck.generationInstructions || '')}</textarea>
    <label for="rg-count" style="margin-top:var(--space-3)">Questions</label>
    <input id="rg-count" type="number" min="5" max="50" step="5"
           value="${Math.min(20, questions.length || 20)}" style="width:6rem;text-align:center" />
    <p id="rg-status" class="gen-status" role="status"></p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);margin-top:var(--space-3)">
      <button class="btn-danger" data-replace>🔄 Replace deck</button>
      <button class="btn-primary" data-new>✨ Save as new</button>
    </div>`;

  const close = openModal({ title: `Regenerate — ${deck.name}`, body });
  const statusEl = body.querySelector('#rg-status');
  const setStatus = (msg, isError = false) => {
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', isError);
  };

  async function run(mode) {
    const settings = await repos.settings.get();
    if (!settings.anthropicApiKey) return setStatus('No API key — add one in the Quiz Builder first.', true);

    const instructions = body.querySelector('#rg-instructions').value.trim();
    const count = Math.max(5, Math.min(50, parseInt(body.querySelector('#rg-count').value, 10) || 20));
    for (const btn of body.querySelectorAll('button, input, textarea')) btn.disabled = true;

    try {
      // Rebuild content parts from stored sources.
      const parts = [];
      const urls = [];
      let extractedText = '';
      for (const [i, src] of sourceRows.entries()) {
        if (src.kind === 'url') { urls.push(src.sourceUrl); continue; }
        if (!src.storagePath) continue;
        setStatus(`Downloading source ${i + 1} of ${sourceRows.length}…`);
        const data = await sources.loadData(src);
        if (!data) continue;
        if (src.kind === 'pdf') {
          parts.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
        } else if (src.kind === 'image') {
          parts.push({ type: 'image', source: { type: 'base64', media_type: src.mediaType || 'image/jpeg', data } });
        } else {
          const buffer = base64ToBytes(data).buffer;
          const text = src.kind === 'docx' ? await extractDocxText(buffer) : await extractPptxText(buffer);
          if (text) extractedText += `\n\n[From ${src.name}]\n${text}`;
        }
      }

      // Fallback context when nothing usable was stored (v1 behavior).
      let notesText = (deck.generationNotes || '') + extractedText;
      if (parts.length === 0 && !notesText.trim() && urls.length === 0) {
        const topics = [...new Set(questions.map((q) => q.cat).filter(Boolean))];
        const samples = questions.slice(0, 10).map((q) => `- ${q.q}`).join('\n');
        notesText =
          `This deck previously covered: ${topics.join(', ') || '(uncategorised)'}.\n\n` +
          `Sample existing questions — generate DIFFERENT questions covering similar ground:\n${samples}`;
      }

      parts.push({
        type: 'text',
        text: buildPromptText({ deckName: deck.name, count, instructions, notesText, urls }),
      });

      setStatus('Calling Claude…');
      const raw = await generateQuestions({
        apiKey: settings.anthropicApiKey,
        model: settings.model || GENERATION_MODEL_DEFAULT,
        contentParts: parts,
        hasUrls: urls.length > 0,
        onStatus: setStatus,
      });
      const valid = normalizeQuestions(raw).map((q) => shuffleAnswerPositions(q));
      if (!valid.length) throw new Error('No valid questions came back');

      if (mode === 'replace') {
        await repos.questions.replaceForDeck(deck.id, valid);
        await repos.decks.update(deck.id, {
          generationInstructions: instructions,
          generationCount: (deck.generationCount || 1) + 1,
          lastScore: null,
        });
        showToast(`✓ "${deck.name}" regenerated — ${valid.length} new questions`);
      } else {
        const version = (deck.generationCount || 1) + 1;
        const newDeck = await repos.decks.create({
          classId: deck.classId,
          name: `${deck.name} (v${version})`,
          generationInstructions: instructions,
          generationNotes: deck.generationNotes || '',
          generationCount: 1,
        });
        await repos.questions.createMany(newDeck.id, valid);
        // Share the stored source objects: copy the metadata rows so the new
        // deck can regenerate too. (Storage objects are never deleted on
        // deck delete in v2, so sharing paths is safe; Phase 6 adds GC.)
        for (const src of sourceRows) {
          await repos.sourceFiles.create({
            deckId: newDeck.id, name: src.name, kind: src.kind,
            mediaType: src.mediaType, sizeBytes: src.sizeBytes,
            originalSize: src.originalSize, storagePath: src.storagePath,
            sourceUrl: src.sourceUrl,
          });
        }
        showToast(`✨ "${newDeck.name}" created — ${valid.length} questions`);
      }
      close();
    } catch (err) {
      setStatus('❌ ' + err.message, true);
      for (const btn of body.querySelectorAll('button, input, textarea')) btn.disabled = false;
    }
  }

  body.querySelector('[data-replace]').onclick = () => run('replace');
  body.querySelector('[data-new]').onclick = () => run('new');
}
