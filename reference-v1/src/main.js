// main.js — boot sequence, callback wiring, window globals, event listeners

import './styles/main.css';
import './styles/quiz.css';
import './styles/exam.css';
import './styles/classes.css';

import { nav, openNav, closeNav, initNavCallbacks, initNavListeners, ROUTES, _routing } from './components/Navigation.js';
import { initDeckCardCallbacks } from './components/DeckCard.js';
import { initFab, initFabUI } from './components/Fab.js';
import { toggleDeckMenu, openAssignClassModal, openCreateClassModal, openClassMenu, initModalCallbacks, openGuestSignupModal, closeGuestSignupModal } from './components/Modals.js';
import { initDeckCallbacks, getDecks, getDeckById, deleteDeck, initBuiltins, invalidateDecksCache } from './engine/decks.js';
import { invalidateMemCache } from './engine/memory.js';
import { initAuth, syncOnBoot, scheduleSync, pushToCloud, openAuthModal, updateAuthStatus, initAuthCallbacks, isLoggedIn } from './engine/auth.js';
import { registerSyncCallback, registerImmediateSyncCallback } from './engine/storage.js';
import { initBackupCallbacks, exportBackup, importBackupPicker } from './engine/backup.js';
import { KEYS } from './config.js';
import {
  QS, EX, getHS, hsKey, getBestHS, saveHS,
  quickStartDeck, drillDeck, launchQuiz, launchDrillAll, launchDrillFromResults,
  startQS, renderQ, answerQ, quizNext, exitQuiz, showResults,
  replayQuiz, closeResults, reviewExam,
  showTCResults, replayTC, closeTCResults,
  launchExam, renderExam, submitExam, exitExam,
  getAllWeakCount, renderFixButton, launchConfetti,
  openFullscreenImg, closeFullscreenImg,
  initQuizCallbacks
} from './engine/quiz.js';
import { refreshDashboard, openKnowledgeBreakdown, closeKB, relaunchRecent, openReviewModal, initDashboardCallbacks, showGettingStarted } from './pages/Dashboard.js';
import { refreshClasses, drillClassMixed, openClassQuizPanel, initClassesCallbacks } from './pages/Classes.js';
import { refreshQuizSelect, onModeChange, adjQCount, initQuizSelectCallbacks, initQuizSelectListeners } from './pages/QuizSelect.js';
import { refreshSavedTests, initSavedTestsCallbacks } from './pages/SavedTests.js';
import { refreshWeakSpots, initWeakSpotsCallbacks } from './pages/WeakSpots.js';
import {
  switchMethod, copyPromptForClaude, importFromJson, clearImport, generateDeck, saveDeck,
  adjGenCount, switchTab, setupDropZone, handleFiles,
  openApiModal, closeApiModal, toggleKeyVis, saveApiKey, removeApiKey, updateKeyBadge,
  promptClassAssignment, initGeneratorCallbacks
} from './pages/Generator.js';

// ── Global error boundary ──
window.onerror = (msg, src, line, col, err) => {
  console.error('[StudyBlitz] Uncaught error:', err || msg, src ? `${src}:${line}:${col}` : '');
};
window.onunhandledrejection = (e) => {
  console.error('[StudyBlitz] Unhandled promise rejection:', e.reason);
};

// ── Toast notification ──
export function toast(msg, duration=2800) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

// ── Refresh all pages ──
export function refreshAll() {
  refreshDashboard();
  refreshClasses();
  refreshQuizSelect();
  refreshSavedTests();
  refreshWeakSpots();
  updateKeyBadge();
}

// ── Wire up all callback injections ──
function wireCallbacks() {
  initAuthCallbacks({ toast, refreshAll });
  initBackupCallbacks({ toast, refreshAll });
  initDeckCallbacks(toast, refreshAll);
  initModalCallbacks({ toast, refreshAll, deleteDeck });
  initNavCallbacks({ refreshDashboard, refreshClasses, refreshQuizSelect, refreshSavedTests, refreshWeakSpots, openClassQuizPanel });
  initDeckCardCallbacks({ quickStartDeck, drillDeck, toggleDeckMenu, openAssignClassModal });
  initQuizCallbacks({ toast, refreshAll, nav, refreshDashboard, refreshQuizSelect, refreshWeakSpots });
  initDashboardCallbacks({ nav });
  initClassesCallbacks({ toast, nav, refreshAll, refreshClasses });
  initQuizSelectCallbacks({ toast, nav });
  initSavedTestsCallbacks({ toast, nav, refreshAll });
  initWeakSpotsCallbacks({ toast, nav });
  initGeneratorCallbacks({ toast, nav, refreshAll });
  initFab({ toast, openApiModal });
}

