import { ASK_ENDPOINT } from './config.js';
import { isMuted, setMuted } from './sound.js';

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
const QUESTION_HINTS = [
  '올해 이직을 준비해도 될까요?',
  '그 사람과의 관계는 어떻게 흘러갈까요?',
  '지금 시작하려는 일에서 무엇을 조심해야 할까요?',
  '이번 결정을 미뤄도 괜찮을까요?',
];

const els = {
  topbar: $('#topbar'),
  soundBtn: $('#sound-btn'),
  infoOpen: $('#info-open'),
  stepQuestion: $('#step-question'),
  qTitle: $('#q-title'),
  qInput: $('#question-input'),
  qCount: $('#q-count'),
  qStart: $('#question-start'),
  qSkip: $('#question-skip'),
  stepGuide: $('#step-guide'),
  guideQuestion: $('#guide-question'),
  guideText: $('#guide-text'),
  guideReady: $('#guide-ready'),
  hud: $('#hud'),
  hudQuestion: $('#hud-question'),
  hudQText: $('#hud-question .hud-q-text'),
  ladder: $('#ladder'),
  toast: $('#coin-toast'),
  throwBtn: $('#throw-btn'),
  throwYao: $('#throw-yao'),
  throwLabel: $('#throw-btn .throw-label'),
  throwHint: $('#throw-hint'),
  motionHint: $('#motion-hint'),
  chargeBar: $('#charge-bar'),
  guideMotion: $('#guide-motion'),
  guidePermission: $('#guide-permission'),
  guideManual: $('#guide-manual'),
  hudManual: $('#hud-manual'),
  shakeToggle: $('#shake-toggle'),
  noStageBtn: $('#nostage-btn'),
  resultSource: $('#result-source'),
  stepQuestionEl: $('#step-question'),
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

let askHistory = [];
let askGen = 0; // 점괘(결과)마다 올라가는 세대 번호: 지난 점괘의 늦은 답은 버린다
let askCtrl = null; // 진행 중인 묻기 요청(새 점괘로 바뀌면 취소)
let askBusy = false;
let lastResult = null; // { primary, changed, lines, interpretation, manual? }
let intent = ''; // 점치기 전 품은 물음
let infoReturnFocus = null;
let motionOn = false; // 폰 흔들기 감지가 실제로 들어오는 기기
let motionPermissionNeeded = false; // iOS: 안내 단계 버튼에서 권한을 물어야 한다
let shakeEnabled = true;
try { shakeEnabled = localStorage.getItem('iching.shake') !== '0'; } catch (e) { /* 저장소 차단 */ }

/* ---------------- 상단 바 · 소리 ---------------- */

export function showTopbar() { els.topbar.hidden = false; }

function syncSoundBtn() {
  els.soundBtn.setAttribute('aria-pressed', String(!isMuted()));
}

/* ---------------- 겹쳐 뜨는 창과 배경 잠금(inert) ---------------- */

const isOpen = (el) => el && !el.hidden;

/**
 * 맨 위에 뜬 창 아래는 모두 inert: 안내창 > 직접 고르기 > 결과 > 바탕(상단 바·던지기 화면·단계)
 * 열고 닫을 때마다 부른다.
 */
export function syncInert() {
  const info = isOpen(els.infoPanel);
  const manual = isOpen(els.manualPanel);
  const sheet = isOpen(els.resultModal);
  const setInert = (el, on) => { if (!el) return; if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert'); };
  [els.topbar, els.hud, els.stepQuestion, els.stepGuide].forEach((el) => setInert(el, info || manual || sheet));
  setInert(els.resultModal, info || manual);
  setInert(els.manualPanel, info);
}

/** 어떤 창이든 떠 있으면 true(던지기·자동 초점 보류) */
export function anyOverlayOpen() {
  return isOpen(els.infoPanel) || isOpen(els.manualPanel) || isOpen(els.resultModal);
}

/* ---------------- 단계 전환 ---------------- */

function hideStep(step) {
  if (step.hidden) return;
  if (reduceMotion()) { step.hidden = true; return; }
  step.classList.add('is-leaving');
  setTimeout(() => { step.hidden = true; step.classList.remove('is-leaving'); }, 340);
}

/** ② 질문 단계 */
export function showQuestionStep(prefill = '') {
  els.hud.hidden = true;
  els.stepGuide.hidden = true;
  els.stepQuestion.hidden = false;
  els.qInput.value = prefill;
  updateQuestionCount();
  if (!prefill) els.qInput.placeholder = QUESTION_HINTS[Math.floor(Math.random() * QUESTION_HINTS.length)];
  // 터치 기기에서는 키보드가 바로 올라오지 않도록 제목에 초점
  requestAnimationFrame(() => (finePointer() ? els.qInput : els.qTitle).focus({ preventScroll: true }));
}

function updateQuestionCount() {
  const n = els.qInput.value.length;
  els.qCount.textContent = `${n} / 200`;
  els.qStart.disabled = els.qInput.value.trim().length === 0;
}

/** ③ 마음 모으기 */
export function showGuideStep(question) {
  hideStep(els.stepQuestion);
  els.hud.hidden = true;
  els.stepGuide.hidden = false;
  if (question) {
    els.guideQuestion.hidden = false;
    els.guideQuestion.textContent = `「${question}」`;
    els.guideText.textContent = '질문을 마음에 깊이 품고, 한 번 던질 때마다 그 생각에 머무르며 동전을 여섯 번 던지십시오.';
  } else {
    els.guideQuestion.hidden = true;
    els.guideText.textContent = '묻고자 하는 일을 마음에 깊이 품고, 한 번 던질 때마다 그 일에 머무르며 동전을 여섯 번 던지십시오.';
  }
  syncGuideMotion();
  syncInert();
  requestAnimationFrame(() => els.guideText.focus({ preventScroll: true }));
}

function syncGuideMotion() {
  els.guideMotion.hidden = !(motionOn || motionPermissionNeeded) || !shakeEnabled;
  els.guidePermission.hidden = !(motionPermissionNeeded && !motionOn) || !shakeEnabled;
}

/** iOS 처럼 동작 권한을 따로 물어야 하는 기기 */
export function setMotionPermissionNeeded(on) {
  motionPermissionNeeded = !!on;
  syncGuideMotion();
}

export function isShakeEnabled() { return shakeEnabled; }

/** 흔들기 감지가 들어오기 시작하면 안내 문구를 바꾼다 */
export function setMotionAvailable(on) {
  motionOn = !!on;
  syncGuideMotion();
  syncShakeUi();
}

function syncShakeUi() {
  els.shakeToggle.hidden = !motionOn;
  els.shakeToggle.setAttribute('aria-pressed', String(shakeEnabled));
  els.shakeToggle.textContent = shakeEnabled ? '흔들어 던지기 끄기' : '흔들어 던지기 켜기';
  els.motionHint.hidden = !motionOn || !shakeEnabled || els.throwBtn.hidden;
}

/** 흔들어 모은 기운(0~1)을 던지기 버튼 윗선에 보여 준다 */
export function setCharge(energy) {
  const e = Math.max(0, Math.min(1, energy));
  els.chargeBar.style.transform = `scaleX(${e})`;
  const charging = e > 0.04;
  els.throwBtn.classList.toggle('is-charging', charging);
  if (charging && !els.throwBtn.disabled) els.throwLabel.textContent = '흔드는 중';
  else if (!els.throwBtn.disabled && els.throwLabel.textContent === '흔드는 중') els.throwLabel.textContent = '동전 던지기';
}

export function isInfoOpen() { return !els.infoPanel.hidden; }

/** ④ 던지기 화면 */
export function showHud(question) {
  hideStep(els.stepGuide);
  hideStep(els.stepQuestion);
  els.hud.hidden = false;
  syncInert();
  intent = question || '';
  els.hudQuestion.hidden = !intent;
  els.hudQText.textContent = intent;
  els.hudQuestion.title = intent;
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

/* ---------------- 던지기 버튼 · 안내 ---------------- */

/**
 * @param {{ index:number, loading?:boolean, rolling?:boolean, done?:boolean, noStage?:boolean }} s
 */
export function setThrowState(s) {
  const i = Math.min(s.index, 5);
  els.throwYao.textContent = YAO_NAMES[i];
  if (s.done) {
    els.throwBtn.hidden = true;
    els.viewResultBtn.hidden = false;
    els.motionHint.hidden = true;
    els.noStageBtn.hidden = true;
    els.hudManual.hidden = true;
    els.throwHint.textContent = s.manual ? '직접 고른 여섯 효로 괘를 세웠습니다' : '여섯 효가 모두 섰습니다';
    return;
  }
  els.throwBtn.hidden = false;
  els.viewResultBtn.hidden = true;
  els.hudManual.hidden = false;
  // 물리 판이 오래 늦으면 공정한 난수로 '판 없이 던지기'를 함께 내민다
  els.noStageBtn.hidden = !s.offerNoStage || !!s.rolling;
  syncShakeUi();
  els.throwBtn.disabled = !!(s.loading || s.rolling);
  els.throwBtn.setAttribute('aria-busy', s.loading ? 'true' : 'false');
  els.throwLabel.textContent = s.loading ? '판을 펴는 중' : s.rolling ? '동전이 구르는 중' : '동전 던지기';
  const lead = intent ? '마음속으로 질문을 되새기며' : '마음속으로 그 일을 되새기며';
  els.throwHint.textContent = s.noStage
    ? `3D 판을 열 수 없어 판 없이 던집니다 · ${i + 1}/6 효`
    : `${lead} · ${i + 1}/6 효`;
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
  els.toast.innerHTML = '<div class="toast-inner"><span class="toast-retry">동전이 자리를 잡지 못했습니다. 이 효를 다시 던져 주세요.</span></div>';
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

/**
 * @param {{ onQuestionStart:(q:string)=>void, onQuestionSkip:()=>void, onGuideReady:()=>void,
 *           onThrow:()=>void, onThrowNoStage:()=>void, onManual:()=>void,
 *           onNewReading:()=>void, onViewResult:()=>void }} h
 */
export function initUI(h) {
  buildLadder();
  syncSoundBtn();

  els.soundBtn.addEventListener('click', () => { setMuted(!isMuted()); syncSoundBtn(); });

  els.qInput.addEventListener('input', updateQuestionCount);
  els.qInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !els.qStart.disabled) { e.preventDefault(); els.qStart.click(); }
  });
  els.qStart.addEventListener('click', () => h.onQuestionStart(els.qInput.value.trim().slice(0, 200)));
  els.qSkip.addEventListener('click', () => h.onQuestionSkip());
  els.guideReady.addEventListener('click', () => h.onGuideReady());
  els.guideManual.addEventListener('click', () => h.onManual());
  els.hudManual.addEventListener('click', () => h.onManual());
  els.noStageBtn.addEventListener('click', () => h.onThrowNoStage());
  els.shakeToggle.addEventListener('click', () => {
    shakeEnabled = !shakeEnabled;
    try { localStorage.setItem('iching.shake', shakeEnabled ? '1' : '0'); } catch (e) { /* 저장소 차단 */ }
    syncShakeUi();
    syncGuideMotion();
  });

  els.throwBtn.addEventListener('click', () => h.onThrow());
  els.viewResultBtn.addEventListener('click', () => h.onViewResult());
  els.newReadingBtn.addEventListener('click', () => h.onNewReading());
  els.shareBtn.addEventListener('click', shareResult);
  els.modalCloseBtn.addEventListener('click', closeResult);
  els.resultModal.querySelector('.sheet-backdrop').addEventListener('click', closeResult);

  els.infoOpen.addEventListener('click', openInfo);
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
