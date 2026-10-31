import { getHexagramNumber, getHexagramData } from './hexagrams.js';
import { interpret } from './interpret.js';

export const TOTAL_THROWS = 6;

export const state = {
  phase: 'ready', // ready | throwing | complete
  currentThrow: 0,
  lines: [], // { value:6|7|8|9, yang:boolean, changing:boolean } 아래(初爻)→위
};

/**
 * 동전 세 닢의 앞뒷면(물리 판정)으로 효값을 만든다. 앞면(陽)=3, 뒷면(陰)=2
 * @param {boolean[]} faces true = 앞면
 */
export function lineFromFaces(faces) {
  const value = faces.reduce((s, h) => s + (h ? 3 : 2), 0);
  // 6=老陰(변), 7=少陽, 8=少陰, 9=老陽(변)
  return {
    value,
    coins: faces,
    yang: value === 7 || value === 9,
    changing: value === 6 || value === 9,
  };
}

export function recordLine(result) {
  state.lines.push({ value: result.value, yang: result.yang, changing: result.changing });
  state.currentThrow++;
  state.phase = state.currentThrow >= TOTAL_THROWS ? 'complete' : 'ready';
}

/**
 * 본괘 + (변효가 있으면) 지괘 + 점단
 */
export function buildHexagram(lines = state.lines) {
  const primaryNum = getHexagramNumber(lines.map((l) => (l.yang ? 1 : 0)));
  const primary = getHexagramData(primaryNum);

  let changed = null;
  let changedNum = null;
  if (lines.some((l) => l.changing)) {
    changedNum = getHexagramNumber(lines.map((l) => (l.changing ? !l.yang : l.yang) ? 1 : 0));
    changed = getHexagramData(changedNum);
  }

  const interpretation = interpret(primaryNum, changedNum, lines);
  return { primary, changed, lines, interpretation };
}

export function resetGame() {
  state.phase = 'ready';
  state.currentThrow = 0;
  state.lines = [];
}
