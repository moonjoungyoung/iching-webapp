import './style.css';
import { runIntro } from './intro.js';
import {
  initUI, showTopbar, showQuestionStep, showGuideStep, showHud, updateLadder,
  setThrowState, focusThrow, focusViewResult, showCoinToast, clearCoinToast, showRetryToast, resetHud,
  showResult, prepareResult, dismissResultForNewReading, getLastResult, setMotionAvailable,
  setMotionPermissionNeeded, isShakeEnabled, setCharge, anyOverlayOpen,
} from './ui.js';
import { initManual, openManual } from './manual.js';
import { createShake } from './shake.js';
import { state, lineFromFaces, recordLine, buildHexagram, resetGame, TOTAL_THROWS } from './game.js';
import { getHexagramData, getHexagramBits } from './hexagrams.js';
import { interpret } from './interpret.js';
import { unlockAudio, playShakeClinks } from './sound.js';

const canvas = document.getElementById('scene');
const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- 3D 무대 불러오기 ----------------
 * Rapier(wasm)와 무대 코드는 내려받기만 일찍(인트로 시작과 함께) 시작하고,
 * 장면 구성(PMREM·바닥 텍스처)은 인트로가 걷힌 뒤 한가할 때 한다.
 * 공유 링크(?hex=)로 결과만 보러 온 경우에는 [다시 점치기]를 누를 때까지 아무것도 불러오지 않는다.
 */
let rapierP = null;
let stageModP = null;
const loadRapier = () => {
  if (!rapierP) {
    rapierP = import('@dimforge/rapier3d');
    rapierP.catch(() => {}); // 실패는 무대 쪽에서 처리(여기서는 처리되지 않은 거부 경고만 막는다)
  }
  return rapierP;
};
const loadStageModule = () => {
  if (!stageModP) {
    stageModP = import('./stage.js');
    stageModP.catch(() => {});
  }
  return stageModP;
};

let stage = null;
let stageCreated = null;
let stageFailed = false;
let physicsOk = false;

function ensureStage() {
  if (stageCreated) return stageCreated;
  const rapier = loadRapier();
  stageCreated = loadStageModule()
    .then((m) => m.createStage(canvas, rapier))
    .then((s) => { stage = s; return s; });
  stageCreated
    .then((s) => s.physicsReady)
    .then(() => { physicsOk = true; refreshThrow(); })
    .catch((e) => {
      console.warn('3D 판을 열지 못해 판 없이 던집니다:', e && e.message);
      stageFailed = true;
      refreshThrow();
    });
  return stageCreated;
}

function whenIdle(fn) {
  if ('requestIdleCallback' in window) requestIdleCallback(fn, { timeout: 500 });
  else setTimeout(fn, 120);
}

/* ---------------- 상태 ---------------- */

let question = '';
let rolling = false;
let inThrowPhase = false;
let manualReading = false; // 직접 고른 괘
let throwGen = 0; //         던지기 세대: 다시 점치기·직접 고르기로 바뀌면 늦게 끝난 던지기는 버린다
let offerNoStage = false; // 물리 판이 늦을 때 '판 없이 던지기' 를 함께 내민다
let noStageTimer = 0;

function refreshThrow() {
  if (!inThrowPhase) return;
  setThrowState({
    index: state.currentThrow,
    loading: !physicsOk && !stageFailed,
    rolling,
    done: state.phase === 'complete',
    noStage: stageFailed,
    offerNoStage: offerNoStage && !physicsOk && !stageFailed,
    manual: manualReading,
  });
}

/** 던지기 화면에 들어와 8초가 지나도 물리 판이 준비되지 않으면 '판 없이 던지기' 를 보여 준다 */
function armNoStageOffer() {
  clearTimeout(noStageTimer);
  offerNoStage = false;
  if (physicsOk || stageFailed) return;
  noStageTimer = setTimeout(() => {
    if (!physicsOk && !stageFailed) { offerNoStage = true; refreshThrow(); }
  }, 8000);
}

