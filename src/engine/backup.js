// backup.js — local-first export/import of all StudyBlitz data.
// The escape hatch: downloads / restores the raw values of every sb_ data
// key so a user can keep a safety copy or move between devices WITHOUT any
// account or cloud sync. Writes go straight to localStorage (lsSave) — never
// through the cloud-sync path, so an import never races a background push.

import { KEYS } from '../config.js';
import { lsLoad, lsSave } from './storage.js';
import { invalidateDecksCache } from './decks.js';
import { invalidateMemCache } from './memory.js';

// Every data key the backup carries. Order is cosmetic. We deliberately skip
// sb_pending_deck (transient, mid-save scratch) — it never holds durable data.
const BACKUP_KEYS = [
  KEYS.decks,      // sb_decks_v1
  KEYS.memory,     // sb_memory_v1
  KEYS.classes,    // sb_classes_v1
  KEYS.highscores, // sb_highscores_v1
  KEYS.recentDeck, // sb_recent_deck
  KEYS.apiKey,     // sb_apikey_v1
];

export const BACKUP_VERSION = 1;
const BACKUP_TYPE = 'studyblitz-backup';

let _toast, _refreshAll;
export function initBackupCallbacks({ toast, refreshAll }) {
  _toast = toast;
  _refreshAll = refreshAll;
}

