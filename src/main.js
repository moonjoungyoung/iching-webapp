import './style.css';
import { runIntro } from './intro.js';
import {
  initUI, showTopbar, showHud, updateLadder, setThrowState, focusThrow, focusViewResult,
  showCoinToast, clearCoinToast, resetHud, showResult, prepareResult, dismissResultForNewReading,
  getLastResult, setMotionAvailable, isShakeEnabled, setCharge, anyOverlayOpen, onOverlayChange, setMotionPermission,
  openQuestion, refreshQuestionHowto,
} from './ui.js';
import { initManual, openManual } from './manual.js';
import { createShake } from './shake.js';
import { state, lineFromFaces, recordLine, buildHexagram, resetGame, TOTAL_THROWS } from './game.js';
import { getHexagramData, getHexagramBits } from './hexagrams.js';
import { interpret } from './interpret.js';
import { unlockAudio, playShakeClinks } from './sound.js';
import { later, now } from './clock.js';

const canvas = document.getElementById('scene');
const throwBtn = document.getElementById('throw-btn');
const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- 3D 무대 불러오기 ----------------
 * Rapier(wasm)와 무대 코드는 내려받기만 일찍(인트로 시작과 함께) 시작하고,
 * 장면 구성(PMREM·바닥 텍스처)은 인트로의 붓질이 끝난 직후 미리 해 둔다(전환이 멈칫하지 않도록).
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
    .then((s) => {
      stage = s;
      // 검증용(?debug): 녹화·QA 스크립트가 손·동전 상태를 읽는다
      if (new URLSearchParams(location.search).has('debug')) window.__ichingStage = s;
      return s;
    });
  stageCreated
    .then((s) => s.physicsReady)
    .then(() => {
      physicsOk = true;
      refreshThrow();
      // 물리가 처음 준비되면 주 동작에 초점(물음 창 등 창이 떠 있으면 그대로 둔다)
      if (inThrowPhase) focusThrow();
    })
    .catch((e) => {
      console.warn('3D 판을 열지 못해 판 없이 던집니다:', e && e.message);
      stageFailed = true;
      refreshThrow();
    });
  return stageCreated;
}

/* ---------------- 상태 ---------------- */

let rolling = false;
let holding = false; //      버튼·키·캔버스를 누르고 흔드는 중
let inThrowPhase = false;
let manualReading = false; // 직접 고른 괘
let throwGen = 0; //         던지기 세대: 다시 점치기·직접 고르기로 바뀌면 늦게 끝난 던지기는 버린다
let offerNoStage = false; // 물리 판이 늦을 때 '판 없이 던지기' 를 함께 내민다
let noStageTimer = 0;
let retryShown = false; // false 또는 다시 던지기 사유('timeout' | 'outside')
let shakeQuietUntil = 0;

function refreshThrow() {
  if (!inThrowPhase) return;
  setThrowState({
    index: state.currentThrow,
    loading: !physicsOk && !stageFailed,
    rolling,
    // 짧은 탭 뒤 던지기 예약 중에는 '놓으면 던져집니다' 대신 평소 이름으로(이미 놓았으므로)
    holding: holding && !tapTimer,
    done: state.phase === 'complete',
    noStage: stageFailed,
    offerNoStage: offerNoStage && !physicsOk && !stageFailed,
    manual: manualReading,
    retry: retryShown,
  });
}

/** 던지기 화면에 들어와 8초가 지나도 물리 판이 준비되지 않으면 '판 없이 던지기' 를 보여 준다 */
function armNoStageOffer() {
  clearTimeout(noStageTimer);
  offerNoStage = false;
  if (physicsOk || stageFailed) return;
  noStageTimer = later(() => {
    if (!physicsOk && !stageFailed) { offerNoStage = true; refreshThrow(); }
  }, 8000);
}

// 3D 판을 쓸 수 없을 때: 암호학적 난수로 공정한 동전 세 닢
function fairFaces() {
  const a = new Uint8Array(3);
  crypto.getRandomValues(a);
  return [...a].map((v) => (v & 1) === 1);
}