// 3D 판을 쓸 수 없을 때: 암호학적 난수로 공정한 동전 세 닢
function fairFaces() {
  const a = new Uint8Array(3);
  crypto.getRandomValues(a);
  return [...a].map((v) => (v & 1) === 1);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 공통 던지기. 버튼·흔들기·판 없이 던지기가 모두 여기로 온다.
 * @param {{ power?:number, spin?:number, dirX?:number }} opts 폰 털기 세기(버튼은 비움)
 * @param {{ shaken?: boolean, noStage?: boolean }} how
 */
async function onThrow(opts = {}, how = {}) {
  // 창이 떠 있거나, 이미 굴러가거나, 여섯 효가 다 섰으면 무시
  if (!inThrowPhase || rolling || state.phase !== 'ready' || anyOverlayOpen()) return;
  const useStage = physicsOk && !how.noStage;
  if (!useStage && !stageFailed && !how.noStage) return; // 아직 판을 펴는 중
  unlockAudio();
  rolling = true;
  const gen = ++throwGen;
  shake.reset();
  clearCoinToast();
  refreshThrow();
  const idx = state.currentThrow;
  let res;
  if (useStage) {
    try {
      res = await stage.throwCoins(opts);
    } catch (e) {
      res = { status: 'settled', faces: fairFaces(), noStage: true };
    }
  } else {
    await wait(reduceMotion() ? 0 : 450);
    res = { status: 'settled', faces: fairFaces(), noStage: true };
  }
  if (gen !== throwGen) return; // 그 사이 다시 점치기·직접 고르기로 바뀜
  rolling = false;
  if (res.status === 'canceled') { refreshThrow(); return; }
  if (res.status === 'retry') {
    showRetryToast();
    refreshThrow();
    focusThrow();
    return;
  }
  const result = lineFromFaces(res.faces);
  recordLine(result);
  showCoinToast(result, idx, { shaken: !!how.shaken, noStage: !!res.noStage });
  updateLadder(state.lines);
  refreshThrow();
  if (state.phase === 'complete') completeReading(); else focusThrow();
}

/** 여섯 효가 다 섰을 때: 결과를 바로 만들어 두고, 시트만 잠깐 뒤에 연다 */
function completeReading() {
  const r = buildHexagram();
  r.manual = manualReading;
  prepareResult(r);
  focusViewResult();
  const gen = throwGen;
  setTimeout(() => {
    if (gen === throwGen && getLastResult() === r && !anyOverlayOpen()) showResult(r);
  }, manualReading ? 0 : 900);
}

/** 진행 중이던 물리 던지기를 그만둔다(늦게 끝나도 기록하지 않음) */
function cancelThrow() {
  throwGen++;
  rolling = false;
  shake.reset();
  setCharge(0);
  if (stage) stage.abortThrow();
}

function startThrowing() {
  inThrowPhase = true;
  showHud(question);
  armNoStageOffer();
  refreshThrow();
  focusThrow();
}

function goQuestion(prefill = '') {
  inThrowPhase = false;
  showTopbar();
  showQuestionStep(prefill);
}

function onNewReading() {
  cancelThrow();
  manualReading = false;
  clearTimeout(noStageTimer);
  offerNoStage = false;
  // 공유 링크로 들어왔던 경우 주소의 ?hex= 를 지운다(뒤로가기 기록 정리가 끝난 뒤)
  dismissResultForNewReading().then(() => {
    if (location.search) history.replaceState(null, '', location.pathname);
  });
  resetGame();
  resetHud();
  ensureStage();
  goQuestion(question);
}

/** 직접 고른 여섯 효로 괘를 세운다. 던지기와 같은 결과 경로를 탄다 */
function onManualSubmit(lines) {
  cancelThrow();
  manualReading = true;
  resetGame();
  state.lines = lines.map((l) => ({ value: l.value, yang: l.yang, changing: l.changing }));
  state.currentThrow = TOTAL_THROWS;
  state.phase = 'complete';
  if (!inThrowPhase) {
    inThrowPhase = true;
    showHud(question);
  }
  resetHud();
  updateLadder(state.lines);
  refreshThrow();
  completeReading();
}

/* ---------------- 폰 흔들기 → 털기 ---------------- */

const shake = createShake({
  canUse: () => inThrowPhase && isShakeEnabled() && !rolling && physicsOk && state.phase === 'ready'
    && !anyOverlayOpen() && !document.hidden
    && !/TEXTAREA|INPUT/.test(document.activeElement ? document.activeElement.tagName : ''),
  onAvailable: () => setMotionAvailable(true),
  onCharge: (e) => setCharge(e),
  onTick: (k) => {
    playShakeClinks(0.3 + k * 0.7);
    if (stage) stage.jiggle(0.35 + k * 0.65);
    if (navigator.vibrate && !reduceMotion()) navigator.vibrate(8);
  },
  onFlick: (opts) => {
    setCharge(0);
    if (navigator.vibrate && !reduceMotion()) navigator.vibrate(22);
    onThrow(opts, { shaken: true });
  },
});
setMotionPermissionNeeded(shake.needsPermission);

initUI({
  onQuestionStart: (q) => { unlockAudio(); question = q; showGuideStep(question); },
  onQuestionSkip: () => { unlockAudio(); question = ''; showGuideStep(''); },
  // iOS 동작 권한은 안내 단계의 확인 버튼(사용자 동작) 안에서 묻는다
  onGuideReady: () => { shake.requestPermission(); unlockAudio(); startThrowing(); },
  onThrow: () => onThrow(),
  onThrowNoStage: () => onThrow({}, { noStage: true }),
  onManual: () => openManual(state.phase === 'complete' ? [] : state.lines),
  onNewReading,
  onViewResult: () => { const r = getLastResult(); if (r) showResult(r); },
});
initManual({ onSubmit: onManualSubmit });

/* ---------------- 공유 링크: ?hex=1 또는 ?hex=1&changed=2 → 인트로·질문 없이 바로 결과 ---------------- */

function openFromLink() {
  const params = new URLSearchParams(location.search);
  const hexNum = parseInt(params.get('hex'), 10);
  const primary = getHexagramData(hexNum);
  if (!primary) return false;
  const rawChanged = parseInt(params.get('changed'), 10) || null;
  const changed = rawChanged && rawChanged !== hexNum ? getHexagramData(rawChanged) : null;
  const changedNum = changed ? rawChanged : null;
  const bits = getHexagramBits(hexNum);
  let lines;
  if (changed) {
    const cbits = getHexagramBits(changedNum);
    lines = bits.map((b, i) => {
      const yang = !!b;
      const changing = b !== cbits[i];
      return { value: changing ? (yang ? 9 : 6) : (yang ? 7 : 8), yang, changing };
    });
  } else {
    lines = bits.map((b) => ({ value: b ? 7 : 8, yang: !!b, changing: false }));
  }
  state.lines = lines;
  state.currentThrow = TOTAL_THROWS;
  state.phase = 'complete';
  showTopbar();
  question = '';
  inThrowPhase = true;
  showHud('');
  updateLadder(lines);
  refreshThrow();
  showResult({ primary, changed, lines, interpretation: interpret(hexNum, changedNum, lines) });
  return true;
}

if (!openFromLink()) {
  // 무거운 것들은 내려받기만 지금 시작
  loadRapier();
  loadStageModule();
  runIntro({
    onLeave: () => {
      goQuestion('');
      whenIdle(() => ensureStage().then((s) => s.playEntrance()).catch(() => {}));
    },
  });
} else {
  const intro = document.getElementById('intro');
  if (intro) intro.remove();
}
