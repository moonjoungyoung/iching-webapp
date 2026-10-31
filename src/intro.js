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
// 전환 곡선: easeOutCubic 을 0.1 간격 11개 키로 잘라 둔 것. 한지가 걷히는 크기(WAAPI 키프레임, 구간마다 linear)와
// 3D 카메라 진입(stage.playEntrance 의 ease)이 이 같은 키를 같은 방식으로 보간하므로 두 움직임이 정확히 같은 박자로 간다
export const LEAVE_KEYS = Array.from({ length: 11 }, (_, i) => { const t = i / 10; return [t, 1 - Math.pow(1 - t, 3)]; });
export function leaveProgress(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const i = Math.min(LEAVE_KEYS.length - 2, Math.floor(t * 10));
  const [t0, p0] = LEAVE_KEYS[i], [t1, p1] = LEAVE_KEYS[i + 1];
  return p0 + ((p1 - p0) * (t - t0)) / (t1 - t0);
}
// 한지 층의 크기 배율: 처음 0.3 배(먹 자국이 손톱만 할 때)에서 26 배(먹 자국이 화면 전체를 덮을 때)까지,
// 진행도에 대해 지수로 키운다(먹이 번지는 속도가 크기에 비례해 보이도록)
const PAPER_S0 = 0.3, PAPER_S1 = 26;
const paperScale = (p) => PAPER_S0 * Math.pow(PAPER_S1 / PAPER_S0, p);
const maskSupported = () => typeof CSS !== 'undefined' && CSS.supports
  && (CSS.supports('mask-composite', 'exclude') || CSS.supports('-webkit-mask-composite', 'xor'));

/**
 * @param {{
 *   prepare?: () => Promise<any>,
 *   onLeave?: (t: { dur:number, reduced:boolean, ready:boolean, ease:(t:number)=>number }) => void,
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
    if (onLeave) onLeave({ dur: 0, reduced: true, ready: false });
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
      // 3D 장면(첫 프레임까지)이 준비되기를 잠깐 기다린다(건너뛰기는 짧게). 제한 시간을 넘기면 ready=false:
      // 이때는 카메라 진입 없이 전환만 하고, 늦게 준비된 장면은 최종 구도로 바로 나타난다
      const p = startPrepare();
      let ready = !prepare;
      if (p) ready = await Promise.race([p.then(() => true, () => false), new Promise((r) => later(() => r(false), fast ? 600 : 1800))]);
      const reduced = mode === 'reduced';
      const dur = reduced ? LEAVE_MS.reduced : fast ? LEAVE_MS.fast : LEAVE_MS[mode] || LEAVE_MS.full;
      el.style.setProperty('--leave', `${dur}ms`);
      el.classList.add('is-leaving');
      if (fast) el.classList.add('is-fast');
      const paper = el.querySelector('.intro-paper');
      if (!reduced && paper && paper.animate && maskSupported()) {
        // 컴포지터에서 도는 변환만 쓴다: 마스크(먹 자국 구멍)는 고정 크기로 한 번 그리고, 한지 층 전체를 transform: scale 로 키운다
        el.classList.add('is-opening');
        paper.animate(
          LEAVE_KEYS.map(([t, p]) => ({ offset: t, transform: `translate(-50%, -50%) scale(${paperScale(p).toFixed(4)})` })),
          { duration: dur, easing: 'linear', fill: 'forwards' },
        );
        // 먹 자국의 들쭉날쭉한 가장자리 바깥에 남는 모서리는 끝 무렵 함께 옅어진다
        el.animate([{ opacity: 1, offset: 0 }, { opacity: 1, offset: 0.6 }, { opacity: 0, offset: 0.85 }, { opacity: 0, offset: 1 }],
          { duration: dur, fill: 'forwards' });
      } else if (!reduced && el.animate) {
        // 마스크 합성을 못 하는 브라우저: 같은 길이·같은 곡선으로 겹쳐 사라지기
        el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: 'cubic-bezier(0.33, 1, 0.68, 1)', fill: 'forwards' });
      }
      if (onLeave) onLeave({ dur, reduced, ready, ease: leaveProgress });
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