const wait = (ms) => new Promise((r) => later(r, ms));

const canThrow = () => inThrowPhase && !rolling && state.phase === 'ready' && !anyOverlayOpen();

/**
 * 공통 던지기. 버튼·흔들기·캔버스·판 없이 던지기가 모두 여기로 온다.
 * @param {{ power?:number, dirX?:number, dirZ?:number }} opts 세기·방향
 * @param {{ shaken?: boolean, noStage?: boolean }} how
 */
async function onThrow(opts = {}, how = {}) {
  // 창이 떠 있거나, 이미 굴러가거나, 여섯 효가 다 섰으면 무시
  if (!canThrow()) return;
  const useStage = physicsOk && !how.noStage;
  if (!useStage && !stageFailed && !how.noStage) return; // 아직 판을 펴는 중
  unlockAudio();
  rolling = true;
  holding = false;
  retryShown = false;
  const gen = ++throwGen;
  shake.reset();
  setCharge(0);
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
    retryShown = res.reason || 'timeout';
    refreshThrow();
    focusThrow();
    return;
  }
  const result = lineFromFaces(res.faces);
  recordLine(result);
  showCoinToast(result, idx, { shaken: !!how.shaken, noStage: !!res.noStage });
  // 결과를 보여 주는 동안은 폰 흔들기로 바로 거두지 않는다(손으로 거두는 시점과 맞춘다)
  shakeQuietUntil = now() + 1300;
  updateLadder(state.lines);
  refreshThrow();
  if (state.phase === 'complete') {
    completeReading();
  } else {
    focusThrow();
    // 결과를 잠깐 보여 준 뒤 동전을 손으로 거둔다(다음 흔들기를 바로 시작해도 거둔다)
    later(() => {
      if (gen === throwGen && !rolling && !holding && stage && stage.mode === 'tray') stage.gatherToHand(true);
    }, 1300);
  }
}

/** 여섯 효가 다 섰을 때: 결과를 바로 만들어 두고, 시트만 잠깐 뒤에 연다 */
function completeReading() {
  const r = buildHexagram();
  r.manual = manualReading;
  prepareResult(r);
  focusViewResult();
  const gen = throwGen;
  later(() => {
    if (gen === throwGen && getLastResult() === r && !anyOverlayOpen()) showResult(r);
  }, manualReading ? 0 : 900);
}

/** 진행 중이던 물리 던지기를 그만둔다(늦게 끝나도 기록하지 않음) */
function cancelThrow() {
  throwGen++;
  rolling = false;
  holding = false;
  shake.reset();
  setCharge(0);
  if (stage) stage.abortThrow();
}

function startThrowing() {
  inThrowPhase = true;
  showTopbar();
  showHud();
  armNoStageOffer();
  refreshThrow();
}

function onNewReading() {
  cancelThrow();
  manualReading = false;
  retryShown = false;
  clearTimeout(noStageTimer);
  offerNoStage = false;
  // 공유 링크로 들어왔던 경우 주소의 ?hex= 를 지운다(뒤로가기 기록 정리가 끝난 뒤)
  dismissResultForNewReading().then(() => {
    if (location.search) history.replaceState(null, '', location.pathname);
  });
  resetGame();
  resetHud();
  ensureStage();
  // 던지기 화면 위에 물음 창을 다시 띄운다(이전 물음을 채운 채). 닫히면 던지기 버튼으로 초점이 간다
  startThrowing();
  if (!openQuestion({ again: true })) focusThrow();
}

/** 직접 고른 여섯 효로 괘를 세운다. 던지기와 같은 결과 경로를 탄다 */
function onManualSubmit(lines) {
  cancelThrow();
  manualReading = true;
  retryShown = false;
  resetGame();
  state.lines = lines.map((l) => ({ value: l.value, yang: l.yang, changing: l.changing }));
  state.currentThrow = TOTAL_THROWS;
  state.phase = 'complete';
  if (!inThrowPhase) startThrowing();
  resetHud();
  updateLadder(state.lines);
  refreshThrow();
  completeReading();
}

