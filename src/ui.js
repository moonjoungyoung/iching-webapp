import { ASK_ENDPOINT } from './config.js';
import { isMuted, setMuted } from './sound.js';
import { later } from './clock.js';

const $ = (sel) => document.querySelector(sel);

// 엔드포인트가 실제로 설정된 경우에만 묻기 활성화
const ASK_ENABLED = !!ASK_ENDPOINT && !ASK_ENDPOINT.startsWith('__');

export const YAO_NAMES = ['初爻', '二爻', '三爻', '四爻', '五爻', '上爻'];
const LINE_HANJA = { 6: '老陰', 7: '少陽', 8: '少陰', 9: '老陽' };
const LINE_KO = { 6: '노음', 7: '소양', 8: '소음', 9: '노양' };
const NUM_HANJA = { 6: '六', 7: '七', 8: '八', 9: '九' };
const YAO_KO = ['초효', '이효', '삼효', '사효', '오효', '상효'];

const ASK_GENERIC_FIRST = '이 점괘가 지금 제 고민에 대해 무엇을 말하나요?';
const ASK_EXAMPLES = [
  '지금 무엇을 조심해야 할까요?',
  '변효가 가리키는 변화는 어떤 의미인가요?',
  '한 문장으로 요약해 주세요.',
];

// 물음 창과 던지기 화면 문구(.qa/copy/final.json 그대로. \n 은 줄바꿈으로 보인다)
const QCOPY = {
  title: '물음을 품으세요',
  lead: '물음을 마음에 품고,\n동전 세 닢을 여섯 번 던지세요.',
  placeholder: '새 일을 시작하기 전 무엇을 살필까요?',
  helper: '상황과 고민을 구체적으로 적어 주세요.\n비워 두셔도 됩니다. 최대 200자.',
  howtoTitle: '동전 던지는 법',
  howto: {
    shake: '폰을 흔들다가 가볍게 털어 주세요.\n버튼을 눌러도 던질 수 있습니다.',
    touch: '버튼을 꾹 눌러 흔들고 놓으세요.\n한 번만 눌러도 던질 수 있습니다.',
    mouse: '버튼이나 판을 꾹 눌렀다 놓으세요.\n스페이스 키로도 던질 수 있습니다.',
  },
  cta: { withQuestion: '이 물음으로 시작하기', empty: '마음속 물음으로 시작하기' },
  skip: '물음 없이 시작하기',
  iosHint: '시작 시 동작 접근 허용을 묻습니다.',
  privacy: '물음은 공유 링크에 담기지 않습니다.',
  hud: {
    mark: '問',
    empty: '눌러서 물음을 적으세요',
    hint: {
      shake: '흔들다 가볍게 털어 주세요',
      touch: '꾹 눌렀다 놓으세요',
      mouse: '꾹 눌렀다 놓거나 스페이스 키를 누르세요',
    },
  },
  titleAgain: '물음을 다시 살펴보세요',
};
const Q_MAX = 200;

const els = {
  topbar: $('#topbar'),
  menuBtn: $('#menu-btn'),
  menu: $('#menu'),
  soundBtn: $('#sound-btn'),
  shakeToggle: $('#shake-toggle'),
  motionAllow: $('#motion-allow'),
  askLine: $('#ask-line'),
  askText: $('#ask-line .ask-text'),
  askSr: $('#ask-line .ask-sr'),
  menuManual: $('#menu-manual'),
  menuCoach: $('#menu-coach'),
  infoOpen: $('#info-open'),
  qModal: $('#question-modal'),
  qCard: $('#question-modal .qm-card'),
  qBody: $('#question-modal .qm-body'),
  qTitle: $('#qm-title'),
  qLead: $('#qm-lead'),
  qInput: $('#question-input'),
  qHelper: $('#qm-helper'),
  qCount: $('#qm-count'),
  qHowto: $('#qm-howto'),
  qHowtoTitle: $('#qm-howto-title'),
  qHowtoText: $('#qm-howto-text'),
  qStart: $('#qm-start'),
  qSkip: $('#qm-skip'),
  qIos: $('#qm-ios'),
  qPrivacy: $('#qm-privacy'),
  hud: $('#hud'),
  ladder: $('#ladder'),
  toast: $('#coin-toast'),
  throwBtn: $('#throw-btn'),
  throwYao: $('#throw-yao'),
  throwLabel: $('#throw-btn .throw-label'),
  throwCount: $('#throw-count'),
  throwHint: $('#throw-hint'),
  chargeBar: $('#charge-bar'),
  hudManual: $('#hud-manual'),
  noStageBtn: $('#nostage-btn'),
  resultSource: $('#result-source'),
  manualPanel: $('#manual-panel'),
  viewResultBtn: $('#view-result-btn'),
  resultModal: $('#result-modal'),
  sheet: $('#result-modal .sheet'),
  resultTitle: $('#result-title'),
  modalCloseBtn: $('#modal-close-btn'),
  resultQuestion: $('#result-question'),
  rqText: $('#result-question .rq-text'),
  guaPair: $('#gua-pair'),
  guaArrow: $('#gua-arrow'),
  guaChanged: $('#gua-changed'),
  resultHexVisual: $('#result-hex-visual'),
  resultName: $('#result-name'),
  resultFullName: $('#result-full-name'),
  resultKeyword: $('#result-keyword'),
  resultJudgment: $('#result-judgment'),
  resultImage: $('#result-image'),
  resultChanging: $('#result-changing'),
  changedHexVisual: $('#changed-hex-visual'),
  changedName: $('#changed-name'),
  changedFullName: $('#changed-full-name'),
  changedKeyword: $('#changed-keyword'),
  changedJudgment: $('#changed-judgment'),
  changedImage: $('#changed-image'),
  resultJudge: $('#result-judge'),
  judgeRule: $('#judge-rule'),
  judgeDesc: $('#judge-desc'),
  judgeTexts: $('#judge-texts'),
  newReadingBtn: $('#new-reading-btn'),
  shareBtn: $('#share-btn'),
  infoBtn: $('#info-btn'),
  infoPanel: $('#info-panel'),
  infoCard: $('#info-panel .info-card'),
  infoCloseBtn: $('#info-close-btn'),
  resultAsk: $('#result-ask'),
  askThread: $('#ask-thread'),
  askExamples: $('#ask-examples'),
  askInput: $('#ask-input'),
  askSendBtn: $('#ask-send-btn'),
  askLive: $('#ask-live'),
};

const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = () => window.matchMedia && matchMedia('(pointer: fine)').matches;
const coarsePointer = () => window.matchMedia && matchMedia('(pointer: coarse)').matches;

