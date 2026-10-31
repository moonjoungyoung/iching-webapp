import { later, now } from './clock.js';

// 인트로 진행: 그림 자체는 CSS 애니메이션(첫 페인트부터 시작)이고,
// 여기서는 언제 걷어낼지, 건너뛰기, 그리고 첫 화면으로 이어지는 전환의 박자만 다룬다.
//
// 전환: 한지가 먹이 번지듯(가장자리가 들쭉날쭉한 먹 자국 모양으로) 가운데부터 걷히고,
// 같은 시간·같은 곡선으로 3D 카메라가 위에서 내려다보다 손 앞 시점으로 내려앉는다(stage.playEntrance).
// 끝 무렵 동전이 손 안으로 떨어진다. 전환이 멈칫하지 않도록 3D 장면은 붓질이 끝난 직후 미리 만든다.

// 인장이 찍힌 뒤 잠깐 머무는 시간(ms). 애니메이션을 못 읽는 환경은 페이지 시작 기준 상한으로 넘어간다
const LINGER = { full: 260, short: 120 };
const FALLBACK = { full: 4200, short: 1600, reduced: 650 };
// 전환 길이(ms)
export const LEAVE_MS = { full: 1200, short: 1000, fast: 400, reduced: 300 };
// 전환 곡선: ease-out(3D 쪽 easeOutCubic 과 같은 곡선)
export const LEAVE_EASE_CSS = 'cubic-bezier(0.33, 1, 0.68, 1)';

/**
 * @param {{
 *   prepare?: () => Promise<any>,
 *   onLeave?: (t: { dur:number, reduced:boolean }) => void,
 * }} opts
 *   prepare: 전환 전에 끝나 있어야 할 준비(3D 장면 만들기). 붓질이 끝나면 시작하고, 떠나기 전에 잠시 기다린다
 *   onLeave: 전환이 시작될 때(다음 화면 띄우기 + 카메라 진입을 같은 길이로)
 * @returns {Promise<void>} 인트로가 완전히 사라지면
 */
export function runIntro({ prepare, onLeave } = {}) {
  const el = document.getElementById('intro');
  const mode = document.documentElement.dataset.intro || 'full';
  let prepared = null;
  const startPrepare = () => { if (!prepared && prepare) prepared = Promise.resolve(prepare()).catch(() => {}); return prepared; };
  if (!el || mode === 'none') {
    if (el) el.remove();
    startPrepare();
    if (onLeave) onLeave({ dur: 0, reduced: true });
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let leaving = false;
    const skipBtn = document.getElementById('intro-skip');

    function cleanup() {
      window.removeEventListener('keydown', onKey);
      el.removeEventListener('pointerdown', onPointer);
    }

    async function leave(fast) {
      if (leaving) return;
      leaving = true;
      cleanup();
      // 3D 장면이 준비되기를 잠깐 기다린다(건너뛰기는 짧게)
      const p = startPrepare();
      if (p) await Promise.race([p, new Promise((r) => later(r, fast ? 600 : 1800))]);
      const reduced = mode === 'reduced';
      const dur = reduced ? LEAVE_MS.reduced : fast ? LEAVE_MS.fast : LEAVE_MS[mode] || LEAVE_MS.full;
      el.style.setProperty('--leave', `${dur}ms`);
      el.classList.add('is-leaving');
      if (fast) el.classList.add('is-fast');
      if (onLeave) onLeave({ dur, reduced });
      later(() => { el.remove(); resolve(); }, dur + 40);
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

    // 붓질(효·제목)이 끝나면 3D 장면을 미리 만든다. 인장 찍힘은 합성 스레드 애니메이션이라 끊기지 않는다
    const title = el.querySelector('.intro-title');
    const titleAnims = mode !== 'reduced' && title && title.getAnimations ? title.getAnimations() : [];
    if (titleAnims.length) Promise.all(titleAnims.map((a) => a.finished)).then(startPrepare, startPrepare);
    else startPrepare();

    // 인장 찍힘 애니메이션이 끝난 뒤 걷어낸다(CSS 로드 시점과 무관하게 인장이 꼭 보이도록)
    const seal = el.querySelector('.intro-seal');
    const anims = mode !== 'reduced' && seal && seal.getAnimations ? seal.getAnimations() : [];
    const fallback = Math.max(0, (FALLBACK[mode] || FALLBACK.full) - now());
    if (anims.length) {
      Promise.all(anims.map((a) => a.finished))
        .then(() => later(() => leave(false), LINGER[mode] || 0))
        .catch(() => leave(false));
      later(() => leave(false), fallback + 1500);
    } else {
      later(() => leave(false), fallback);
    }
  });
}
