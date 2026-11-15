// Classes.js — classes page rendering: class cards, quiz panels, drill actions

import { getMem, getRec, isWeak, weightedSample, interleaveQuestions } from '../engine/memory.js';
import { getDecks, getDeckById, getDeckColor } from '../engine/decks.js';
import { getClasses } from '../engine/classes.js';
import { makeDeckCard } from '../components/DeckCard.js';
import { QS, startQS, launchExam } from '../engine/quiz.js';
import { renderModeSelector, getSelectedMode } from '../pages/QuizSelect.js';

let _toast, _nav, _refreshAll, _refreshClasses;
export function initClassesCallbacks({ toast, nav, refreshAll, refreshClasses }) {
  _toast = toast; _nav = nav; _refreshAll = refreshAll; _refreshClasses = refreshClasses;
}

/* ── refreshClasses ────────────────────────────────────────── */
export function refreshClasses() {
  const classes = getClasses();
  const decks = getDecks();
  const mem = getMem();

  const summary = document.getElementById('classes-summary');
  const totalDecks = decks.filter(d => d.classId).length;
  if (summary) {
    summary.textContent = `${classes.length} class${classes.length !== 1 ? 'es' : ''} \u00B7 ${totalDecks} deck${totalDecks !== 1 ? 's' : ''} assigned`;
  }

  const content = document.getElementById('classes-content');
  if (!content) return;
  content.innerHTML = '';

  if (!classes.length) {
    content.innerHTML = '<div class="no-classes"><div class="nc-icon">\uD83C\uDF93</div><p>No classes yet.<br>Click <strong>+ New Class</strong> to create one.</p></div>';
    return;
  }

  // Responsive grid of lightweight glass class tiles (no WebGL). Each tile
  // expands to reveal its decks (reusing makeDeckCard) + a class drill button.
  const grid = document.createElement('div');
  grid.className = 'classes-grid';

  classes.forEach(cls => {
    const classDecks = decks.filter(d => d.classId === cls.id);
    const weakQs = classDecks.flatMap(d => d.questions.filter(q => isWeak(getRec(mem, q.id))));

    const tile = document.createElement('div');
    tile.className = 'class-tile stagger-in';
    tile.style.setProperty('--cls', cls.color);

    // Ellipsis (class options) \u2014 reuses the existing class menu.
    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'class-tile-menu';
    menuBtn.title = 'Class options';
    menuBtn.textContent = '\u22EF';
    menuBtn.onclick = (e) => { e.stopPropagation(); window.openClassMenu(cls.id); };

    // Header \u2014 click to expand/collapse the deck list.
    const hdr = document.createElement('button');
    hdr.type = 'button';
    hdr.className = 'class-tile-hdr';
    hdr.setAttribute('aria-expanded', 'false');
    hdr.innerHTML = `
      <span class="class-tile-name">${cls.name}</span>
      <span class="class-tile-meta">${classDecks.length} deck${classDecks.length !== 1 ? 's' : ''}${weakQs.length ? ' \u00B7 ' + weakQs.length + ' weak' : ''}</span>
      <span class="class-tile-chevron" aria-hidden="true">\u25BE</span>`;

    // Animated body \u2192 single inner wrapper (grid-rows 0fr\u21941fr slide).
    const body = document.createElement('div');
    body.className = 'class-tile-body';
    const inner = document.createElement('div');
    inner.className = 'class-tile-inner';

    if (classDecks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'class-tile-empty';
      empty.innerHTML = `No decks assigned to this class yet.<br>
        <button class="btn btn-ghost btn-sm" style="margin-top:0.5rem;" onclick="nav('generator')">\uD83D\uDEE0\uFE0F Build a Deck</button>`;
      inner.appendChild(empty);
    } else {
      const list = document.createElement('div');
      list.className = 'class-tile-decks';
      classDecks.forEach(deck => {
        const deckCard = makeDeckCard(deck, cls);
        const quizBtn = deckCard.querySelector('.btn-primary');
        if (quizBtn) {
          quizBtn.textContent = '\u25B6 Quiz';
          quizBtn.onclick = (e) => { e.stopPropagation(); openClassQuizPanel(deck, cls); };
        }
        list.appendChild(deckCard);
      });
      inner.appendChild(list);

      // Single drill button \u2014 only when the class has weak spots.
      if (weakQs.length > 0) {
        const drillBtn = document.createElement('button');
        drillBtn.className = 'btn btn-ghost btn-sm class-tile-drill';
        drillBtn.innerHTML = `\uD83C\uDFAF Drill All Weak Spots <span class="dim">(${weakQs.length})</span>`;
        drillBtn.onclick = () => drillClassMixed(cls.id);
        inner.appendChild(drillBtn);
      }
    }

    body.appendChild(inner);

    hdr.addEventListener('click', () => {
      const open = tile.classList.toggle('open');
      hdr.setAttribute('aria-expanded', String(open));
    });

    tile.appendChild(menuBtn);
    tile.appendChild(hdr);
    tile.appendChild(body);
    grid.appendChild(tile);
  });

  content.appendChild(grid);
}