let askHistory = [];
let askGen = 0; // 점괘(결과)마다 올라가는 세대 번호: 지난 점괘의 늦은 답은 버린다
let askCtrl = null; // 진행 중인 묻기 요청(새 점괘로 바뀌면 취소)
let askBusy = false;
let lastResult = null; // { primary, changed, lines, interpretation, manual? }
let intent = ''; // 점치기 전 품은 물음(결과를 만들 때 질문 칸에서 읽는다)
let infoReturnFocus = null;
let motionOn = false; // 폰 흔들기 감지가 실제로 들어오는 기기
let shakeEnabled = true;
try { shakeEnabled = localStorage.getItem('iching.shake') !== '0'; } catch (e) { /* 저장소 차단 */ }
let lastThrowState = null;
// iOS 동작 권한: none(필요 없음·허용됨) / prompt(아직 안 물음·실패해 다시 물을 수 있음) / denied(거부함)
let motionPermission = 'none';
let motionRetryFailed = false;
let questionLocked = false; // 결과가 있는 동안 물음 잠금
let uiHandlers = null; //      initUI 가 받은 main 쪽 처리기
const overlayListeners = [];
/** 메뉴·창이 열리거나 닫힐 때 알림(누르고 흔들던 상태를 정리하는 데 쓴다) */
export function onOverlayChange(fn) { overlayListeners.push(fn); }
const notifyOverlay = () => overlayListeners.forEach((fn) => fn());

/* ---------------- 상단 바 · 메뉴 ---------------- */

export function showTopbar() { els.topbar.hidden = false; }

function syncMenuState() {
  els.soundBtn.setAttribute('aria-checked', String(!isMuted()));
  els.soundBtn.querySelector('.menu-state').textContent = isMuted() ? '꺼짐' : '켜짐';
  els.shakeToggle.hidden = !motionOn || !coarsePointer();
  els.motionAllow.hidden = motionOn || motionPermission === 'none';
  els.motionAllow.firstChild.textContent = motionPermission === 'denied' ? '흔들기 다시 허용' : '폰 흔들어 던지기 켜기';
  els.motionAllow.querySelector('.menu-state').textContent = motionPermission === 'denied' && motionRetryFailed ? '설정에서 허용' : '';
  els.shakeToggle.setAttribute('aria-checked', String(shakeEnabled));
  els.shakeToggle.querySelector('.menu-state').textContent = shakeEnabled ? '켜짐' : '꺼짐';
  // 결과가 있는 동안은 물음 창을 열 수 없으므로 '던지는 법'도 숨긴다(다시 점치면 돌아온다)
  els.menuCoach.hidden = questionLocked;
}

function menuItems() {
  return [...els.menu.querySelectorAll('.menu-item')].filter((b) => !b.hidden);
}

function openMenu() {
  syncMenuState();
  els.menu.hidden = false;
  els.menuBtn.setAttribute('aria-expanded', 'true');
  syncInert();
  requestAnimationFrame(() => { const f = menuItems()[0]; if (f) f.focus({ preventScroll: true }); });
}

function closeMenu(restore = true) {
  if (els.menu.hidden) return;
  // 바깥을 눌러 닫더라도 초점이 메뉴 안(곧 숨을 항목)에 있었다면 메뉴 단추로 되돌린다
  const focusInside = els.menu.contains(document.activeElement);
  els.menu.hidden = true;
  els.menuBtn.setAttribute('aria-expanded', 'false');
  if (restore || focusInside) els.menuBtn.focus({ preventScroll: true });
  syncInert();
}

/* ---------------- 겹쳐 뜨는 창과 배경 잠금(inert) ---------------- */

const isOpen = (el) => el && !el.hidden;

/**
 * 맨 위에 뜬 창 아래는 모두 inert: 안내창 > 직접 고르기 > 결과 > 바탕(상단 바·던지기 화면)
 * 물음 창은 다른 창이 모두 닫힌 뒤에만 뜨고, 떠 있는 동안 바탕을 잠근다. 열고 닫을 때마다 부른다.
 */