/* ---------------- 누르고 흔들다 놓아 던지기 ----------------
 * 버튼·스페이스·캔버스를 누르고 있는 동안 손(그릇)을 흔들고, 놓으면 던진다.
 * 짧게 탭하면 잠깐 흔든 뒤 던진다. 캔버스에서는 끄는 방향·빠르기가 던지는 방향·세기가 된다.
 * 누르기는 시작한 포인터(pointerId) 하나만 따라가고, 취소(pointercancel)·초점 이탈·창 열림·탭 숨김이면
 * 던지지 않고 흔들기만 멈춘다(cancelHold).
 */
let holdStart = 0;
let holdSource = null; // 'button' | 'key' | 'canvas'
let holdPointer = null; // 누르기를 시작한 pointerId
let tapTimer = 0; //      짧은 탭: 잠깐 더 흔든 뒤 던지기 예약
let lastUpAt = -1e9;
let lastPointerDownAt = -1e9; // 버튼 위 마지막 pointerdown(포인터가 만든 click 은 포인터 경로가 이미 처리했다)
const trail = []; //     캔버스 포인터 자취(최근 120ms)
let dragOrigin = null;

function beginHold(source) {
  if (holding || !canThrow() || (!physicsOk && !stageFailed)) return false;
  holding = true;
  holdSource = source;
  holdStart = now();
  retryShown = false;
  if (physicsOk) stage.startShake(source === 'canvas' ? 0.6 : 0.75);
  refreshThrow();
  return true;
}

/** 누르기를 던지지 않고 끝낸다: 자동 흔들기·예약 타이머를 정리하고 동전은 손 안에서 가라앉는다 */
function cancelHold() {
  if (!holding) return;
  holding = false;
  holdSource = null;
  holdPointer = null;
  dragOrigin = null;
  trail.length = 0;
  clearTimeout(tapTimer);
  tapTimer = 0;
  if (stage) stage.stopShake();
  refreshThrow();
}

function endHold(opts = {}) {
  if (!holding || tapTimer) return;
  lastUpAt = now();
  holdPointer = null;
  const held = now() - holdStart;
  const power = Math.min(1, 0.35 + held / 2400);
  const finish = () => {
    tapTimer = 0;
    if (!canThrow()) { cancelHold(); return; }
    holdSource = null;
    onThrow({ power, ...opts });
  };
  if (held < 220 && physicsOk) {
    // 탭: 짧게 더 흔든 뒤 던진다(그 사이 취소되면 cancelHold 가 예약을 지운다)
    tapTimer = later(() => { if (holding) finish(); else tapTimer = 0; }, 380 - held);
    refreshThrow(); // 이미 놓았으므로 '놓으면 던져집니다'를 거둔다
  } else {
    finish();
  }
}