// ── Expose onclick-referenced functions to window ──
function exposeGlobals() {
  window.nav = nav;
  window.openNav = openNav;
  window.closeNav = closeNav;
  window.refreshQuizSelect = refreshQuizSelect;
  window.onModeChange = onModeChange;
  window.adjQCount = adjQCount;
  window.adjGenCount = adjGenCount;
  window.QS = QS;
  window.launchQuiz = launchQuiz;
  window.launchDrillAll = launchDrillAll;
  window.launchDrillFromResults = launchDrillFromResults;
  window.exitQuiz = exitQuiz;
  window.quizNext = quizNext;
  window.replayQuiz = replayQuiz;
  window.closeResults = closeResults;
  window.reviewExam = reviewExam;
  window.replayTC = replayTC;
  window.closeTCResults = closeTCResults;
  window.submitExam = submitExam;
  window.exitExam = exitExam;
  window.openKnowledgeBreakdown = openKnowledgeBreakdown;
  window.closeKB = closeKB;
  window.openReviewModal = openReviewModal;
  window.showGettingStarted = showGettingStarted;
  window.openCreateClassModal = openCreateClassModal;
  window.openClassMenu = openClassMenu;
  window.switchMethod = switchMethod;
  window.copyPromptForClaude = copyPromptForClaude;
  window.importFromJson = importFromJson;
  window.clearImport = clearImport;
  window.generateDeck = generateDeck;
  window.saveDeck = saveDeck;
  window.switchTab = switchTab;
  window.handleFiles = handleFiles;
  window.openApiModal = openApiModal;
  window.closeApiModal = closeApiModal;
  window.toggleKeyVis = toggleKeyVis;
  window.saveApiKey = saveApiKey;
  window.removeApiKey = removeApiKey;
  window.toast = toast;
  window.openAuthModal = openAuthModal;
  window.openGuestSignupModal = openGuestSignupModal;
  window.closeGuestSignupModal = closeGuestSignupModal;
  window.openFullscreenImg = openFullscreenImg;
  window.closeFullscreenImg = closeFullscreenImg;
  window.exportBackup = exportBackup;
  window.importBackupPicker = importBackupPicker;
}

// ── Keyboard handler ──
function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    const qs = document.getElementById('quiz-screen');
    if (!qs || !qs.classList.contains('open')) return;
    // Don't intercept keys when the free-response input is focused
    if (document.activeElement && document.activeElement.id === 'fr-input') return;
    if (e.key === 'Enter' || e.key === ' ') {
      const next = document.getElementById('q-next');
      if (next && next.classList.contains('show')) { e.preventDefault(); quizNext(); }
    }
    const map = {a:0,b:1,c:2,d:3,'1':0,'2':1,'3':2,'4':3};
    const k = e.key.toLowerCase();
    if (map[k] !== undefined) {
      const btns = document.querySelectorAll('.opt-btn');
      if (btns.length > map[k] && !btns[0].disabled) answerQ(map[k]);
    }
  });
}

// ── Fullscreen image overlay listeners ──
function initFullscreenImage() {
  const overlay = document.getElementById('img-fullscreen');
  const closeBtn = document.getElementById('img-fullscreen-close');
  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFullscreenImg(); });
  if (closeBtn) closeBtn.addEventListener('click', closeFullscreenImg);
}

// ── Close dropdown menus on outside click ──
function initClickOutside() {
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#deck-ctx-menu') && !e.target.closest('.deck-ellipsis')) {
      const menu = document.getElementById('deck-ctx-menu');
      if (menu) menu.remove();
    }
  });
}

// ── Hash routing ──
function handleDeckDeepLink(deckId) {
  if (!deckId) { toast('Invalid deck link'); nav('dashboard'); return; }
  const deck = getDeckById(deckId);
  if (!deck) {
    toast(isLoggedIn() ? 'Deck not found' : 'Sign in to open this deck review');
    history.replaceState(null, '', window.location.pathname + '#dashboard');
    nav('dashboard');
    return;
  }
  // Replace deep-link hash so back button returns to dashboard, not the link
  history.replaceState(null, '', window.location.pathname + '#dashboard');
  quickStartDeck(deck.id);
  toast('Opening ' + deck.name + '…');
}

function handleHashChange() {
  if (_routing.navInProgress) return;
  const hash = window.location.hash.slice(1);
  if (!hash) { nav('dashboard'); return; }
  const [route, queryStr] = hash.split('?');
  if (route === 'review') {
    const deckId = new URLSearchParams(queryStr || '').get('deck');
    handleDeckDeepLink(deckId);
    return;
  }
  if (ROUTES[route]) { nav(ROUTES[route]); }
  else { nav('dashboard'); }
}