export function syncInert() {
  const info = isOpen(els.infoPanel);
  const manual = isOpen(els.manualPanel);
  const sheet = isOpen(els.resultModal);
  const menu = isOpen(els.menu);
  const question = isQuestionOpen();
  const setInert = (el, on) => { if (!el) return; if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert'); };
  [els.topbar, els.hud].forEach((el) => setInert(el, info || manual || sheet || question));
  if (menu && !(info || manual || sheet)) setInert(els.hud, true);
  setInert(els.resultModal, info || manual);
  setInert(els.manualPanel, info);
  notifyOverlay();
}

/** 어떤 창이든 떠 있으면 true(던지기·자동 초점 보류) */
export function anyOverlayOpen() {
  return isOpen(els.infoPanel) || isOpen(els.manualPanel) || isOpen(els.resultModal) || isOpen(els.menu) || isQuestionOpen();
}

/** 물음 창이 떠 있는지(닫히는 짧은 애니메이션 동안은 이미 닫힌 것으로 본다) */
export function isQuestionOpen() {
  return !els.qModal.hidden && !els.qModal.classList.contains('is-closing');
}

export function isShakeEnabled() { return shakeEnabled; }
export function isInfoOpen() { return !els.infoPanel.hidden; }

/**
 * iOS 동작 권한 상태를 메뉴에 반영한다.
 * @param {'none'|'prompt'|'denied'} state
 * @param {boolean} [retryFailed] 메뉴에서 다시 허용을 눌렀는데도 거부로 돌아왔는지(브라우저 설정에서 허용해야 함)
 */
export function setMotionPermission(state, retryFailed = false) {
  motionPermission = state;
  motionRetryFailed = retryFailed;
  syncMenuState();
}

/** 흔들기 감지가 들어오기 시작하면 주 버튼 이름을 '흔들어 던지기'로 */
export function setMotionAvailable(on) {
  motionOn = !!on;
  syncMenuState();
  if (lastThrowState) setThrowState(lastThrowState);
}

/** 흔들어 모은 기운(0~1)을 던지기 버튼 윗선에 보여 준다 */
export function setCharge(energy) {
  const e = Math.max(0, Math.min(1, energy));
  els.chargeBar.style.transform = `scaleX(${e})`;
  els.throwBtn.classList.toggle('is-charging', e > 0.04);
}

/** 던지기 화면(인트로 바로 다음의 한 장) */
export function showHud() {
  els.hud.hidden = false;
  syncInert();
}

/* ---------------- 물음 창 ----------------
 * 인트로가 끝나면, 다시 점칠 때, 위쪽 물음 줄·메뉴의 '던지는 법'을 누를 때 뜬다.
 * 물음(선택, 200자)은 결과·問占 맥락(intent)으로 이어진다. 주 버튼·건너뛰기 누름(사용자 활성화) 안에서
 * main 이 소리 잠금 해제와 iOS 동작 권한 요청을 동기로 한다(onQuestionDone).
 */

/** 품은 물음(선택). 결과·問占 맥락(intent)으로 이어진다 */
export function getQuestion() { return els.qInput.value.trim().slice(0, Q_MAX); }

/** 결과가 있는 동안 물음을 잠근다(위쪽 줄은 점선·옅은 글씨, 눌러도 창이 열리지 않음). 다시 점치기에서 풀린다 */
function lockQuestion(on) {
  questionLocked = on;
  els.qInput.readOnly = on;
  syncAskLine();
  syncMenuState();
}

/** 던지기 화면 위쪽 한 줄: 물음이 있으면 問 + 물음(넘치면 말줄임), 없으면 적으라는 안내 */
function syncAskLine() {
  const q = getQuestion();
  els.askLine.classList.toggle('has-q', !!q);
  els.askLine.classList.toggle('is-locked', questionLocked);
  els.askLine.setAttribute('aria-disabled', questionLocked ? 'true' : 'false');
  els.askLine.title = questionLocked ? '이 점괘의 물음입니다. 다시 점치면 고칠 수 있습니다.' : '';
  // 결과가 있는데 물음이 없으면 줄 자체를 감춘다(적으라는 안내가 거짓이 되므로)
  els.askLine.hidden = questionLocked && !q;
  els.askSr.textContent = q ? '물음: ' : '';
  els.askText.textContent = q || QCOPY.hud.empty;
}

/** 창 안의 글자 수·주 버튼 이름·던지는 법(기기별)·iOS 안내를 지금 상태에 맞춘다 */
function syncQuestionUI() {
  const len = els.qInput.value.length;
  els.qCount.textContent = `${len}/${Q_MAX}`;
  els.qCount.classList.toggle('is-full', len >= Q_MAX);
  els.qStart.textContent = els.qInput.value.trim() ? QCOPY.cta.withQuestion : QCOPY.cta.empty;
  const how = (uiHandlers && uiHandlers.getHowto && uiHandlers.getHowto()) || { mode: finePointer() ? 'mouse' : 'touch', ios: false };
  const mode = QCOPY.howto[how.mode] ? how.mode : 'touch';
  els.qHowto.dataset.mode = mode;
  els.qHowtoText.textContent = QCOPY.howto[mode];
  els.qIos.hidden = !how.ios;
}

/** 권한·센서 상태가 바뀌면 떠 있는 창의 던지는 법을 맞춘다 */
export function refreshQuestionHowto() { if (isQuestionOpen()) syncQuestionUI(); }

/* 모바일 키보드: 창을 보이는 영역(visualViewport)에 맞춰 버튼이 키보드에 가리지 않게 한다 */
function fitQuestionViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const wrap = els.qModal;
  wrap.style.setProperty('--qm-top', `${Math.max(0, vv.offsetTop)}px`);
  wrap.style.setProperty('--qm-h', `${vv.height}px`);
  // 보이는 높이가 창 높이보다 크게 줄면(키보드) 작은 안내를 접어 버튼 자리를 넓힌다
  wrap.classList.toggle('is-typing', vv.height < window.innerHeight - 120);
  if (document.activeElement === els.qInput) {
    const b = els.qBody;
    const r = els.qInput.getBoundingClientRect(), br = b.getBoundingClientRect();
    if (r.bottom > br.bottom) b.scrollTop += r.bottom - br.bottom + 12;
    else if (r.top < br.top) b.scrollTop -= br.top - r.top + 12;
  }
}
function watchQuestionViewport(on) {
  const vv = window.visualViewport;
  if (!vv) return;
  if (on) {
    vv.addEventListener('resize', fitQuestionViewport);
    vv.addEventListener('scroll', fitQuestionViewport);
    fitQuestionViewport();
  } else {
    vv.removeEventListener('resize', fitQuestionViewport);
    vv.removeEventListener('scroll', fitQuestionViewport);
    els.qModal.style.removeProperty('--qm-top');
    els.qModal.style.removeProperty('--qm-h');
    els.qModal.classList.remove('is-typing');
  }
}

let qmHideTimer = 0;
let qmEditing = false; // 고치기로 연 창(위쪽 물음 줄·메뉴 '던지는 법'): Esc·바깥 누르기는 취소
let qmOriginal = ''; //   고치기로 열 때의 물음(취소하면 되돌린다)

/**
 * 물음 창을 연다. 결과가 있는 동안(잠김)에는 열지 않는다.
 * @param {{ again?: boolean, entering?: boolean, focusField?: boolean }} [o]
 *   again: 다시 점치기(제목이 바뀐다) / entering: 인트로에서 이어지는 첫 등장(조금 더 길게 떠오른다)
 *   edit: 이미 시작한 뒤 물음을 고치려고 연 경우. Esc·바깥 누르기는 고친 내용을 버리고 원래 물음 그대로 닫는다
 *         (인트로 직후·다시 점치기 창에서 Esc 는 건너뛰기와 같다)
 *   focusField: 열자마자 입력칸에 초점(기본: 마우스 기기만. 터치 기기는 키보드가 저절로 뜨지 않게 제목에)
 * @returns {boolean} 열었으면 true
 */
export function openQuestion({ again = false, entering = false, edit = false, focusField } = {}) {
  if (questionLocked || isQuestionOpen()) return false;
  qmEditing = !!edit;
  qmOriginal = els.qInput.value;
  clearTimeout(qmHideTimer);
  const wrap = els.qModal;
  els.qTitle.textContent = again ? QCOPY.titleAgain : QCOPY.title;
  syncQuestionUI();
  wrap.classList.remove('is-closing');
  wrap.classList.toggle('is-entering', !!entering);
  wrap.hidden = false;
  els.qBody.scrollTop = 0;
  syncInert();
  watchQuestionViewport(true);
  const toField = focusField === undefined ? finePointer() : focusField;
  requestAnimationFrame(() => {
    if (!isQuestionOpen()) return;
    if (toField) {
      els.qInput.focus({ preventScroll: true });
      const n = els.qInput.value.length;
      els.qInput.setSelectionRange(n, n);
    } else {
      els.qTitle.focus({ preventScroll: true });
    }
  });
  return true;
}

/**
 * 물음 창을 닫고 던지기 화면으로. 주 버튼·Enter 는 적은 물음 그대로, 건너뛰기·Esc 는 물음 없이.
 * 고치기 창의 Esc·바깥 누르기는 취소(cancel): 고친 내용을 버리고 원래 물음 그대로.
 * @param {'start'|'enter'|'skip'|'esc'|'cancel'} how
 */