throwBtn.addEventListener('pointerdown', (e) => {
  lastPointerDownAt = now();
  if (e.button !== 0 || holding) return;
  if (beginHold('button')) {
    holdPointer = e.pointerId;
    try { throwBtn.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
  }
});
throwBtn.addEventListener('pointerup', (e) => {
  // iOS: 터치의 사용자 활성화는 pointerup·touchend·click 에서 생기므로 첫 권한 요청·소리 잠금 해제는 여기서 동기로
  unlockAudio();
  if (e.pointerType !== 'mouse') askMotionPermission();
  if (holdSource === 'button' && e.pointerId === holdPointer) endHold();
});
throwBtn.addEventListener('pointercancel', (e) => {
  if (holdSource === 'button' && e.pointerId === holdPointer) cancelHold();
});
// 포인터 캡처를 잃으면(시스템 창·제스처가 가로챔) 던지지 않는다. 정상 놓기에서는 endHold 가 먼저 holdPointer 를 비운다
throwBtn.addEventListener('lostpointercapture', (e) => {
  if (holdSource === 'button' && e.pointerId === holdPointer) cancelHold();
});
throwBtn.addEventListener('keydown', (e) => {
  if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
    e.preventDefault();
    beginHold('key');
  }
});
throwBtn.addEventListener('keyup', (e) => {
  if ((e.key === ' ' || e.key === 'Enter') && holdSource === 'key') {
    e.preventDefault();
    unlockAudio();
    askMotionPermission();
    endHold();
  }
});
// 누른 채 Tab 으로 나가거나 초점을 잃으면 던지지 않는다
throwBtn.addEventListener('blur', () => { if (holdSource === 'key') cancelHold(); });
// 스크린 리더 등 포인터·키 없이 눌린 경우: 짧게 흔든 뒤 던진다.
// 포인터가 만든 click(누르기를 취소한 뒤의 click 포함)은 포인터 경로가 이미 처리했으므로 던지지 않는다
throwBtn.addEventListener('click', () => {
  if (now() - lastPointerDownAt < 1500) return;
  unlockAudio();
  askMotionPermission();
  if (holding || now() - lastUpAt < 600) return;
  if (beginHold('button')) endHold();
});
// 길게 누르기를 오른쪽 클릭 메뉴·롱프레스 메뉴가 가로채지 않게
throwBtn.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || holding) return; // 주 버튼만
  if (!beginHold('canvas')) return;
  holdPointer = e.pointerId;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
  dragOrigin = { x: e.clientX, y: e.clientY };
  trail.length = 0;
  trail.push({ x: e.clientX, y: e.clientY, t: now() });
});
canvas.addEventListener('pointermove', (e) => {
  if (!holding || holdSource !== 'canvas' || e.pointerId !== holdPointer) return;
  const t = now();
  trail.push({ x: e.clientX, y: e.clientY, t });
  while (trail.length > 2 && t - trail[0].t > 120) trail.shift();
  if (physicsOk && dragOrigin) {
    const sz = Math.min(window.innerWidth, window.innerHeight) * 0.25;
    stage.pointerMove((e.clientX - dragOrigin.x) / sz, (e.clientY - dragOrigin.y) / sz);
  }
});
canvas.addEventListener('pointerup', (e) => {
  unlockAudio();
  if (e.pointerType !== 'mouse') askMotionPermission();
  if (!holding || holdSource !== 'canvas' || e.pointerId !== holdPointer) return;
  // 마지막 120ms 의 끄는 속도 → 던지는 방향·세기
  let opts = {};
  if (trail.length >= 2) {
    const p0 = trail[0], p1 = trail[trail.length - 1];
    const dt = Math.max(16, p1.t - p0.t);
    const vx = (p1.x - p0.x) / dt, vy = (p1.y - p0.y) / dt; // px/ms
    const speed = Math.hypot(vx, vy);
    if (speed > 0.35) {
      opts = {
        dirX: Math.max(-1, Math.min(1, vx / 1.6)),
        dirZ: Math.max(-1, Math.min(1, vy / 1.6)), // 화면 위로 털면 판 안쪽(뒤)으로
        power: Math.min(1, 0.3 + speed / 2.5),
      };
    }
  }
  dragOrigin = null;
  endHold(opts);
});
canvas.addEventListener('pointercancel', (e) => {
  if (holdSource === 'canvas' && e.pointerId === holdPointer) cancelHold();
});
canvas.addEventListener('lostpointercapture', (e) => {
  if (holdSource === 'canvas' && e.pointerId === holdPointer) cancelHold();
});

// 초점이 어디에도 없을 때(문서 본문) 스페이스를 누르고 있다 떼어도 던진다. 버튼에 초점이 있으면 버튼이 처리한다
const focusFree = () => { const a = document.activeElement; return !a || a === document.body || a === canvas; };
window.addEventListener('keydown', (e) => {
  if (e.key !== ' ' || e.repeat || !focusFree() || anyOverlayOpen()) return;
  e.preventDefault();
  beginHold('key');
});
window.addEventListener('keyup', (e) => {
  if (e.key !== ' ' || holdSource !== 'key' || !focusFree()) return;
  e.preventDefault();
  unlockAudio();
  askMotionPermission();
  endHold();
});

