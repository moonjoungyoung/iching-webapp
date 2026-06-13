import * as CANNON from 'cannon-es';
import { isHeadsUp, resetCoins } from './coins.js';
import { getHexagramNumber, getHexagramData } from './hexagrams.js';
import { interpret } from './interpret.js';

const TOTAL_THROWS = 6;
const SETTLE_THRESHOLD = 0.15;
const SETTLE_FRAMES_NEEDED = 15;
const MIN_THROW_TIME = 0.8; // seconds
const MAX_THROW_TIME = 3.5; // seconds — 강제 안정

export const state = {
  phase: 'ready', // ready | throwing | settled | complete
  currentThrow: 0,
  lines: [],       // { value:6|7|8|9, yang:boolean, changing:boolean }
  settleCount: 0,
  throwStartTime: 0,
  forceSettled: false,
};

/**
 * 동전 3개를 던진다. 위로 힘 + 랜덤 회전
 */
export function throwCoins(coins) {
  state.phase = 'throwing';
  state.settleCount = 0;
  state.throwStartTime = performance.now() / 1000;

  const spread = 0.6;
  coins.forEach(({ body }, i) => {
    // 시작 위치: 살짝 위, 약간 퍼짐
    const ox = (i - 1) * spread + (Math.random() - 0.5) * 0.3;
    const oz = (Math.random() - 0.5) * 0.4;
    body.position.set(ox, 3.0 + Math.random() * 0.5, oz);

    // 랜덤 초기 회전 (편향 제거)
    const ax = Math.random() - 0.5, ay = Math.random() - 0.5, az = Math.random() - 0.5;
    const len = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
    const angle = Math.random() * Math.PI * 2;
    const s = Math.sin(angle / 2) / len;
    body.quaternion.set(ax * s, ay * s, az * s, Math.cos(angle / 2));
    body.wakeUp();

    // 힘차게 위로 던지기 + 적당한 수평 퍼짐
    body.velocity.set(
      (Math.random() - 0.5) * 1.5,
      7 + Math.random() * 4,
      (Math.random() - 0.5) * 1.5
    );

    // 빠른 회전 (동전이 공중에서 여러 번 뒤집힘)
    body.angularVelocity.set(
      (Math.random() - 0.5) * 40,
      (Math.random() - 0.5) * 15,
      (Math.random() - 0.5) * 40
    );
  });
}

/**
 * 동전이 안정되었는지 매 프레임 체크
 * @returns {boolean} true면 안정됨
 */
export function checkSettled(coins) {
  if (state.phase !== 'throwing') return false;

  const elapsed = performance.now() / 1000 - state.throwStartTime;
  if (elapsed < MIN_THROW_TIME) return false;

  // 강제 안정: 시간 초과 시 즉시 판정 (결과는 랜덤으로 처리)
  if (elapsed > MAX_THROW_TIME) {
    state.forceSettled = true;
    return true;
  }

  state.forceSettled = false;

  const allSlow = coins.every(({ body }) => {
    const lv = body.velocity.length();
    const av = body.angularVelocity.length();
    return lv < SETTLE_THRESHOLD && av < SETTLE_THRESHOLD;
  });

  if (allSlow) {
    state.settleCount++;
    if (state.settleCount >= SETTLE_FRAMES_NEEDED) {
      return true;
    }
  } else {
    state.settleCount = 0;
  }

  return false;
}

/**
 * 안정된 동전을 읽어 효값을 반환
 * @returns {{ value:number, coins:boolean[], yang:boolean, changing:boolean }}
 */
export function readCoinResults(coins) {
  let sum = 0;
  const coinResults = [];

  coins.forEach(({ body }) => {
    let heads;

    if (state.forceSettled) {
      // 타임아웃 강제 안정: 동전이 아직 회전 중이므로 랜덤 판정
      heads = Math.random() >= 0.5;
    } else {
      // 자연 안정: 물리 기반 판정 (동전이 납작하게 놓인 경우)
      const localUp = new CANNON.Vec3(0, 1, 0);
      const worldUp = new CANNON.Vec3();
      body.quaternion.vmult(localUp, worldUp);
      const flatness = Math.abs(worldUp.y);

      if (flatness > 0.3) {
        heads = worldUp.y > 0;
      } else {
        // 동전이 세워져 있음 — 랜덤 판정
        heads = Math.random() >= 0.5;
      }
    }

    const val = heads ? 3 : 2;
    sum += val;
    coinResults.push(heads);
  });

  // 6=노음(변), 7=소양, 8=소음, 9=노양(변)
  const yang = (sum === 7 || sum === 9);
  const changing = (sum === 6 || sum === 9);

  return { value: sum, coins: coinResults, yang, changing };
}

/**
 * 현재 throw 결과를 기록
 */
export function recordLine(result) {
  state.lines.push({
    value: result.value,
    yang: result.yang,
    changing: result.changing,
  });
  state.currentThrow++;
  state.phase = state.currentThrow >= TOTAL_THROWS ? 'complete' : 'ready';
}

/**
 * 본괘 + (변효가 있으면) 지괘 데이터를 반환
 */
export function buildHexagram() {
  const bits = state.lines.map(l => l.yang ? 1 : 0);
  const primaryNum = getHexagramNumber(bits);
  const primary = getHexagramData(primaryNum);

  // 변효가 있는지 확인
  const hasChanging = state.lines.some(l => l.changing);
  let changed = null;
  let changedNum = null;

  if (hasChanging) {
    // 변효를 뒤집은 지괘
    const changedBits = state.lines.map(l => {
      if (l.changing) return l.yang ? 0 : 1; // 뒤집기
      return l.yang ? 1 : 0;
    });
    changedNum = getHexagramNumber(changedBits);
    changed = getHexagramData(changedNum);
  }

  // 점단: 변효 개수에 따른 해석
  const interpretation = interpret(primaryNum, changedNum, state.lines);

  return { primary, changed, lines: state.lines, interpretation };
}

/**
 * 게임 상태 초기화
 */
export function resetGame(coins) {
  state.phase = 'ready';
  state.currentThrow = 0;
  state.lines = [];
  state.settleCount = 0;
  state.throwStartTime = 0;
  resetCoins(coins);
}