function closeQuestion(how) {
  if (!isQuestionOpen()) return;
  const wrap = els.qModal;
  if (how === 'cancel') els.qInput.value = qmOriginal;
  else if (how === 'skip' || how === 'esc') els.qInput.value = '';
  els.qInput.value = els.qInput.value.slice(0, Q_MAX);
  syncAskLine();
  // 사용자 활성화가 살아 있는 동안(같은 click·keydown 안에서) 소리·iOS 권한을 처리한다
  if (uiHandlers && uiHandlers.onQuestionDone) uiHandlers.onQuestionDone({ how, question: getQuestion() });
  wrap.classList.add('is-closing');
  watchQuestionViewport(false);
  if (wrap.contains(document.activeElement)) document.activeElement.blur();
  syncInert(); // 닫히는 애니메이션 동안에도 바탕은 바로 조작된다
  if (uiHandlers && uiHandlers.onQuestionClosed) uiHandlers.onQuestionClosed();
  const done = () => {
    if (!wrap.classList.contains('is-closing')) return;
    wrap.hidden = true;
    wrap.classList.remove('is-closing', 'is-entering');
  };
  // 동작 줄이기에서도 짧게 옅어지며 닫힌다(CSS 가 움직임만 뺀다)
  qmHideTimer = later(done, 220);
}

/* ---------------- 효 사다리 ---------------- */