function handleInitialHash() {
  const hash = window.location.hash.slice(1);
  if (!hash) {
    // Everyone starts on the dashboard — guests see its guest banner /
    // getting-started state. (The 3D landing hero was removed for perf.)
    nav('dashboard');
    return;
  }
  const [route, queryStr] = hash.split('?');
  if (route === 'review') {
    const deckId = new URLSearchParams(queryStr || '').get('deck');
    handleDeckDeepLink(deckId);
    return;
  }
  if (ROUTES[route]) { nav(ROUTES[route]); }
  else { nav('dashboard'); }
}

function initHashRouting() {
  window.addEventListener('hashchange', handleHashChange);
}

// ── Service worker update: auto-reload when a new SW takes over an existing page ──
// skipWaiting + clientsClaim (vite.config.js) cause controllerchange to fire when
// a new deploy activates. We reload once so users get the fresh bundle automatically.
// First-time visitors (controller === null on load) are skipped — no reload loop.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) window.location.reload();
  });
}

// ── Console easter egg (Claude & Matt) ──
function consoleEasterEgg() {
  try {
    console.log(
      '%cStudyBlitz%c  study smarter, not harder',
      'font-family:monospace;font-size:22px;font-weight:700;color:#ff3f6c;',
      'font-family:monospace;font-size:12px;color:#6a6a98;'
    );
    console.log('%c✦ crafted by Claude & Matt', 'font-family:monospace;font-size:11px;color:#38b2ff;');
  } catch (_) {}
}

// Ask the browser to keep our data from being evicted. Best-effort and silent:
// most browsers grant it without any prompt; denial is handled gracefully.
async function requestPersistentStorage() {
  try {
    if (!navigator.storage?.persist) return;
    if (await navigator.storage.persisted?.()) return; // already persistent
    await navigator.storage.persist();                  // may resolve false — that's fine
  } catch (_) { /* no scary prompts, ever */ }
}

// ── Cross-tab live sync ──
// A localStorage write fires a 'storage' event in every OTHER tab of the same
// browser profile (never in the tab that made the change). When another tab
// changes our data, we drop the stale in-memory caches and re-render — so a
// deck created in one tab shows up in the others within a moment. Same-machine
// only; no account, no network.
function initCrossTabSync() {
  const DATA_KEYS = new Set([
    KEYS.decks, KEYS.classes, KEYS.memory, KEYS.highscores, KEYS.recentDeck,
  ]);
  let pending = null;
  window.addEventListener('storage', (e) => {
    // Ignore sessionStorage and unrelated keys. (e.key is null on a full
    // clear() — treat that as "something changed" and refresh too.)
    if (e.storageArea && e.storageArea !== localStorage) return;
    if (e.key !== null && !DATA_KEYS.has(e.key)) return;

    // Caches are always safe to drop immediately so any later read is fresh.
    invalidateDecksCache();
    invalidateMemCache();

    // Coalesce bursts (e.g. a deck + its class written back-to-back) into one
    // repaint. Skip the repaint while a quiz/exam overlay is open so we never
    // yank the screen out from under an in-progress session — the cleared
    // caches mean the next natural refresh still picks up the new data.
    clearTimeout(pending);
    pending = setTimeout(() => {
      const quizOpen = document.getElementById('quiz-screen')?.classList.contains('open');
      const examOpen = document.getElementById('exam-screen')?.classList.contains('open');
      if (!quizOpen && !examOpen) refreshAll();
    }, 150);
  });
}

// ── Boot ──
async function boot() {
  consoleEasterEgg();
  wireCallbacks();                        // must be first — wires toast/_refreshAll
  exposeGlobals();
  initNavListeners();
  initKeyboard();
  initFullscreenImage();
  initClickOutside();
  initFabUI();
  initHashRouting();
  initCrossTabSync();                      // keep sibling tabs in sync (same browser)
  setupDropZone();
  updateKeyBadge();
  registerSyncCallback(scheduleSync);            // debounced push (memory/highscores)
  registerImmediateSyncCallback(pushToCloud);    // immediate push (deck/class creation)

  await syncOnBoot();                     // 4a: restore session + silent merge FIRST
  await initBuiltins();                   // ensure MKT300 built-in exists
  initAuth();                             // set up onAuthStateChange listener

  refreshAll();
  updateAuthStatus();                     // render correct auth state in nav + banner
  initQuizSelectListeners();              // wire game-mode radio auto-open once
  handleInitialHash();                    // navigate to hash URL or set #dashboard

  requestPersistentStorage();             // best-effort: keep local data from eviction
}

boot();