/* ── drillClassMixed ──────────────────────────────────────── */
export function drillClassMixed(classId, singleDeckId) {
  const decks = getDecks();
  const mem = getMem();
  const classDecks = singleDeckId
    ? decks.filter(d => d.id === singleDeckId)
    : decks.filter(d => d.classId === classId);

  const seen = new Set();
  const weakQs = [];
  classDecks.forEach(d => {
    d.questions.forEach(q => {
      if (!seen.has(q.id) && isWeak(getRec(mem, q.id))) {
        seen.add(q.id);
        weakQs.push(q);
      }
    });
  });

  if (weakQs.length === 0) {
    if (_toast) _toast('No weak spots to drill!');
    return;
  }

  QS.deck      = { id: 'class-drill-' + classId, name: 'Class Drill' };
  QS.questions = weakQs.sort(() => Math.random() - 0.5);
  QS.questions = interleaveQuestions(QS.questions, mem);
  QS.mode      = 'drill';
  startQS();
}

/* ── Class quiz panel ─────────────────────────────────────── */
/* ── openClassQuizPanel ───────────────────────────────────── */
export function openClassQuizPanel(deck, cls) {
  document.getElementById('cq-modal')?.remove();

  const ov = document.createElement('div');
  ov.id = 'cq-modal';
  ov.className = 'modal-overlay';
  ov.style.display = 'flex';
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });

  const box = document.createElement('div');
  box.className = 'modal-box';
  box.style.cssText = 'max-width:480px;width:100%;max-height:90vh;overflow-y:auto;';

  box.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:1.2rem;padding-bottom:1rem;border-bottom:1px solid var(--border);">
      <div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:1.4rem;letter-spacing:0.05em;">${deck.name}</div>
        <div style="font-size:0.75rem;color:var(--muted);margin-top:0.15rem;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${cls.color};margin-right:0.4rem;vertical-align:middle;"></span>${cls.name} · ${deck.questions.length} questions
        </div>
      </div>
      <button id="cq-close-btn" style="background:transparent;border:none;color:var(--muted);font-size:1.2rem;cursor:pointer;padding:0.2rem 0.4rem;line-height:1;border-radius:6px;flex-shrink:0;" title="Close">✕</button>
    </div>
    <div id="cq-selector-wrap"></div>
    <button class="btn btn-primary" id="cq-start-btn" style="width:100%;justify-content:center;margin-top:1.2rem;font-size:1rem;padding:0.85rem;">▶ Start Quiz</button>`;

  ov.appendChild(box);
  document.body.appendChild(ov);

  box.querySelector('#cq-close-btn').onclick = () => ov.remove();
  box.querySelector('#cq-start-btn').onclick = () => _launchClassQuizFromModal(deck, cls);

  renderModeSelector(
    document.getElementById('cq-selector-wrap'),
    'cq',
    deck
  );
}

/* ── _launchClassQuizFromModal ────────────────────────────── */
function _launchClassQuizFromModal(deck, cls) {
  const mode = getSelectedMode('cq');
  const mem  = getMem();

  // Read DOM values before removing the modal — after removal getElementById returns null
  const rawCount = parseInt(document.getElementById('cq-count')?.value);
  const tcSecs   = parseInt(document.getElementById('cq-tc-sel')?.value || '60');

  document.getElementById('cq-modal')?.remove();

  QS.deck = deck;
  QS.mode = mode;

  if (mode === 'exam') {
    const n = Math.min(
      Math.max(5, isNaN(rawCount) ? deck.questions.length : rawCount),
      deck.questions.length
    );
    launchExam(deck.id, n);
    return;
  }

  if (mode === 'timechallenge') {
    QS.tcSecs    = tcSecs;
    QS.questions = [...deck.questions].sort(() => Math.random() - 0.5);
    startQS();
    return;
  }

  const n = Math.min(
    Math.max(5, isNaN(rawCount) ? deck.questions.length : rawCount),
    deck.questions.length
  );

  QS.questions = weightedSample(deck.questions, mem, n);
  QS.questions = interleaveQuestions(QS.questions, mem);
  startQS();
}