// ── Build the backup object ────────────────────────────────────────────────
// Stores RAW stringified values (byte-faithful — never re-encodes), so a
// backup round-trips exactly what localStorage held, builtins and all.
export function buildBackup() {
  const data = {};
  for (const k of BACKUP_KEYS) {
    const raw = localStorage.getItem(k);
    if (raw !== null) data[k] = raw;
  }
  return {
    app: 'StudyBlitz',
    type: BACKUP_TYPE,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}

// Count decks (excluding the MKT300 builtin) and classes for the UI.
export function backupCounts(backup) {
  let decks = 0, classes = 0;
  try {
    const d = JSON.parse(backup?.data?.[KEYS.decks] || '[]');
    if (Array.isArray(d)) decks = d.filter(x => x && x.id !== 'builtin-mkt300').length;
  } catch (_) {}
  try {
    const c = JSON.parse(backup?.data?.[KEYS.classes] || '[]');
    if (Array.isArray(c)) classes = c.length;
  } catch (_) {}
  return { decks, classes };
}

// ── Export: trigger a file download ─────────────────────────────────────────
export function exportBackup() {
  try {
    const backup = buildBackup();
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `studyblitz-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    // Remember the last successful export for the Phase 3 backup nudge.
    try { localStorage.setItem(KEYS.lastExport, String(Date.now())); } catch (_) {}

    const { decks, classes } = backupCounts(backup);
    _toast?.(`💾 Backup downloaded — ${decks} deck${decks === 1 ? '' : 's'}, ${classes} class${classes === 1 ? '' : 'es'}`);
    return true;
  } catch (e) {
    console.warn('exportBackup error:', e);
    _toast?.('Could not create backup — try again');
    return false;
  }
}

// ── Validate a parsed object is a StudyBlitz backup ─────────────────────────
export function validateBackup(obj) {
  if (!obj || typeof obj !== 'object') return 'That file is not a valid backup.';
  if (obj.type !== BACKUP_TYPE)        return 'That is not a StudyBlitz backup file.';
  if (!obj.data || typeof obj.data !== 'object') return 'This backup has no data in it.';
  if (typeof obj.version !== 'number' || obj.version > BACKUP_VERSION) {
    return 'This backup was made by a newer version of StudyBlitz.';
  }
  return null; // valid
}

// ── Import entry point: open a file picker ──────────────────────────────────
export function importBackupPicker() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (file) readBackupFile(file);
  };
  input.click();
}

function readBackupFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let obj;
    try {
      obj = JSON.parse(reader.result);
    } catch (e) {
      _toast?.('That file is not valid JSON.');
      return;
    }
    const err = validateBackup(obj);
    if (err) { _toast?.(err); return; }
    _showImportModal(obj);
  };
  reader.onerror = () => _toast?.('Could not read that file.');
  reader.readAsText(file);
}

// ── Confirmation modal: Replace vs Merge, with counts ───────────────────────
function _showImportModal(backup) {
  const { decks, classes } = backupCounts(backup);
  let modal = document.getElementById('sb-import-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'sb-import-modal';
    modal.className = 'modal-overlay';
    modal.onclick = e => { if (e.target === modal) modal.style.display = 'none'; };
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal-box" style="max-width:460px;">
      <h2>Import backup</h2>
      <p style="color:var(--muted);font-size:0.88rem;line-height:1.6;margin-bottom:1.3rem;">
        This backup contains <strong style="color:var(--text);">${decks} deck${decks === 1 ? '' : 's'}</strong>
        and <strong style="color:var(--text);">${classes} class${classes === 1 ? '' : 'es'}</strong>${backup.exportedAt ? `,<br>exported ${new Date(backup.exportedAt).toLocaleString()}` : ''}.<br><br>
        How would you like to bring it in?
      </p>
      <div style="display:flex;flex-direction:column;gap:0.8rem;">
        <button class="btn btn-primary" id="sb-import-merge" style="justify-content:center;">
          Merge — keep what I have, add from backup
        </button>
        <button class="btn btn-ghost" id="sb-import-replace" style="justify-content:center;color:var(--accent);border-color:var(--accent);">
          Replace — wipe current data, use backup
        </button>
        <button class="btn btn-ghost" id="sb-import-cancel" style="justify-content:center;">Cancel</button>
      </div>
    </div>`;
  modal.style.display = 'flex';

  const g = id => document.getElementById(id);
  g('sb-import-cancel').onclick  = () => { modal.style.display = 'none'; };
  g('sb-import-merge').onclick   = () => { modal.style.display = 'none'; applyImport(backup, 'merge'); };
  g('sb-import-replace').onclick = () => {
    if (window.confirm('Replace will overwrite the decks, classes and progress currently in this browser. Continue?')) {
      modal.style.display = 'none';
      applyImport(backup, 'replace');
    }
  };
}

// ── Apply the import ────────────────────────────────────────────────────────
// 'replace' — overwrite each key the backup carries, byte-for-byte.
// 'merge'   — dedupe by id (decks/classes), keep the stronger record
//             (memory/highscores). Never silently clobbers existing work.
export function applyImport(backup, mode) {
  try {
    const d = backup.data || {};

    if (mode === 'replace') {
      for (const k of BACKUP_KEYS) {
        if (d[k] === undefined) continue;
        // Preserve the local MKT300 builtin so the demo deck never vanishes.
        if (k === KEYS.decks) {
          const incoming = _safeParse(d[k], []);
          const builtin  = (lsLoad(KEYS.decks) || []).find(x => x.id === 'builtin-mkt300');
          const kept     = incoming.filter(x => x.id !== 'builtin-mkt300');
          lsSave(KEYS.decks, builtin ? [builtin, ...kept] : kept);
        } else {
          localStorage.setItem(k, d[k]); // raw, byte-faithful
        }
      }
    } else {
      _mergeDecks(_safeParse(d[KEYS.decks], null));
      _mergeClasses(_safeParse(d[KEYS.classes], null));
      _mergeMemory(_safeParse(d[KEYS.memory], null));
      _mergeHighscores(_safeParse(d[KEYS.highscores], null));
      // recent deck + API key: only fill if we don't already have one.
      if (d[KEYS.recentDeck] && !localStorage.getItem(KEYS.recentDeck)) localStorage.setItem(KEYS.recentDeck, d[KEYS.recentDeck]);
      if (d[KEYS.apiKey]     && !localStorage.getItem(KEYS.apiKey))     localStorage.setItem(KEYS.apiKey, d[KEYS.apiKey]);
    }

    invalidateDecksCache();
    invalidateMemCache();
    _refreshAll?.();

    const { decks, classes } = backupCounts(backup);
    _toast?.(mode === 'replace'
      ? `✅ Restored ${decks} deck${decks === 1 ? '' : 's'}, ${classes} class${classes === 1 ? '' : 'es'}`
      : `✅ Merged in ${decks} deck${decks === 1 ? '' : 's'}, ${classes} class${classes === 1 ? '' : 'es'}`);
    return true;
  } catch (e) {
    console.warn('applyImport error:', e);
    _toast?.('Import failed — your current data was not changed.');
    return false;
  }
}

// ── Merge helpers ───────────────────────────────────────────────────────────
function _mergeDecks(incoming) {
  if (!Array.isArray(incoming)) return;
  const local = lsLoad(KEYS.decks) || [];
  const map = new Map();
  // Local first, then incoming — incoming wins ties only if newer by created.
  local.forEach(dk => { if (dk.id !== 'builtin-mkt300') map.set(dk.id, dk); });
  incoming.forEach(dk => {
    if (dk.id === 'builtin-mkt300') return;
    const ex = map.get(dk.id);
    if (!ex || new Date(dk.created || 0) >= new Date(ex.created || 0)) map.set(dk.id, dk);
  });
  const builtin = local.find(dk => dk.id === 'builtin-mkt300');
  lsSave(KEYS.decks, builtin ? [builtin, ...map.values()] : [...map.values()]);
}

function _mergeClasses(incoming) {
  if (!Array.isArray(incoming)) return;
  const map = new Map();
  (lsLoad(KEYS.classes) || []).forEach(c => map.set(c.id, c));
  incoming.forEach(c => { if (!map.has(c.id)) map.set(c.id, c); });
  lsSave(KEYS.classes, [...map.values()]);
}

function _mergeMemory(incoming) {
  if (!incoming || typeof incoming !== 'object') return;
  const merged = { ...(lsLoad(KEYS.memory) || {}) };
  for (const [qid, r] of Object.entries(incoming)) {
    // Keep whichever record has more total answers (more learning history).
    if (!merged[qid] || (r.total || 0) > (merged[qid].total || 0)) merged[qid] = r;
  }
  lsSave(KEYS.memory, merged);
}

function _mergeHighscores(incoming) {
  if (!incoming || typeof incoming !== 'object') return;
  const merged = { ...(lsLoad(KEYS.highscores) || {}) };
  for (const [k, v] of Object.entries(incoming)) {
    if (merged[k] === undefined || v > merged[k]) merged[k] = v;
  }
  lsSave(KEYS.highscores, merged);
}

function _safeParse(raw, fallback) {
  if (raw === undefined || raw === null) return fallback;
  try { return JSON.parse(raw); } catch (_) { return fallback; }
}