function buildLadder() {
  els.ladder.innerHTML = '';
  YAO_NAMES.forEach((name, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="yao-name hanja" aria-hidden="true">${name}</span><span class="yao-bar"></span><span class="yao-mark hanja" aria-hidden="true"></span><span class="sr-only">${YAO_KO[i]}: 아직</span>`;
    els.ladder.appendChild(li);
  });
}

export function updateLadder(lines) {
  const items = els.ladder.children;
  for (let i = 0; i < items.length; i++) {
    const li = items[i];
    const l = lines[i];
    li.classList.toggle('is-current', i === lines.length && lines.length < 6);
    const bar = li.querySelector('.yao-bar');
    const mark = li.querySelector('.yao-mark');
    const sr = li.querySelector('.sr-only');
    if (l) {
      if (!li.classList.contains('is-filled')) {
        li.classList.add('is-filled');
        li.classList.toggle('yang', l.yang);
        li.classList.toggle('yin', !l.yang);
        li.classList.toggle('changing', l.changing);
        bar.innerHTML = l.yang ? '<i class="seg"></i>' : '<i class="seg"></i><i class="seg"></i>';
        // 전통 표기: 老陽 ○, 老陰 ×
        mark.textContent = l.changing ? (l.value === 9 ? '○' : '×') : '';
        sr.textContent = `${YAO_KO[i]}: ${LINE_KO[l.value]}${l.changing ? '(변효)' : ''}`;
      }
    } else {
      li.className = i === lines.length ? 'is-current' : '';
      bar.innerHTML = '';
      mark.textContent = '';
      sr.textContent = `${YAO_KO[i]}: 아직`;
    }
  }
}

/* ---------------- 주 동작(던지기 버튼) ---------------- */

/**
 * @param {{ index:number, loading?:boolean, rolling?:boolean, holding?:boolean, done?:boolean,
 *           noStage?:boolean, offerNoStage?:boolean, manual?:boolean, retry?:boolean }} s
 */
export function setThrowState(s) {
  lastThrowState = s;
  const i = Math.min(s.index, 5);
  els.throwYao.textContent = YAO_NAMES[i];
  els.throwCount.textContent = `${i + 1}/6`;
  if (s.done) {
    els.throwBtn.hidden = true;
    els.viewResultBtn.hidden = false;
    els.noStageBtn.hidden = true;
    els.hudManual.hidden = true;
    const doneHint = s.manual ? '직접 고른 여섯 효로 괘를 세웠습니다' : '여섯 효가 모두 섰습니다';
    if (els.throwHint.textContent !== doneHint) els.throwHint.textContent = doneHint;
    return;
  }
  els.throwBtn.hidden = false;
  els.viewResultBtn.hidden = true;
  els.hudManual.hidden = false;
  // 물리 판이 오래 늦으면 공정한 난수로 '판 없이 던지기'를 함께 내민다
  els.noStageBtn.hidden = !s.offerNoStage || !!s.rolling;
  // 굴러가는 동안은 초점을 잃지 않도록 disabled 대신 aria-disabled(누름은 main 이 무시한다)
  els.throwBtn.disabled = !!s.loading;
  els.throwBtn.setAttribute('aria-disabled', s.rolling ? 'true' : 'false');
  els.throwBtn.setAttribute('aria-busy', s.loading ? 'true' : 'false');
  els.throwBtn.classList.toggle('is-holding', !!s.holding);
  let label;
  // 버튼 근처 한 줄(기기별 던지는 법). 판 없이 던지기·다시 던지기 안내가 있으면 그것을 대신 보인다
  let hint;
  if (s.loading) label = '판을 펴는 중';
  else if (s.rolling) label = '동전이 구르는 중';
  else if (s.holding) label = '놓으면 던져집니다';
  else if (s.noStage) label = '동전 던지기';
  const shakeMode = motionOn && shakeEnabled && coarsePointer();
  if (!label) {
    // 실제 인식 조건: 흔들어 기운을 모은 뒤 한 번 크게 털고 멈추면 던진다. 버튼은 그대로 쓸 수 있다
    // (가속도계가 있는 노트북처럼 마우스를 쓰는 기기에는 흔들기 이름을 쓰지 않는다)
    if (shakeMode) label = '흔들어 던지기';
    else if (finePointer()) label = '눌러서 흔들고, 놓아 던지기';
    else label = '눌러 흔들고 놓아 던지기';
  }
  if (s.retry === 'outside') hint = '동전이 판 밖으로 나갔습니다. 이 효를 다시 던져 주세요.';
  else if (s.retry) hint = '동전이 자리를 잡지 못했습니다. 이 효를 다시 던져 주세요.';
  else if (s.noStage) hint = '3D 판을 열 수 없어 판 없이 던집니다';
  else hint = QCOPY.hud.hint[shakeMode ? 'shake' : finePointer() ? 'mouse' : 'touch'];
  els.throwLabel.textContent = label;
  // 같은 글이면 다시 쓰지 않는다(aria-live 가 같은 안내를 되풀이해 읽지 않게)
  if (els.throwHint.textContent !== hint) els.throwHint.textContent = hint;
}

export function focusThrow() {
  if (anyOverlayOpen()) return; // 창이 떠 있으면 배경 버튼에 초점을 옮기지 않는다
  if (!els.throwBtn.hidden && !els.throwBtn.disabled) els.throwBtn.focus({ preventScroll: true });
}

export function focusViewResult() {

  if (anyOverlayOpen()) return;
  if (!els.viewResultBtn.hidden) els.viewResultBtn.focus({ preventScroll: true });
}

/* ---------------- 동전 결과 알림 ---------------- */

/**
 * @param {{ shaken?: boolean, noStage?: boolean }} how 어떻게 던졌는지(작게 표시)
 */
export function showCoinToast(result, index, how = {}) {
  const dots = result.coins
    .map((h) => `<span class="coin-dot hanja ${h ? 'yang' : 'yin'}" aria-hidden="true">${h ? '陽' : '陰'}</span>`)
    .join('');
  const heads = result.coins.filter(Boolean).length;
  const sr = `${YAO_KO[index]}: 앞면 ${heads}, 뒷면 ${3 - heads}. 합 ${result.value}, ${LINE_KO[result.value]}${result.changing ? ', 변효' : ''}`;
  els.toast.innerHTML =
    `<div class="toast-inner">${dots}` +
    `<span class="toast-name hanja${result.changing ? ' changing' : ''}" aria-hidden="true">${LINE_HANJA[result.value]}</span>` +
    `<span class="toast-sum" aria-hidden="true">${NUM_HANJA[result.value]} · ${LINE_KO[result.value]}</span>` +
    (how.shaken ? '<span class="toast-how">흔들어 던짐</span>' : how.noStage ? '<span class="toast-how">판 없이</span>' : '') +
    `<span class="sr-only">${sr}</span></div>`;
}

export function clearCoinToast() { els.toast.innerHTML = ''; }

/** 동전이 제한 시간 안에 자리를 잡지 못했을 때: 이 효는 기록하지 않고 다시 던진다 */
export function showRetryToast() {
  els.toast.innerHTML = '<div class="toast-inner"><span class="toast-retry">동전이 자리를 잡지 못했습니다. 다시 던져 주세요.</span></div>';
}

export function resetHud() {
  buildLadder();
  updateLadder([]);
  clearCoinToast();
}

/* ---------------- 결과 ---------------- */

function createLineElement(yang, changing = false, value = 0) {
  const div = document.createElement('div');
  div.className = `hex-line ${yang ? 'yang' : 'yin'}${changing ? ' changing' : ''}`;
  const segs = yang
    ? '<span class="segment"></span>'
    : '<span class="segment"></span><span class="segment"></span>';
  const marker = changing ? `<span class="change-marker hanja">${value === 9 ? '老陽' : '老陰'}</span>` : '';
  div.innerHTML = segs + marker;
  return div;
}

function setHanjaName(el, hanja) {
  el.textContent = hanja;
  el.classList.toggle('is-long', hanja.length > 1);
}

/**
 * 결과 두루마리 열기
 * @param {{ primary, changed, lines, interpretation }} r
 */
export function showResult(r) {
  if (r !== lastResult) prepareResult(r);
  openSheet();
}

/** 결과를 미리 그려 둔다(시트는 열지 않음). 새 점괘면 묻기 대화를 새로 시작한다 */
export function prepareResult(r) {
  if (r === lastResult) return;
  lastResult = r;
  newAskGeneration();
  // 결과를 만든 순간의 물음을 결과에 고정한다(다시 열거나 묻기를 해도 같은 물음). 결과가 있는 동안 질문 칸은 잠근다
  if (r.intent === undefined) r.intent = r.fromLink ? '' : getQuestion();
  intent = r.intent;
  lockQuestion(true);
  const { primary, changed, lines, interpretation } = r;
  els.resultSource.hidden = !r.manual;

  els.resultQuestion.hidden = !intent;
  els.rqText.textContent = intent ? `「${intent}」` : '';

  els.resultHexVisual.innerHTML = '';
  lines.forEach((l) => els.resultHexVisual.appendChild(createLineElement(l.yang, l.changing, l.value)));
  setHanjaName(els.resultName, primary.hanja);
  els.resultFullName.textContent = `${primary.name} · ${primary.fullName}`;
  els.resultKeyword.textContent = primary.keyword;
  els.resultJudgment.textContent = primary.judgment;
  els.resultImage.textContent = primary.image;
  els.resultTitle.textContent = `점괘 결과: 본괘 ${primary.fullName}${changed ? `, 지괘 ${changed.fullName}` : ''}`;

  els.guaPair.classList.toggle('is-single', !changed);
  els.guaArrow.hidden = !changed;
  els.guaChanged.hidden = !changed;
  els.resultChanging.hidden = !changed;
  if (changed) {
    els.changedHexVisual.innerHTML = '';
    lines.forEach((l) => els.changedHexVisual.appendChild(createLineElement(l.changing ? !l.yang : l.yang)));
    setHanjaName(els.changedName, changed.hanja);
    els.changedFullName.textContent = `${changed.name} · ${changed.fullName}`;
    els.changedKeyword.textContent = changed.keyword;
    els.changedJudgment.textContent = changed.judgment;
    els.changedImage.textContent = changed.image;
  }

  renderInterpretation(interpretation);
  resetAsk();
  els.viewResultBtn.hidden = false;
  els.throwBtn.hidden = true;
}

function renderInterpretation(interp) {
  els.resultJudge.hidden = !interp;
  if (!interp) return;
  els.judgeRule.textContent = interp.rule;
  els.judgeDesc.textContent = interp.ruleDesc;
  els.judgeTexts.innerHTML = '';
  interp.texts.forEach((t) => {
    const div = document.createElement('div');
    div.className = `judge-yao${t.isPrimary ? ' primary' : ''}`;
    const head = document.createElement('div');
    head.className = 'yao-head';
    head.innerHTML =
      `<span class="yao-pos"></span><span class="yao-src"></span>` +
      (t.isPrimary ? '<span class="seal yao-main hanja" title="위주로 보는 글">主</span>' : '');
    head.querySelector('.yao-pos').textContent = t.position;
    head.querySelector('.yao-src').textContent = t.source;
    const p = document.createElement('p');
    p.className = 'yao-text';
    p.textContent = t.text;
    div.append(head, p);
    els.judgeTexts.appendChild(div);
  });
}

function openSheet() {
  const wrap = els.resultModal;
  const wasOpen = !wrap.hidden;
  wrap.hidden = false;
  syncInert();
  els.sheet.querySelector('.sheet-scroll').scrollTop = 0;
  requestAnimationFrame(() => {
    wrap.classList.add('is-open');
    els.resultTitle.setAttribute('tabindex', '-1');
    els.resultTitle.focus({ preventScroll: true });
  });
  if (!wasOpen) history.pushState({ iching: 'result' }, '');
}

function hideSheetNow() {
  const wrap = els.resultModal;
  if (wrap.hidden) return;
  abortAsk();
  closeInfo();
  wrap.classList.remove('is-open');
  const done = () => { if (!wrap.classList.contains('is-open')) { wrap.hidden = true; syncInert(); } };
  if (reduceMotion()) done(); else setTimeout(done, 520);
  // 시트가 닫히는 동안에도 배경이 바로 조작되도록 inert 를 먼저 푼다
  [els.topbar, els.hud].forEach((el) => el.removeAttribute('inert'));
  if (!els.viewResultBtn.hidden) els.viewResultBtn.focus({ preventScroll: true });
}

/** 닫기 버튼·배경·Esc: 뒤로가기 기록과 맞춰 닫는다 */
export function closeResult() {
  if (els.resultModal.hidden) return;
  if (history.state && history.state.iching === 'result') history.back();
  else hideSheetNow();
}

export function isResultOpen() { return !els.resultModal.hidden; }

/* ---------------- 점법 안내 ---------------- */

function openInfo() {
  infoReturnFocus = document.activeElement;
  els.infoPanel.hidden = false;
  syncInert();
  requestAnimationFrame(() => els.infoCloseBtn.focus({ preventScroll: true }));
}

function closeInfo() {
  if (els.infoPanel.hidden) return;
  els.infoPanel.hidden = true;
  syncInert();
  if (infoReturnFocus && infoReturnFocus.isConnected) infoReturnFocus.focus({ preventScroll: true });
}

/* ---------------- 問占 ---------------- */

/**
 * @param {string} label 칩 글(텍스트로만 넣는다)
 * @param {string} [mark] 앞에 붙는 한자 표식(장식)
 */
function makeChip(label, onClick, extra = '', mark = '') {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = `ask-chip${extra ? ' ' + extra : ''}`;
  if (mark) {
    const m = document.createElement('span');
    m.className = 'hanja';
    m.setAttribute('aria-hidden', 'true');
    m.textContent = mark;
    chip.appendChild(m);
  }
  chip.appendChild(document.createTextNode(label));
  chip.addEventListener('click', () => onClick(chip));
  els.askExamples.appendChild(chip);
  return chip;
}

/** 새 점괘: 진행 중인 묻기를 취소하고 세대를 올린다(늦게 온 답은 버려진다) */
function newAskGeneration() {
  askGen++;
  if (askCtrl) askCtrl.abort();
  askCtrl = null;
  askBusy = false;
}

/** 시트를 닫을 때: 받던 풀이를 멈춘다(같은 점괘라 받은 부분은 남기고 '멈춤' 표시) */
function abortAsk() {
  if (askCtrl) askCtrl.abort();
}

function resetAsk() {
  els.resultAsk.hidden = !ASK_ENABLED;
  if (!ASK_ENABLED) return;
  els.askThread.innerHTML = '';
  els.askInput.value = '';
  els.askSendBtn.disabled = false;
  askHistory = [];
  els.askExamples.innerHTML = '';

  if (intent) {
    // 품은 물음이 있으면 첫 칩은 그 물음에 대한 풀이를 바로 청한다(물음 원문은 서버 맥락 intent 로 간다)
    makeChip('품은 질문에 대한 풀이 보기', (chip) => {
      if (askBusy) return;
      if (askSend('품은 질문에 대해 이 점괘를 풀이해 주세요.')) chip.remove();
    }, 'ask-chip--intent', '問');
  } else {
    makeChip(ASK_GENERIC_FIRST, () => fillAsk(ASK_GENERIC_FIRST));
  }
  ASK_EXAMPLES.forEach((q) => makeChip(q, () => fillAsk(q)).setAttribute('data-q', q));
}

function fillAsk(q) {
  els.askInput.value = q;
  els.askInput.focus();
}

function appendTurn(role, text, extraClass = '') {
  const turn = document.createElement('div');
  turn.className = `ask-turn ${role}${extraClass ? ' ' + extraClass : ''}`;
  const p = document.createElement('p');
  p.textContent = text;
  turn.appendChild(p);
  els.askThread.appendChild(turn);
  return p;
}

function hexPayload(h) {
  return h && {
    number: h.number, name: h.name, hanja: h.hanja, fullName: h.fullName,
    keyword: h.keyword, judgment: h.judgment, image: h.image,
  };
}

/** @returns {boolean} 실제로 보냈으면 true */
function askSend(preset) {
  if (!ASK_ENABLED || !lastResult || askBusy) return false;
  const question = (preset || els.askInput.value).trim();
  if (!question) { els.askInput.focus(); return false; }
  runAsk(question, !!preset);
  return true;
}

async function runAsk(question, preset) {
  const gen = askGen;
  const ctrl = new AbortController();
  askCtrl = ctrl;
  askBusy = true;

  appendTurn('user', question);
  if (!preset) els.askInput.value = '';
  els.askSendBtn.disabled = true;
  const chip = els.askExamples.querySelector(`.ask-chip[data-q="${CSS.escape(question)}"]`);
  if (chip) chip.remove();

  const botP = appendTurn('bot', '괘를 읽는 중입니다', 'loading');
  botP.parentElement.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });

  const { primary, changed, lines, interpretation } = lastResult;
  const payload = {
    question,
    history: askHistory.slice(-10),
    // 서버는 이 번호·변효 자리만 믿고 괘사·효사는 자기 데이터로 다시 만든다
    reading: {
      primary: primary.number,
      changing: lines.map((l, i) => (l.changing ? i : -1)).filter((i) => i >= 0),
    },
    // 예전 람다(번호만 읽지 않던 버전)와의 호환용. 새 람다는 이 글을 쓰지 않는다
    hexagram: {
      primary: hexPayload(primary),
      changed: hexPayload(changed),
      interpretation: interpretation && {
        count: interpretation.count, rule: interpretation.rule, ruleDesc: interpretation.ruleDesc,
        texts: (interpretation.texts || []).map((t) => ({
          position: t.position, text: t.text, source: t.source, isPrimary: !!t.isPrimary,
        })),
      },
    },
  };
  if (intent) payload.intent = intent;
  payload.stream = true; // 새 람다는 글이 오는 대로 NDJSON 으로 흘려 준다(예전 람다는 무시하고 JSON)

  const turn = botP.parentElement;
  turn.setAttribute('aria-busy', 'true');
  const scroller = els.sheet.querySelector('.sheet-scroll');
  const stale = () => gen !== askGen;
  let shown = ''; // 화면에 보인 글(오류가 나도 남긴다)
  let outcome;

  try {
    const r = await fetch(ASK_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const ctype = (r.headers.get('content-type') || '').toLowerCase();
    if (r.ok && r.body && ctype.includes('ndjson')) {
      outcome = await readAskStream(r.body, {
        stale,
        onText: (full) => {
          shown = full;
          paintAnswer(turn, botP, full, scroller);
        },
      });
    } else {
      const data = await r.json().catch(() => ({}));
      outcome = r.ok && data.answer
        ? { answer: data.answer }
        : { error: data.error || '풀이를 받지 못했습니다. 잠시 뒤 다시 물어 주세요.' };
    }
  } catch (e) {
    outcome = e && e.name === 'AbortError'
      ? { error: '풀이 받기를 멈췄습니다.', aborted: true }
      : { error: '연결이 끊겼습니다. 네트워크를 확인한 뒤 다시 물어 주세요.' };
  }
  // 그 사이 새 점괘로 바뀌었으면 이 답은 버린다(기록·화면·버튼 모두 손대지 않음)
  if (stale() || outcome.stale) return;
  askBusy = false;
  if (askCtrl === ctrl) askCtrl = null;
  els.askSendBtn.disabled = false;
  if (paintFrame) { cancelAnimationFrame(paintFrame); paintFrame = 0; }
  turn.classList.remove('loading', 'streaming');
  turn.removeAttribute('aria-busy');
  if (outcome.answer) {
    botP.textContent = outcome.answer;
    askHistory.push({ role: 'user', content: question });
    askHistory.push({ role: 'assistant', content: outcome.answer });
    announce(outcome.answer);
  } else {
    // 받은 부분은 남기고 오류 표시를 덧붙인다
    const partial = outcome.partial || shown;
    if (partial) {
      botP.textContent = partial;
      const note = document.createElement('p');
      note.className = 'ask-turn-note';
      note.textContent = outcome.error;
      turn.appendChild(note);
      turn.classList.add('partial');
    } else {
      turn.classList.add('error');
      botP.textContent = outcome.error;
    }
    announce(outcome.error);
  }
}

/**
 * NDJSON 스트림 읽기: {"type":"start"} {"type":"delta","text"} … {"type":"done"} 또는 {"type":"error"}
 * @returns {Promise<{answer?:string, error?:string, partial?:string, stale?:boolean}>}
 */
async function readAskStream(body, { stale, onText }) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  const handle = (msg) => {
    if (msg.type === 'delta' && typeof msg.text === 'string') {
      text += msg.text;
      onText(text);
    } else if (msg.type === 'done') {
      return text.trim() ? { answer: text.trim() } : { error: '빈 답을 받았습니다. 다시 물어 주세요.' };
    } else if (msg.type === 'error') {
      return { error: msg.error || '풀이를 받지 못했습니다. 잠시 뒤 다시 물어 주세요.', partial: text };
    }
    return null;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (stale()) { reader.cancel().catch(() => {}); return { stale: true }; }
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        const end = handle(msg);
        if (end) { reader.cancel().catch(() => {}); return end; }
      }
    }
  } catch (e) {
    if (stale()) return { stale: true };
    if (e && e.name === 'AbortError') return { error: '풀이 받기를 멈췄습니다.', partial: text, aborted: true };
    return { error: '풀이를 받는 도중 연결이 끊겼습니다. 다시 물어 주세요.', partial: text };
  }
  return { error: '풀이를 받는 도중 연결이 끊겼습니다. 다시 물어 주세요.', partial: text };
}

/** 받은 글을 말풍선에 그린다. 읽느라 위로 올려 둔 사용자는 끌어내리지 않는다 */
let paintFrame = 0;
let paintArgs = null;
function paintAnswer(turn, p, full, scroller) {
  paintArgs = [turn, p, full, scroller];
  if (paintFrame) return;
  paintFrame = requestAnimationFrame(() => {
    paintFrame = 0;
    const [t, el, text, sc] = paintArgs;
    const nearBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 96;
    t.classList.remove('loading');
    t.classList.add('streaming');
    el.textContent = text;
    if (nearBottom) sc.scrollTop = sc.scrollHeight;
  });
}

/** 스크린 리더에는 다 받은 뒤 한 번만 알린다 */
function announce(text) {
  els.askLive.textContent = '';
  requestAnimationFrame(() => { els.askLive.textContent = text; });
}

/* ---------------- 공유 ---------------- */

async function shareResult() {
  if (!lastResult) return;
  const { primary, changed } = lastResult;
  // 품은 물음은 개인적인 내용이므로 링크에 넣지 않는다
  let url = `${location.origin}${location.pathname}?hex=${primary.number}`;
  if (changed) url += `&changed=${changed.number}`;
  const text = changed
    ? `${primary.hanja} ${primary.fullName}(${primary.keyword}) 에서 ${changed.hanja} ${changed.fullName}(${changed.keyword}) 로`
    : `${primary.hanja} ${primary.fullName}(${primary.keyword})`;

  if (navigator.share) {
    try { await navigator.share({ title: '주역 점괘', text, url }); } catch (e) { /* 사용자가 취소 */ }
    return;
  }
  let ok = false;
  try { await navigator.clipboard.writeText(url); ok = true; } catch (e) { ok = false; }
  els.shareBtn.textContent = ok ? '링크를 복사했습니다' : '복사하지 못했습니다';
  setTimeout(() => { els.shareBtn.textContent = '공유하기'; }, 1800);
}

/* ---------------- 키보드 · 초점 가두기 ---------------- */

function trapTab(container, e) {
  const f = [...container.querySelectorAll('button, textarea, [href], [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && !el.closest('[hidden]') && el.getClientRects().length);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus();
  }
}

/* ---------------- 이벤트 ---------------- */

function initQuestion() {
  els.qLead.textContent = QCOPY.lead;
  els.qInput.placeholder = QCOPY.placeholder;
  els.qHelper.textContent = QCOPY.helper;
  els.qHowtoTitle.textContent = QCOPY.howtoTitle;
  els.qSkip.textContent = QCOPY.skip;
  els.qIos.textContent = QCOPY.iosHint;
  els.qPrivacy.textContent = QCOPY.privacy;
  syncQuestionUI();
  syncAskLine();
  els.qInput.addEventListener('input', syncQuestionUI);
  // Enter 는 줄바꿈 대신 시작(Shift+Enter 는 줄바꿈). 한글 조합 중 Enter 는 조합 확정이라 건드리지 않는다
  els.qInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); closeQuestion('enter'); }
  });
  els.qStart.addEventListener('click', () => closeQuestion('start'));
  els.qSkip.addEventListener('click', () => closeQuestion('skip'));
  // 위쪽 물음 줄: 눌러서 고친다(결과가 있는 동안은 잠김)
  els.askLine.addEventListener('click', () => { if (!questionLocked) openQuestion({ edit: true, focusField: true }); });
  // 고치기 창은 바깥(가림막)을 누르면 취소된다. 처음 뜬 창·다시 점치기 창은 바깥 누르기로 닫히지 않는다
  els.qModal.querySelector('.qm-backdrop').addEventListener('click', () => { if (qmEditing) closeQuestion('cancel'); });
}

/**
 * @param {{ onThrowNoStage:()=>void, onManual:()=>void, onNewReading:()=>void, onViewResult:()=>void,
 *           onMotionAllow:()=>void,
 *           getHowto:()=>({ mode:'shake'|'touch'|'mouse', ios:boolean }),
 *           onQuestionDone:(r:{ how:'start'|'enter'|'skip'|'esc', question:string })=>void,
 *           onQuestionClosed:()=>void }} h
 *   getHowto: 물음 창의 던지는 법(기기별)과 iOS 권한 안내 여부
 *   onQuestionDone: 물음 창의 시작·건너뛰기 누름 안(사용자 활성화)에서 동기로 불린다
 *   onQuestionClosed: 창이 닫힌 직후(던지기 화면으로 초점을 옮긴다)
 */
export function initUI(h) {
  uiHandlers = h;
  buildLadder();
  syncMenuState();
  initQuestion();

  // 메뉴(소리·흔들기·직접 고르기·점법 안내)
  els.menuBtn.addEventListener('click', () => (els.menu.hidden ? openMenu() : closeMenu()));
  els.menu.addEventListener('keydown', (e) => {
    const items = menuItems();
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
    else if (e.key === 'Tab') closeMenu(false);
  });
  document.addEventListener('pointerdown', (e) => {
    if (els.menu.hidden || els.menu.contains(e.target) || els.menuBtn.contains(e.target)) return;
    const focusInside = els.menu.contains(document.activeElement);
    closeMenu(false);
    // 숨은 메뉴 항목에 초점이 있었다면, 바깥 누름의 기본 동작(본문으로 초점 이동)이 끝난 뒤 메뉴 단추로 되돌린다
    if (focusInside) setTimeout(() => { if (!anyOverlayOpen()) els.menuBtn.focus({ preventScroll: true }); }, 0);
  });
  els.soundBtn.addEventListener('click', () => { setMuted(!isMuted()); syncMenuState(); });
  els.shakeToggle.addEventListener('click', () => {
    shakeEnabled = !shakeEnabled;
    try { localStorage.setItem('iching.shake', shakeEnabled ? '1' : '0'); } catch (e) { /* 저장소 차단 */ }
    syncMenuState();
    if (lastThrowState) setThrowState(lastThrowState);
  });
  // 메뉴에서 연 창을 닫으면 초점이 (숨은 메뉴 항목이 아니라) 메뉴 단추로 돌아오도록, 먼저 메뉴 단추로 초점을 옮긴 뒤 연다
  els.menuManual.addEventListener('click', () => { closeMenu(); h.onManual(); });
  // '던지는 법': 물음 창을 다시 연다(던지는 법이 창 아래쪽에 있다)
  els.menuCoach.addEventListener('click', () => { closeMenu(); openQuestion({ edit: true }); });
  els.infoOpen.addEventListener('click', () => { closeMenu(); openInfo(); });
  // iOS: 메뉴 클릭은 사용자 활성화가 있으므로 여기서 다시 권한을 물을 수 있다
  els.motionAllow.addEventListener('click', () => { if (h.onMotionAllow) h.onMotionAllow(); });


  els.hudManual.addEventListener('click', () => h.onManual());
  els.noStageBtn.addEventListener('click', () => h.onThrowNoStage());
  els.viewResultBtn.addEventListener('click', () => h.onViewResult());
  els.newReadingBtn.addEventListener('click', () => h.onNewReading());
  els.shareBtn.addEventListener('click', shareResult);
  els.modalCloseBtn.addEventListener('click', closeResult);
  els.resultModal.querySelector('.sheet-backdrop').addEventListener('click', closeResult);

  els.infoBtn.addEventListener('click', openInfo);
  els.infoCloseBtn.addEventListener('click', closeInfo);
  els.infoPanel.querySelector('.info-backdrop').addEventListener('click', closeInfo);

  if (ASK_ENABLED) {
    els.askSendBtn.addEventListener('click', () => askSend());
    els.askInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); askSend(); }
    });
  }

  window.addEventListener('keydown', (e) => {
    // 물음 창: Esc 는 건너뛰기(고치기 창이면 취소), Tab 은 창 안에 가둔다
    if (isQuestionOpen()) {
      if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); closeQuestion(qmEditing ? 'cancel' : 'esc'); } else if (e.key === 'Tab') trapTab(els.qCard, e);
      return;
    }
    // 메뉴를 연 직후(첫 항목에 초점이 옮겨 가기 전)에도 Esc 로 닫힌다
    if (!els.menu.hidden && e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
    if (!els.manualPanel.hidden && els.infoPanel.hidden) return;
    if (!els.infoPanel.hidden) {
      if (e.key === 'Escape') { e.preventDefault(); closeInfo(); } else if (e.key === 'Tab') trapTab(els.infoCard, e);
      return;
    }
    if (!els.resultModal.hidden) {
      if (e.key === 'Escape') { e.preventDefault(); closeResult(); } else if (e.key === 'Tab') trapTab(els.sheet, e);
    }
  });

  // 뒤로가기 → 결과 닫기
  window.addEventListener('popstate', () => { if (!els.resultModal.hidden) hideSheetNow(); });
}

/** 결과를 닫은 뒤 다시 점칠 때 남은 기록 없이 닫는다 */
/**
 * 다시 점치기: 결과를 남은 기록 없이 닫는다.
 * @returns {Promise<void>} 뒤로가기 기록 정리(history.back)가 끝나면
 */
export function dismissResultForNewReading() {
  newAskGeneration();
  lastResult = null;
  lockQuestion(false);
  els.resultSource.hidden = true;
  let done = Promise.resolve();
  if (!els.resultModal.hidden) {
    if (history.state && history.state.iching === 'result') {
      done = new Promise((resolve) => {
        const t = setTimeout(resolve, 400);
        window.addEventListener('popstate', () => { clearTimeout(t); resolve(); }, { once: true });
      });
      history.back();
    }
    els.resultModal.classList.remove('is-open');
    els.resultModal.hidden = true;
    els.infoPanel.hidden = true;
  }
  syncInert();
  return done;
}

export function getLastResult() { return lastResult; }
