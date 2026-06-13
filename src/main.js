import './style.css';
import { createScene } from './scene.js';
import { createWorld } from './physics.js';
import { createCoins, syncMeshesToBodies } from './coins.js';
import {
  state, throwCoins, checkSettled, readCoinResults,
  recordLine, buildHexagram, resetGame,
} from './game.js';
import { getHexagramData, getHexagramBits } from './hexagrams.js';
import { interpret } from './interpret.js';
import {
  setButtonEnabled, updateThrowCounter, addHexagramLine,
  clearHexagramLines, showCoinResult, clearCoinResult,
  showResult, hideResult, hideLoading, bindEvents,
} from './ui.js';

// --- Init (async for texture loading) ---
(async () => {
  const canvas = document.getElementById('scene');
  const { renderer, scene, camera, controls } = createScene(canvas);
  const world = createWorld();
  const coins = await createCoins(scene, world);

  // --- 이벤트 ---
  bindEvents({
    onThrow: () => {
      if (state.phase !== 'ready') return;
      setButtonEnabled(false);
      clearCoinResult();
      throwCoins(coins);
    },
    onNewReading: () => {
      hideResult();
      resetGame(coins);
      clearHexagramLines();
      clearCoinResult();
      updateThrowCounter(0);
      setButtonEnabled(true);
    },
  });

  function onSettled() {
    const result = readCoinResults(coins);
    recordLine(result);

    showCoinResult(result.coins, result.value, result.yang, result.changing);
    addHexagramLine(result.yang, result.changing, result.value);
    updateThrowCounter(state.currentThrow);

    if (state.phase === 'complete') {
      setTimeout(() => {
        const { primary, changed, lines, interpretation } = buildHexagram();
        showResult(primary, changed, lines, interpretation);
      }, 800);
    } else {
      setTimeout(() => setButtonEnabled(true), 400);
    }
  }

  // 로딩 완료
  hideLoading();

  // --- 쿼리 파라미터: ?hex=1 또는 ?hex=1&changed=2 ---
  const params = new URLSearchParams(location.search);
  const hexParam = params.get('hex');
  if (hexParam) {
    const hexNum = parseInt(hexParam);
    const primary = getHexagramData(hexNum);
    if (primary) {
      const changedParam = params.get('changed');
      const changedNum = changedParam ? parseInt(changedParam) : null;
      const changed = changedNum ? getHexagramData(changedNum) : null;
      const bits = getHexagramBits(hexNum);

      // 지괘가 있으면 본괘/지괘 비트 차이로 변효를 복원
      let lines;
      if (changed) {
        const cbits = getHexagramBits(changedNum);
        lines = bits.map((b, i) => {
          const yang = !!b;
          const changing = b !== cbits[i];
          return { value: changing ? (yang ? 9 : 6) : (yang ? 7 : 8), yang, changing };
        });
      } else {
        lines = bits.map(b => ({ value: b ? 7 : 8, yang: !!b, changing: false }));
      }

      const interpretation = interpret(hexNum, changedNum, lines);
      setTimeout(() => showResult(primary, changed, lines, interpretation), 300);
      setButtonEnabled(false);
    }
  }

  // --- Animation Loop ---
  const fixedTimeStep = 1 / 60;
  let lastTime = performance.now();

  function animate(now) {
    requestAnimationFrame(animate);
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    world.step(fixedTimeStep, dt, 3);
    syncMeshesToBodies(coins);

    if (state.phase === 'throwing' && checkSettled(coins)) {
      state.phase = 'settled';
      onSettled();
    }

    controls.update();
    renderer.render(scene, camera);
  }

  requestAnimationFrame(animate);
})();
