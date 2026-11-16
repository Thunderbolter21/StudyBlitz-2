// BuilderPage.js — the Quiz Builder (#builder, or #builder?deck=ID to fill
// an existing deck). Ported from v1's Generator with v2's data layer:
//
//   PRIMARY : direct API generation with the user's own key (synced via
//             user_settings under RLS).
//   FALLBACK: a collapsed "use claude.ai instead" section — copy the prompt,
//             paste the JSON back. Same validation pipeline either way.

import { GENERATION_MODEL_DEFAULT } from '../config.js';
import { buildPromptText, generateQuestions } from '../ai/generation.js';
import { extractAndRepairJSON, normalizeQuestions, shuffleAnswerPositions } from '../ai/json-repair.js';
import { BUILT_IN_PRESETS } from '../ai/presets.js';
import {
  classifyFile, readAsDataURL, compressImage, extractDocxText, extractPptxText,
  ACCEPTED_EXTENSIONS, MAX_FILES, MAX_FILE_BYTES,
} from '../ai/extract-files.js';
import { formatBytes } from '../engine/compress.js';
import { openModal } from '../ui/modal.js';
import { promptModal, confirmModal, selectModal } from '../ui/dialogs.js';
import { showToast } from '../ui/toast.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderBuilderPage(outlet, { repos, sources, params }) {
  // ── Page state ───────────────────────────────────────────────────────────
  const targetDeckId = params.get('deck'); // fill/replace an existing deck
  let attachedFiles = []; // { file, kind, dataUrl }
  let urls = [];
  let selectedPresetId = null;
  let generated = [];     // normalized questions ready to save
  let busy = false;

  async function render() {
    const settings = await repos.settings.get();
    const hasKey = Boolean(settings.anthropicApiKey);
    const userPresets = await repos.presets.list();
    const targetDeck = targetDeckId ? await repos.decks.get(targetDeckId) : null;

    outlet.innerHTML = `
      <div class="paper-sheet">
        <div class="sem-header">
          <h2>Quiz Builder</h2>
          <button class="chip key-chip ${hasKey ? 'key-ok' : 'key-missing'}" id="key-chip">
            ${hasKey ? '🔑 Key connected' : '🔑 Add API key'}
          </button>
        </div>

        ${targetDeck ? `
          <p class="target-banner">Filling deck: <strong>${esc(targetDeck.name)}</strong>
          — generating will <em>replace</em> its current questions.</p>` : ''}

        <label for="b-name">Deck name</label>
        <input id="b-name" type="text" placeholder="e.g. ACC 210 — Chapter 4"
               value="${esc(targetDeck?.name || '')}" ${targetDeck ? 'disabled' : ''}
               style="margin-bottom:var(--space-4)" />

        <h3>Study material</h3>
        <label for="b-notes">Notes</label>
        <textarea id="b-notes" rows="6" placeholder="Paste your class notes here…"></textarea>

        <div id="drop-zone" class="drop-zone" tabindex="0" role="button"
             aria-label="Add files (PDF, Word, PowerPoint, images)">
          <strong>Drop files here</strong> or tap to browse<br>
          <span class="drop-hint">PDF · DOCX · PPTX · images — up to ${MAX_FILES} files, 50 MB each</span>
          <input id="file-input" type="file" multiple accept="${ACCEPTED_EXTENSIONS}" class="visually-hidden" />
        </div>
        <div id="file-list" class="file-list"></div>

        <label for="b-url" style="margin-top:var(--space-3)">Web pages (optional)</label>
        <div class="debug-row" style="margin-top:0">
          <input id="b-url" type="url" placeholder="https://… (lecture page, article)" />
          <button class="btn-ghost" id="b-url-add" type="button">Add</button>
        </div>
        <div id="url-list" class="file-list"></div>

        <label for="b-extra" style="margin-top:var(--space-3)">Supplemental notes (optional)</label>
        <textarea id="b-extra" rows="3"
          placeholder="Anything extra the questions should cover…"></textarea>

        <h3 style="margin-top:var(--space-6)">Instructions</h3>
        <p class="auth-sub">Pick a preset (optional) — your instructions below are ADDED to it.</p>
        <div class="preset-grid" id="preset-grid">
          ${[...BUILT_IN_PRESETS, ...userPresets.map((p) => ({ ...p, custom: true }))]
            .map((p) => `
              <div class="preset-card${selectedPresetId === p.id ? ' selected' : ''}" data-preset="${esc(p.id)}">
                <strong>${esc(p.name)}</strong>
                <span class="preset-desc">${esc(p.description || 'Your saved preset')}</span>
                <span class="preset-links">
                  <button class="btn-link" data-preview="${esc(p.id)}" type="button">Preview</button>
                  ${p.custom ? `<button class="btn-link" data-del-preset="${esc(p.id)}" type="button">Delete</button>` : ''}
                </span>
              </div>`).join('')}
        </div>

        <label for="b-instructions" style="margin-top:var(--space-3)">Extra instructions (optional)</label>
        <textarea id="b-instructions" rows="3"
          placeholder="e.g. Focus on chapter 4; include journal-entry questions…"></textarea>
        <button class="btn-link" id="b-save-preset" type="button"
          style="justify-content:flex-start;padding-left:0">Save these instructions as a preset…</button>

        <div class="debug-row" style="align-items:center;margin-top:var(--space-4)">
          <label for="b-count" style="margin:0">Questions</label>
          <button class="btn-ghost" id="b-minus" type="button" style="min-width:var(--touch-min)">−</button>
          <input id="b-count" type="number" value="20" min="5" max="100" step="5"
                 style="width:5.5rem;text-align:center" />
          <button class="btn-ghost" id="b-plus" type="button" style="min-width:var(--touch-min)">+</button>
        </div>

        <button class="btn-primary" id="b-generate" style="width:100%;margin-top:var(--space-4)">
          ✨ Generate questions
        </button>
        <p id="b-status" class="gen-status" role="status"></p>

        <div id="b-preview"></div>

        <details class="fallback-details" id="fallback">
          <summary>No API key? Use claude.ai instead (free fallback)</summary>
          <p class="auth-sub">1. Copy the prompt. 2. Paste it into claude.ai with your files attached.
             3. Paste Claude's JSON reply below and import.</p>
          <button class="btn-ghost" id="b-copy-prompt" type="button">📋 Copy prompt for claude.ai</button>
          <label for="b-json" style="margin-top:var(--space-3)">Claude's JSON reply</label>
          <textarea id="b-json" rows="4" placeholder="Paste the JSON array here…"></textarea>
          <button class="btn-ghost" id="b-import" type="button" style="margin-top:var(--space-2)">Import JSON</button>
          <span id="b-import-status" class="gen-status"></span>
        </details>
      </div>`;

    wire();
    renderFileList();
    renderUrlList();
    renderPreview();
  }

  // ── Small helpers ────────────────────────────────────────────────────────
  const g = (id) => outlet.querySelector('#' + id);
  const setStatus = (msg, isError = false) => {
    const el = g('b-status');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('error', isError);
  };

  function collectInputs() {
    const notes = [g('b-notes').value.trim(), g('b-extra').value.trim()]
      .filter(Boolean).join('\n\n');
    const preset = allPresetsCache.find((p) => p.id === selectedPresetId);
    const custom = g('b-instructions').value.trim();
    const instructions = [preset?.body, custom].filter(Boolean).join('\n\nADDITIONALLY:\n');
    const count = Math.max(5, Math.min(100, parseInt(g('b-count').value, 10) || 20));
    const deckName = g('b-name').value.trim() || 'Study Deck';
    return { notes, instructions, count, deckName };
  }

  let allPresetsCache = [...BUILT_IN_PRESETS];

  // ── File handling ────────────────────────────────────────────────────────
  async function addFiles(fileList) {
    for (const file of fileList) {
      if (attachedFiles.length >= MAX_FILES) return showToast(`Maximum ${MAX_FILES} files`);
      if (file.size > MAX_FILE_BYTES) { showToast(`${file.name} exceeds 50 MB`); continue; }
      const kind = classifyFile(file);
      if (!kind) { showToast(`${file.name}: unsupported type`); continue; }
      if (attachedFiles.some((f) => f.file.name === file.name)) continue;
      attachedFiles.push({ file, kind, dataUrl: await readAsDataURL(file) });
    }
    renderFileList();
  }

  function renderFileList() {
    const el = g('file-list');
    if (!el) return;
    el.innerHTML = attachedFiles.map((f, i) => `
      <div class="file-row">
        <span>${f.kind === 'pdf' ? '📄' : f.kind === 'image' ? '🖼️' : '📝'}</span>
        <span class="file-name">${esc(f.file.name)}</span>
        <span class="file-size">${formatBytes(f.file.size)}${
          f.kind === 'image' && f.file.size > 5 * 1024 * 1024 ? ' · will compress' : ''}</span>
        <button class="icon-btn" data-rm-file="${i}" aria-label="Remove ${esc(f.file.name)}">✕</button>
      </div>`).join('');
    for (const btn of el.querySelectorAll('[data-rm-file]')) {
      btn.onclick = () => { attachedFiles.splice(Number(btn.dataset.rmFile), 1); renderFileList(); };
    }
  }

  function renderUrlList() {
    const el = g('url-list');
    if (!el) return;
    el.innerHTML = urls.map((u, i) => `
      <div class="file-row">
        <span>🔗</span><span class="file-name">${esc(u)}</span>
        <button class="icon-btn" data-rm-url="${i}" aria-label="Remove URL">✕</button>
      </div>`).join('');
    for (const btn of el.querySelectorAll('[data-rm-url]')) {
      btn.onclick = () => { urls.splice(Number(btn.dataset.rmUrl), 1); renderUrlList(); };
    }
  }

  // Turn notes+files+urls into API content parts + storable source entries.
  async function buildParts({ notes, instructions, count, deckName }) {
    const parts = [];
    const prepared = [];
    let extractedText = '';

    for (const f of attachedFiles) {
      if (f.kind === 'image') {
        setStatus(`Compressing ${f.file.name}…`);
        const { data, mediaType } = await compressImage(f.dataUrl, (p) =>
          setStatus(`Compressing ${f.file.name}… ${formatBytes(p.bytes)}`));
        parts.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });
        prepared.push({ name: f.file.name, kind: 'image', mediaType, data, sizeBytes: f.file.size });
      } else if (f.kind === 'pdf') {
        const data = f.dataUrl.split(',')[1];
        if (f.file.size > 30 * 1024 * 1024) showToast(`${f.file.name} is over 30 MB — Claude may reject it`);
        parts.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
        prepared.push({ name: f.file.name, kind: 'pdf', mediaType: 'application/pdf', data, sizeBytes: f.file.size });
      } else {
        // DOCX/PPTX → client-side text extraction (lazy-loaded parsers).
        setStatus(`Reading ${f.file.name}…`);
        const buffer = await (await fetch(f.dataUrl)).arrayBuffer();
        const text = f.kind === 'docx'
          ? await extractDocxText(buffer)
          : await extractPptxText(buffer);
        if (!text) { showToast(`${f.file.name}: no readable text found`); continue; }
        extractedText += `\n\n[From ${f.file.name}]\n${text}`;
        prepared.push({
          name: f.file.name, kind: f.kind,
          mediaType: f.file.type || 'application/octet-stream',
          data: f.dataUrl.split(',')[1], sizeBytes: f.file.size,
        });
      }
    }
    for (const u of urls) prepared.push({ kind: 'url', url: u });

    const prompt = buildPromptText({
      deckName, count, instructions,
      notesText: (notes + extractedText).trim(),
      urls,
    });
    parts.push({ type: 'text', text: prompt });
    return { parts, prepared, prompt };
  }

  // ── Generate (primary path) ──────────────────────────────────────────────
  async function generate() {
    if (busy) return;
    const settings = await repos.settings.get();
    if (!settings.anthropicApiKey) return openKeyModal();

    const inputs = collectInputs();
    if (!inputs.notes && attachedFiles.length === 0 && urls.length === 0) {
      return setStatus('Add some notes, files, or a URL first.', true);
    }

    busy = true;
    g('b-generate').disabled = true;
    try {
      const { parts, prepared } = await buildParts(inputs);
      setStatus('Calling Claude…');
      const raw = await generateQuestions({
        apiKey: settings.anthropicApiKey,
        model: settings.model || GENERATION_MODEL_DEFAULT,
        contentParts: parts,
        hasUrls: urls.length > 0,
        onStatus: setStatus,
      });
      finishGeneration(raw, inputs, prepared);
    } catch (err) {
      setStatus('❌ ' + err.message, true);
    } finally {
      busy = false;
      const btn = g('b-generate');
      if (btn) btn.disabled = false;
    }
  }

  let lastPrepared = [];
  let lastInputs = null;

  function finishGeneration(rawQuestions, inputs, prepared) {
    const valid = normalizeQuestions(rawQuestions).map((q) => shuffleAnswerPositions(q));
    if (valid.length === 0) return setStatus('No valid questions came back — try again.', true);
    generated = valid;
    lastPrepared = prepared;
    lastInputs = inputs;
    setStatus(`✓ ${valid.length} questions ready — review below, then save.`);
    renderPreview();
    g('b-preview')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ── Preview + save ───────────────────────────────────────────────────────
  function renderPreview() {
    const el = g('b-preview');
    if (!el) return;
    if (!generated.length) { el.innerHTML = ''; return; }
    const letters = ['A', 'B', 'C', 'D'];
    el.innerHTML = `
      <h3 style="margin-top:var(--space-6)">Preview — ${generated.length} questions</h3>
      <div class="preview-list">
        ${generated.map((q, i) => `
          <div class="preview-q">
            <div class="preview-meta">${i + 1} · ${esc(q.cat)} · ${q.type}</div>
            <div class="preview-text">${esc(q.q)}</div>
            ${q.type === 'free-response'
              ? `<div class="preview-ans">Accepted: ${q.ans.map(esc).join(', ')}</div>`
              : q.opts.map((o, j) => {
                  const correct = q.type === 'mc' ? j === q.ans : q.ans.includes(j);
                  return `<div class="preview-opt${correct ? ' correct' : ''}">${letters[j]}. ${esc(o)}${correct ? ' ✓' : ''}</div>`;
                }).join('')}
            ${q.explain ? `<div class="preview-explain">${esc(q.explain)}</div>` : ''}
          </div>`).join('')}
      </div>
      <button class="btn-primary" id="b-save" style="width:100%;margin-top:var(--space-3)">
        💾 Save ${targetDeckId ? 'into deck' : 'deck'}
      </button>`;
    el.querySelector('#b-save').onclick = () => saveDeck();
  }

  async function saveDeck() {
    if (!generated.length) return;
    const { deckName, instructions, notes } = lastInputs || collectInputs();

    let deckId = targetDeckId;
    if (deckId) {
      const ok = await confirmModal({
        title: 'Replace questions?',
        bodyText: `This replaces every question in this deck with the ${generated.length} new ones, on all devices.`,
        confirmLabel: 'Replace', danger: false,
      });
      if (!ok) return;
      await repos.questions.replaceForDeck(deckId, generated);
      const deck = await repos.decks.get(deckId);
      await repos.decks.update(deckId, {
        generationInstructions: instructions,
        generationNotes: notes,
        generationCount: (deck.generationCount || 0) + 1,
      });
    } else {
      // Choose a class (grouped by semester) for the new deck.
      const semesters = await repos.semesters.list();
      const options = [];
      for (const s of semesters) {
        for (const c of await repos.classes.listBySemester(s.id)) {
          options.push({ value: c.id, label: c.name, group: s.name });
        }
      }
      if (!options.length) {
        showToast('Create a class on Home first, then save the deck.');
        return;
      }
      const classId = await selectModal({
        title: 'Save to class', label: 'Class', options, submitLabel: 'Save deck',
      });
      if (!classId) return;
      const deck = await repos.decks.create({
        classId, name: deckName,
        generationInstructions: instructions, generationNotes: notes, generationCount: 1,
      });
      deckId = deck.id;
      await repos.questions.createMany(deckId, generated);
    }

    showToast(`✓ ${generated.length} questions saved`);
    // Store the sources in the background — regeneration fuel.
    if (lastPrepared.length) {
      sources.saveForDeck(deckId, lastPrepared, setStatus).then(({ failures }) => {
        if (failures) showToast(`⚠ ${failures} source file(s) failed to store — regeneration may need re-upload`);
      });
    }
    generated = [];
    location.hash = 'home';
  }

  // ── claude.ai fallback ───────────────────────────────────────────────────
  async function copyPrompt() {
    const inputs = collectInputs();
    if (!inputs.notes && attachedFiles.length === 0 && urls.length === 0) {
      return setStatus('Add some notes, files, or a URL first.', true);
    }
    // Files are attached in claude.ai directly; the prompt covers the rest.
    const prompt = buildPromptText({
      deckName: inputs.deckName, count: inputs.count,
      instructions: inputs.instructions,
      notesText: inputs.notes || '(see attached files)',
      urls,
    });
    try {
      await navigator.clipboard.writeText(prompt);
      showToast(attachedFiles.length
        ? 'Prompt copied — attach your files in claude.ai and paste it'
        : 'Prompt copied — paste it into claude.ai');
    } catch {
      openModal({ title: 'Copy this prompt', body: `<textarea rows="10" style="width:100%">${esc(prompt)}</textarea>` });
    }
  }

  function importJson() {
    const el = g('b-import-status');
    const raw = g('b-json').value.trim();
    if (!raw) { el.textContent = 'Paste the JSON reply first.'; return; }
    const parsed = extractAndRepairJSON(raw);
    if (!parsed) { el.textContent = 'Could not find a question array in that text.'; return; }
    const inputs = collectInputs();
    finishGeneration(parsed, inputs, []); // claude.ai path: files stayed there, nothing to store
    el.textContent = `✓ imported`;
  }

  // ── API key modal (primary-path setup) ───────────────────────────────────
  async function openKeyModal() {
    const settings = await repos.settings.get();
    const existing = settings.anthropicApiKey || '';
    const masked = existing ? 'sk-ant-' + '•'.repeat(16) + existing.slice(-4) : null;

    const body = document.createElement('div');
    body.innerHTML = `
      ${masked
        ? `<p>Current key: <code>${masked}</code></p>`
        : `<p>StudyBlitz calls Claude directly from your browser with YOUR key.</p>
           <ol style="padding-left:1.2rem;margin:0 0 var(--space-3)">
             <li>Go to <a href="https://console.anthropic.com" target="_blank" rel="noreferrer">console.anthropic.com</a></li>
             <li>API Keys → Create Key</li>
             <li>Paste it below (starts with <code>sk-ant-</code>)</li>
           </ol>`}
      <label for="key-input">${masked ? 'Replace key' : 'Your API key'}</label>
      <input id="key-input" type="password" autocomplete="off" placeholder="sk-ant-…" />
      <p class="auth-sub" style="margin-top:var(--space-2)">
        🔒 Your key is stored in your account so it works on every device.
        Only you can read it (Row Level Security).</p>
      <div style="display:flex;gap:var(--space-2);justify-content:flex-end;flex-wrap:wrap">
        ${existing ? '<button class="btn-danger" data-remove>Remove key</button>' : ''}
        <button class="btn-ghost" data-cancel>Cancel</button>
        <button class="btn-primary" data-save>Save key</button>
      </div>`;
    const close = openModal({ title: '🔑 Claude API key', body });
    body.querySelector('[data-cancel]').onclick = () => close();
    body.querySelector('[data-remove]')?.addEventListener('click', async () => {
      await repos.settings.save({ anthropicApiKey: null });
      close();
      showToast('API key removed');
      void render();
    });
    body.querySelector('[data-save]').onclick = async () => {
      const key = body.querySelector('#key-input').value.trim();
      if (!key) return;
      await repos.settings.save({ anthropicApiKey: key });
      close();
      showToast('✓ API key saved to your account');
      void render();
    };
  }

  // ── Preset interactions ──────────────────────────────────────────────────
  function previewPreset(preset) {
    openModal({
      title: preset.name,
      body: `
        <p class="auth-sub">${esc(preset.description || 'Your saved preset')}</p>
        <div class="paper-sheet ruled" style="box-shadow:none;border:1px solid var(--paper-shade)">
          <div class="ruled-content" style="white-space:pre-wrap;font-size:var(--text-sm)">${esc(preset.body)}</div>
        </div>
        <p class="auth-sub" style="margin-top:var(--space-3)">This text is sent to Claude together with your notes.</p>`,
    });
  }

  async function saveCustomPreset() {
    const bodyText = g('b-instructions').value.trim();
    if (!bodyText) return showToast('Write the instructions first, then save them as a preset');
    const name = await promptModal({ title: 'Save preset', label: 'Preset name', submitLabel: 'Next' });
    if (!name) return;
    const description = await promptModal({
      title: 'Save preset', label: 'One-line description (shown in the picker)',
      initial: '', submitLabel: 'Save preset',
    });
    await repos.presets.create({ name, body: bodyText, description: description || '' });
    showToast('✓ Preset saved');
    void render();
  }

  // ── Wiring ───────────────────────────────────────────────────────────────
  function wire() {
    (async () => {
      allPresetsCache = [...BUILT_IN_PRESETS, ...(await repos.presets.list())];
    })();

    g('key-chip').onclick = () => openKeyModal();
    g('b-generate').onclick = () => generate();
    g('b-copy-prompt').onclick = () => copyPrompt();
    g('b-import').onclick = () => importJson();
    g('b-save-preset').onclick = () => saveCustomPreset();
    g('b-minus').onclick = () => { g('b-count').value = Math.max(5, (parseInt(g('b-count').value, 10) || 20) - 5); };
    g('b-plus').onclick = () => { g('b-count').value = Math.min(100, (parseInt(g('b-count').value, 10) || 20) + 5); };

    const zone = g('drop-zone');
    const fileInput = g('file-input');
    zone.onclick = () => fileInput.click();
    zone.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } };
    zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('dragover'); };
    zone.ondragleave = () => zone.classList.remove('dragover');
    zone.ondrop = (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
    };
    fileInput.onchange = () => { void addFiles(fileInput.files); fileInput.value = ''; };

    g('b-url-add').onclick = () => {
      const input = g('b-url');
      const value = input.value.trim();
      if (!value) return;
      try { new URL(value); } catch { return showToast('That does not look like a URL'); }
      if (!urls.includes(value)) urls.push(value);
      input.value = '';
      renderUrlList();
    };

    g('preset-grid').onclick = async (e) => {
      const preview = e.target.closest('[data-preview]');
      if (preview) {
        const preset = allPresetsCache.find((p) => p.id === preview.dataset.preview);
        if (preset) previewPreset(preset);
        return;
      }
      const del = e.target.closest('[data-del-preset]');
      if (del) {
        const ok = await confirmModal({
          title: 'Delete preset?', bodyText: 'Removes this saved preset from your account.',
        });
        if (ok) {
          await repos.presets.remove(del.dataset.delPreset);
          if (selectedPresetId === del.dataset.delPreset) selectedPresetId = null;
          void render();
        }
        return;
      }
      const card = e.target.closest('.preset-card');
      if (card) {
        // Click to select; click again to deselect.
        selectedPresetId = selectedPresetId === card.dataset.preset ? null : card.dataset.preset;
        for (const el of outlet.querySelectorAll('.preset-card')) {
          el.classList.toggle('selected', el.dataset.preset === selectedPresetId);
        }
      }
    };
  }

  void render();
  return () => {}; // nothing persistent to tear down
}