// 창이 초점을 잃거나 탭이 숨으면, 메뉴·창이 열리면 누르기를 던지지 않고 정리한다
window.addEventListener('blur', cancelHold);
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelHold(); });
onOverlayChange(() => { if (anyOverlayOpen()) cancelHold(); });

/* ---------------- 폰 흔들기 → 털기 ---------------- */

const shake = createShake({
  canUse: () => inThrowPhase && isShakeEnabled() && !rolling && physicsOk && state.phase === 'ready' && now() >= shakeQuietUntil
    && !anyOverlayOpen() && !document.hidden
    && !/TEXTAREA|INPUT/.test(document.activeElement ? document.activeElement.tagName : ''),
  onAvailable: () => { setMotionAvailable(true); refreshQuestionHowto(); },
  onCharge: (e) => setCharge(e),
  onSample: (ax, ay, az) => {
    if (!stage) return;
    // 기기 좌표 → 화면 좌표: 가로로 돌려 쥐어도 흔드는 방향이 화면과 맞게
    const deg = (screen.orientation && Number.isFinite(screen.orientation.angle)) ? screen.orientation.angle
      : (Number.isFinite(window.orientation) ? window.orientation : 0);
    const th = (deg * Math.PI) / 180;
    const c = Math.cos(th), sn = Math.sin(th);
    stage.motionSample(ax * c - ay * sn, ax * sn + ay * c, az);
  },
  onTick: (k) => {
    playShakeClinks(0.2 + k * 0.4);
    if (navigator.vibrate && !reduceMotion()) navigator.vibrate(8);
  },
  onFlick: (o) => {
    setCharge(0);
    if (navigator.vibrate && !reduceMotion()) navigator.vibrate(22);
    onThrow({ power: o.power, dirX: o.dirX, dirZ: -0.3 }, { shaken: true });
  },
});

/* ---------------- iOS 동작 권한 ----------------
 * 물음 창의 시작·건너뛰기, 인트로 탭, 던지기 버튼을 누르고 뗄 때 중 먼저 오는 누름(사용자 활성화) 안에서 조용히 묻는다.
 * 요청 자체가 실패하면(활성화 없음 등) 다음 탭에서 다시 묻고, 명시적으로 거부하면 버튼 방식으로 쓰면서
 * 메뉴에 '흔들기 다시 허용'을 둔다.
 */
let motionPerm = shake.needsPermission ? 'prompt' : 'none';
let permPending = false;
setMotionPermission(motionPerm);

function askMotionPermission(fromMenu = false) {
  if (permPending || motionPerm === 'none' || (motionPerm === 'denied' && !fromMenu)) return;
  permPending = true;
  shake.requestPermission().then((r) => {
    permPending = false;
    if (r === 'granted') motionPerm = 'none';
    else if (r === 'denied') motionPerm = 'denied';
    // 'error' 는 그대로 둔다('prompt' 면 다음 탭에서 다시 묻는다)
    setMotionPermission(motionPerm, fromMenu && r === 'denied');
    refreshQuestionHowto();
  });
}

/* ---------------- 물음 창 ----------------
 * 인트로 다음(같은 세션 재방문의 짧은 인트로 포함), 다시 점치기, 위쪽 물음 줄·메뉴의 '던지는 법'에서 뜬다.
 * 던지는 법은 기기에 맞춘다
 *  - 흔들기를 쓸 수 있는 터치 폰(가속도가 들어오거나 iOS 처럼 권한을 물을 수 있음): 흔들다 털기
 *  - 그 외 터치 기기(센서 없음·거부·흔들기 끔): 꾹 눌렀다 놓기
 *  - 마우스 기기: 버튼·판을 눌렀다 놓기, 스페이스
 * iOS 는 시작·건너뛰기 누름 안에서 동작 권한을 동기로 묻는다(Esc 는 사용자 활성화가 아니라 묻지 않는다).
 */
