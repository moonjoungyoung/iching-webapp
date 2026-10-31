// 인트로 진행: 그림 자체는 CSS 애니메이션(첫 페인트부터 시작)이고,
// 여기서는 언제 걷어낼지와 건너뛰기만 다룬다.

// 인장이 찍힌 뒤 잠깐 머무는 시간(ms). 애니메이션을 못 읽는 환경은 페이지 시작 기준 상한으로 넘어간다
const LINGER = { full: 380, short: 160 };
const FALLBACK = { full: 4200, short: 1600, reduced: 650 };

/**
 * @param {{ onLeave?: () => void }} opts onLeave: 한지가 걷히기 시작할 때(다음 화면을 띄울 때)
 * @returns {Promise<void>} 인트로가 완전히 사라지면
 */
export function runIntro({ onLeave } = {}) {
  const el = document.getElementById('intro');
  const mode = document.documentElement.dataset.intro || 'full';
  if (!el || mode === 'none') {
    if (el) el.remove();
    if (onLeave) onLeave();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let leaving = false;
    const skipBtn = document.getElementById('intro-skip');

    function cleanup() {
      window.removeEventListener('keydown', onKey);
      el.removeEventListener('pointerdown', onPointer);
    }

    function leave(fast) {
      if (leaving) return;
      leaving = true;
      cleanup();
      el.classList.add('is-leaving');
      if (fast) el.classList.add('is-fast');
      if (onLeave) onLeave();
      const done = () => { el.remove(); resolve(); };
      el.addEventListener('animationend', (e) => { if (e.target === el) done(); }, { once: true });
      setTimeout(() => { if (el.isConnected) done(); }, fast ? 700 : 1300);
    }

    function onKey(e) {
      if (e.key === 'Tab' || e.key === 'Shift') return;
      leave(true);
    }
    function onPointer(e) {
      if (e.target === skipBtn) return;
      leave(true);
    }

    skipBtn.addEventListener('click', () => leave(true));
    window.addEventListener('keydown', onKey);
    el.addEventListener('pointerdown', onPointer);

    // 인장 찍힘 애니메이션이 끝난 뒤 걷어낸다(CSS 로드 시점과 무관하게 인장이 꼭 보이도록)
    const seal = el.querySelector('.intro-seal');
    const anims = mode !== 'reduced' && seal && seal.getAnimations ? seal.getAnimations() : [];
    const fallback = Math.max(0, (FALLBACK[mode] || FALLBACK.full) - performance.now());
    if (anims.length) {
      Promise.all(anims.map((a) => a.finished))
        .then(() => setTimeout(() => leave(false), LINGER[mode] || 0))
        .catch(() => leave(false));
      setTimeout(() => leave(false), fallback + 1500);
    } else {
      setTimeout(() => leave(false), fallback);
    }
  });
}
