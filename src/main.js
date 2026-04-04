import './style.css';
import { createScene } from './scene.js';
import { createWorld } from './physics.js';
import { createCoins, syncMeshesToBodies } from './coins.js';
import {
  state, throwCoins, checkSettled, readCoinResults,
  recordLine, buildHexagram, resetGame,
} from './game.js';
import { getHexagramData, getHexagramBits } from './hexagrams.js';
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
    addHexagramLine(result.yang, result.changing);
    updateThrowCounter(state.currentThrow);

    if (state.phase === 'complete') {
      setTimeout(() => {
        const { primary, changed, lines } = buildHexagram();
        showResult(primary, changed, lines);
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
      const changed = changedParam ? getHexagramData(parseInt(changedParam)) : null;
      const bits = getHexagramBits(hexNum);
      const lines = bits.map(b => ({
        value: b ? 7 : 8,
        yang: !!b,
        changing: false,
      }));
      setTimeout(() => showResult(primary, changed, lines), 300);
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
