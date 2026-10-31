import './style.css';
import { runIntro } from './intro.js';
import {
  initUI, showTopbar, showHud, updateLadder, setThrowState, focusThrow, focusViewResult,
  showCoinToast, clearCoinToast, resetHud, showResult, prepareResult, dismissResultForNewReading,
  getLastResult, setMotionAvailable, isShakeEnabled, setCharge, anyOverlayOpen,
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
const qInput = document.getElementById('question-input');
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
    .then(() => { physicsOk = true; refreshThrow(); })
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
let retryShown = false;
let permissionAsked = false;

function refreshThrow() {
  if (!inThrowPhase) return;
  setThrowState({
    index: state.currentThrow,
    loading: !physicsOk && !stageFailed,
    rolling,
    holding,
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
    retryShown = true;
    refreshThrow();
    focusThrow();
    return;
  }
  const result = lineFromFaces(res.faces);
  recordLine(result);
  showCoinToast(result, idx, { shaken: !!how.shaken, noStage: !!res.noStage });
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
  // 던지기 화면으로 바로 돌아온다. 질문 칸은 이전 값 그대로
  startThrowing();
  focusThrow();
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
 */
let holdStart = 0;
let holdSource = null; // 'button' | 'key' | 'canvas'
let lastUpAt = -1e9;
const trail = []; //     캔버스 포인터 자취(최근 120ms)
let dragOrigin = null;

function askPermissionOnce() {
  // iOS 동작 권한은 첫 던지기 버튼을 누를 때(사용자 동작 안에서) 조용히 묻는다. 거부되면 버튼 방식 그대로
  if (permissionAsked) return;
  permissionAsked = true;
  shake.requestPermission();
}

function beginHold(source) {
  if (holding || !canThrow() || (!physicsOk && !stageFailed)) return false;
  askPermissionOnce();
  unlockAudio();
  holding = true;
  holdSource = source;
  holdStart = now();
  retryShown = false;
  if (physicsOk) stage.startShake(source === 'canvas' ? 0.6 : 0.75);
  refreshThrow();
  return true;
}

function endHold(opts = {}) {
  if (!holding) return;
  lastUpAt = now();
  const held = now() - holdStart;
  const power = Math.min(1, 0.35 + held / 2400);
  const finish = () => onThrow({ power, ...opts });
  if (held < 220 && physicsOk) {
    // 탭: 짧게 더 흔든 뒤 던진다
    const gen = throwGen;
    later(() => { if (holding && gen === throwGen) finish(); }, 380 - held);
  } else {
    finish();
  }
}

throwBtn.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (beginHold('button')) {
    try { throwBtn.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
  }
});
throwBtn.addEventListener('pointerup', () => { if (holdSource === 'button') endHold(); });
throwBtn.addEventListener('pointercancel', () => { if (holdSource === 'button') endHold(); });
throwBtn.addEventListener('keydown', (e) => {
  if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
    e.preventDefault();
    beginHold('key');
  }
});
throwBtn.addEventListener('keyup', (e) => {
  if ((e.key === ' ' || e.key === 'Enter') && holdSource === 'key') { e.preventDefault(); endHold(); }
});
// 스크린 리더 등 포인터·키 없이 눌린 경우: 짧게 흔든 뒤 던진다
throwBtn.addEventListener('click', () => {
  if (holding || now() - lastUpAt < 600) return;
  if (beginHold('button')) endHold();
});
// 버튼 위 오른쪽 클릭 메뉴가 길게 누르기를 가로채지 않게
throwBtn.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  if (!beginHold('canvas')) return;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
  dragOrigin = { x: e.clientX, y: e.clientY };
  trail.length = 0;
  trail.push({ x: e.clientX, y: e.clientY, t: now() });
});
canvas.addEventListener('pointermove', (e) => {
  if (!holding || holdSource !== 'canvas') return;
  const t = now();
  trail.push({ x: e.clientX, y: e.clientY, t });
  while (trail.length > 2 && t - trail[0].t > 120) trail.shift();
  if (physicsOk && dragOrigin) {
    const s = Math.min(window.innerWidth, window.innerHeight) * 0.25;
    stage.pointerMove((e.clientX - dragOrigin.x) / s, (e.clientY - dragOrigin.y) / s);
  }
});
function canvasUp() {
  if (!holding || holdSource !== 'canvas') return;
  // 마지막 120ms 의 끄는 속도 → 던지는 방향·세기
  let opts = {};
  if (trail.length >= 2) {
    const a = trail[0], b = trail[trail.length - 1];
    const dt = Math.max(16, b.t - a.t);
    const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt; // px/ms
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
}
canvas.addEventListener('pointerup', canvasUp);
canvas.addEventListener('pointercancel', canvasUp);

/* ---------------- 폰 흔들기 → 털기 ---------------- */

const shake = createShake({
  canUse: () => inThrowPhase && isShakeEnabled() && !rolling && physicsOk && state.phase === 'ready'
    && !anyOverlayOpen() && !document.hidden
    && !/TEXTAREA|INPUT/.test(document.activeElement ? document.activeElement.tagName : ''),
  onAvailable: () => setMotionAvailable(true),
  onCharge: (e) => setCharge(e),
  onSample: (ax, ay, az) => { if (stage) stage.motionSample(ax, ay, az); },
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

initUI({
  onThrowNoStage: () => onThrow({}, { noStage: true }),
  onManual: () => openManual(state.phase === 'complete' ? [] : state.lines),
  onNewReading,
  onViewResult: () => { const r = getLastResult(); if (r) showResult(r); },
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
    prepare: () => ensureStage(),
    onLeave: ({ dur, reduced }) => {
      startThrowing();
      const hud = document.getElementById('hud');
      const top = document.getElementById('topbar');
      [hud, top].forEach((el) => {
        el.style.setProperty('--enter', `${dur}ms`);
        el.classList.add(reduced ? 'is-fading-in' : 'is-entering');
        later(() => el.classList.remove('is-entering', 'is-fading-in'), dur + 50);
      });
      if (stage) stage.playEntrance({ dur: reduced ? 0 : dur });
      else ensureStage().then((s) => s.playEntrance({ dur: reduced ? 0 : 900 })).catch(() => {});
      later(() => focusThrow(), dur);
    },
  });
} else {
  const intro = document.getElementById('intro');
  if (intro) intro.remove();
}

// 질문 칸으로 초점이 옮겨 가면 누르고 있던 흔들기를 그 자리에서 던진다
qInput.addEventListener('focus', () => { if (holding) endHold(); });