function howtoMode() {
  const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  if (!touch) return 'mouse';
  if (isShakeEnabled() && motionPerm !== 'denied' && (shake.available || shake.needsPermission)) return 'shake';
  return 'touch';
}
function onQuestionDone({ how }) {
  if (how === 'esc' || how === 'cancel') return; // 사용자 활성화가 아니거나(Esc) 시작이 아님(취소)
  unlockAudio();
  askMotionPermission();
}

initUI({
  onThrowNoStage: () => onThrow({}, { noStage: true }),
  onManual: () => openManual(state.phase === 'complete' ? [] : state.lines),
  onNewReading,
  onViewResult: () => { const r = getLastResult(); if (r) showResult(r); },
  onMotionAllow: () => askMotionPermission(true),
  getHowto: () => ({ mode: howtoMode(), ios: shake.needsPermission && motionPerm === 'prompt' }),
  onQuestionDone,
  onQuestionClosed: () => { cancelHold(); focusThrow(); },
});
initManual({ onSubmit: onManualSubmit });

/* ---------------- 공유 링크: ?hex=1 또는 ?hex=1&changed=2 → 인트로 없이 바로 결과 ---------------- */

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
  startThrowing();
  updateLadder(lines);
  refreshThrow();
  showResult({ primary, changed, lines, interpretation: interpret(hexNum, changedNum, lines), fromLink: true });
  return true;
}

if (!openFromLink()) {
  // 무거운 것들은 내려받기만 지금 시작
  loadRapier();
  loadStageModule();
  runIntro({
    // 3D 장면을 만들고 첫 프레임까지 그린 뒤에 전환을 시작한다(전환 중 멈칫하지 않게)
    prepare: () => ensureStage().then((st) => st.firstFrame),
    onLeave: ({ dur, reduced, ready, ease }) => {
      startThrowing();
      const hud = document.getElementById('hud');
      const top = document.getElementById('topbar');
      [hud, top].forEach((el) => {
        el.style.setProperty('--enter', `${dur}ms`);
        el.classList.add(reduced ? 'is-fading-in' : 'is-entering');
        later(() => el.classList.remove('is-entering', 'is-fading-in'), dur + 50);
      });
      // 준비가 제한 시간 안에 끝난 정상 경로만 카메라 진입을 전환과 함께 돌린다.
      // 늦게 준비된 장면은 따로 진입시키지 않고 최종 카메라 자리(createStage 의 기본 구도)에 바로 둔다
      if (ready && stage) stage.playEntrance({ dur: reduced ? 0 : dur, ease });
      // 판이 드러날 무렵 물음 창이 아래에서 떠오른다(먹 자국이 거의 다 걷힌 시점). 동작 줄이기는 전환이 끝난 뒤 옅게
      later(() => { if (!openQuestion({ entering: !reduced })) focusThrow(); }, reduced ? dur : Math.round(dur * 0.6));
    },
  });
  // 인트로를 탭해 넘길 때 그 탭(사용자 활성화) 안에서 소리를 열고, iOS 는 동작 권한도 함께 묻는다
  // (그러면 물음 창에서 권한 창이 따로 뜨지 않는다)
  const onIntroTap = (e) => {
    const intro = document.getElementById('intro');
    if (!intro) { window.removeEventListener('pointerup', onIntroTap, true); return; }
    if (e.pointerType === 'mouse' || !intro.contains(e.target)) return;
    window.removeEventListener('pointerup', onIntroTap, true);
    unlockAudio();
    askMotionPermission();
  };
  window.addEventListener('pointerup', onIntroTap, true);
} else {
  const intro = document.getElementById('intro');
  if (intro) intro.remove();
}

