// 동전 소리: 오디오 파일 없이 WebAudio 로 모달 합성한다.
//  - 동전: 청동 엽전의 비조화 부분음(약 2.3~8.9kHz) 5개를 노이즈 타격으로 울리는 공진 필터로, 동전마다 미세하게 다른 값
//  - 판(칠기 쟁반): 저역 통과 노이즈 '툭' + 낮은 몸통 공명
//  - 닿는 순간: 1~3ms 의 밝은 노이즈 딸깍(타격 전이음)
// 물리 엔진(Rapier) 접촉 세기 이벤트가 impact() 를, 구르기·흔들기가 rollTick()·shakeClinks() 를 부른다.
// AudioContext 는 사용자 동작(버튼) 안에서만 만들거나 다시 켠다.

const KEY = 'iching.muted';

// [주파수 Hz, 잔향 T60 초, 상대 크기]. 원판 굽힘 모드 비(1 : 1.73 : 2.33 …)를 바탕으로
// 사각 구멍·주조 거칠기 때문에 어긋난 값을 쓴다.
const COIN_MODES = [
  [3150, 0.2, 1.0],
  [5460, 0.14, 0.62],
  [7330, 0.1, 0.46],
  [8780, 0.075, 0.3],
  [2290, 0.07, 0.22],
];

// 동전 세 닢이 조금씩 다른 소리를 내도록 고정된 편차(전체 배율, 부분음별 편차)
const COIN_VARIANTS = [
  { k: 1.0, d: [0, 0.012, -0.018, 0.009, -0.01] },
  { k: 0.955, d: [0.006, -0.015, 0.011, -0.02, 0.014] },
  { k: 1.047, d: [-0.009, 0.02, -0.006, 0.016, 0.004] },
];

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * 어떤 BaseAudioContext(실시간·오프라인)에도 붙일 수 있는 합성기.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} out
 */
export function createSynth(ctx, out) {
  const sr = ctx.sampleRate;
  // 미리 만든 백색 소음 1초(재사용)
  const noise = ctx.createBuffer(1, sr, sr);
  {
    const d = noise.getChannelData(0);
    let seed = 1031;
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 16807) % 2147483647;
      d[i] = (seed / 2147483647) * 2 - 1;
    }
  }

  let voicesUntil = []; // 동시 발음 제한용: 각 소리의 끝 시각
  const MAX_VOICES = 12;

  function claimVoice(when, dur) {
    voicesUntil = voicesUntil.filter((t) => t > ctx.currentTime);
    if (voicesUntil.length >= MAX_VOICES) return false;
    voicesUntil.push(when + dur);
    return true;
  }

  function panNode(pan) {
    if (!ctx.createStereoPanner || !pan) return null;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-0.7, Math.min(0.7, pan));
    return p;
  }

  function noiseBurst(dest, when, dur, gain, filterType, freq, q = 0.7) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.0006);
    g.gain.setTargetAtTime(0, when + 0.0006, dur / 4);
    src.connect(f).connect(g).connect(dest);
    const off = Math.random() * 0.8;
    src.start(when, off, dur * 1.6 + 0.01);
  }

  /**
   * 동전 한 닢의 울림(모달 합성): 짧은 노이즈 타격이 동전의 공진(좁은 대역 필터)들을 울린다.
   * 공진마다 감쇠 시간(T60)이 다르고, 들뜸이 노이즈라 매번 결이 조금씩 다르다.
   */
  function ring(dest, when, coin, strength, ringScale, gain) {
    const v = COIN_VARIANTS[coin % 3];
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const exc = ctx.createGain();
    const exDur = 0.0035 - strength * 0.002; // 세게 칠수록 짧고 날카로운 타격
    exc.gain.setValueAtTime(0, when);
    exc.gain.linearRampToValueAtTime(1, when + 0.0003);
    exc.gain.setTargetAtTime(0, when + 0.0003, exDur / 3);
    src.connect(exc);
    let longest = 0;
    COIN_MODES.forEach(([f0, t60, amp], k) => {
      // 약하게 부딪히면 높은 부분음이 덜 울린다(밝기)
      const a = gain * amp * Math.pow(Math.max(0.05, strength), 0.15 + k * 0.22);
      if (a < 0.0008) return;
      const f = f0 * v.k * (1 + v.d[k]);
      const t = t60 * ringScale;
      longest = Math.max(longest, t);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = (Math.PI * f * t) / 6.91;
      const g = ctx.createGain();
      // 좁은 대역일수록 들어오는 에너지가 적으므로 Q 에 맞춰 키운다
      g.gain.value = a * Math.sqrt(bp.Q.value) * 4.6;
      exc.connect(bp).connect(g).connect(dest);
    });
    src.start(when, Math.random() * 0.8, exDur * 4 + 0.01);
    return longest;
  }

  /** 판(칠기 쟁반)의 둔탁한 '툭': 저역 노이즈 + 나무 몸통 공진(낮은 Q) */
  function thud(dest, when, strength, gain) {
    noiseBurst(dest, when, 0.016 + strength * 0.02, gain * 0.8, 'lowpass', 380 + strength * 1000, 0.7);
    noiseBurst(dest, when, 0.03, gain * 1.6, 'bandpass', 230 + strength * 60, 2.2);
  }

  return {
    /**
     * 충돌음
     * @param {{ kind:'table'|'coin', strength:number, coin:number, other?:number, pan?:number, when?:number }} e
     */
    impact(e) {
      const s = clamp01(e.strength);
      const when = e.when ?? ctx.currentTime + 0.004;
      const dur = e.kind === 'coin' ? 0.22 : 0.12;
      if (!claimVoice(when, dur)) return;
      const bus = ctx.createGain();
      bus.gain.value = 1;
      const p = panNode(e.pan);
      if (p) bus.connect(p).connect(out); else bus.connect(out);
      const level = 0.05 + 0.32 * Math.pow(s, 0.85);
      // 타격 전이음: 세게 칠수록 짧고 밝다
      noiseBurst(bus, when, 0.0025 - s * 0.0013, level * 0.55, 'bandpass', 4200 + s * 4500, 0.8);
      if (e.kind === 'coin') {
        // 동전끼리: 두 닢 모두 길게 운다
        ring(bus, when, e.coin, s, 0.85, level * 0.55);
        ring(bus, when + 0.0007, e.other ?? (e.coin + 1), s * 0.9, 0.8, level * 0.45);
      } else {
        // 판에 닿으면 울림이 판에 눌려 금방 죽는다
        ring(bus, when, e.coin, s, 0.38, level * 0.42);
        thud(bus, when, s, level * 0.9);
      }
    },

    /** 구르거나 눕기 직전 흔들리며 판을 스치는 아주 작은 충격 */
    rollTick(coin, intensity, pan = 0, when = ctx.currentTime + 0.003) {
      const s = clamp01(intensity);
      if (s < 0.02 || !claimVoice(when, 0.03)) return;
      const bus = ctx.createGain();
      const p = panNode(pan);
      if (p) bus.connect(p).connect(out); else bus.connect(out);
      const level = 0.012 + 0.07 * s;
      noiseBurst(bus, when, 0.0015, level * 0.5, 'bandpass', 3800 + s * 2500, 0.9);
      ring(bus, when, coin, 0.25 + s * 0.4, 0.12, level * 0.5);
      thud(bus, when, 0.1, level * 0.35);
    },

    /** 손 안에서 흔들 때: 동전끼리 짤랑(1~3번, 매번 조금씩 다르게) */
    shakeClinks(intensity, when = ctx.currentTime + 0.003) {
      const s = clamp01(intensity);
      const n = 1 + Math.floor(Math.random() * (s > 0.5 ? 3 : 2));
      for (let i = 0; i < n; i++) {
        const a = Math.floor(Math.random() * 3);
        const b = (a + 1 + Math.floor(Math.random() * 2)) % 3;
        this.impact({
          kind: 'coin',
          strength: 0.18 + s * 0.45 * (0.6 + Math.random() * 0.4),
          coin: a,
          other: b,
          pan: (Math.random() - 0.5) * 0.4,
          when: when + i * (0.012 + Math.random() * 0.03),
        });
      }
    },
  };
}

/* ---------------- 실시간 재생(사이트에서 쓰는 단일 인스턴스) ---------------- */

let ctx = null;
let synth = null;
let muted = false;
try { muted = localStorage.getItem(KEY) === '1'; } catch (e) { /* 저장소 차단 */ }

export function isMuted() { return muted; }

export function setMuted(v) {
  muted = !!v;
  try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch (e) { /* 저장소 차단 */ }
  if (!muted) unlockAudio();
}

let gestureArmed = false;

/**
 * 사용자 동작(버튼 클릭) 안에서만 부른다: 이때 처음 오디오를 열거나 다시 켠다.
 * iOS 는 전화·다른 앱·화면 잠금 뒤 'interrupted' 상태가 되므로 'running' 이 아니면 모두 resume 을 시도한다.
 */
export function unlockAudio() {
  if (muted) return;
  if (ctx && ctx.state === 'closed') { ctx = null; synth = null; }
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      return; // 오디오를 열 수 없는 환경: 소리 없이 계속
    }
    const master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 6;
    comp.attack.value = 0.001;
    comp.release.value = 0.08;
    master.connect(comp).connect(ctx.destination);
    synth = createSynth(ctx, master);
    // 중단되면(iOS interrupted 등) 다음 사용자 동작에서 다시 켠다
    ctx.addEventListener('statechange', () => { if (ctx && ctx.state !== 'running') armGestureResume(); });
  }
  if (ctx.state !== 'running') {
    const p = ctx.resume();
    if (p && p.catch) p.catch(() => armGestureResume());
  }
}

/** 다음 한 번의 사용자 동작(탭·키) 안에서 오디오를 다시 켜도록 걸어 둔다 */
function armGestureResume() {
  if (gestureArmed || muted || typeof window === 'undefined') return;
  gestureArmed = true;
  const once = () => {
    gestureArmed = false;
    window.removeEventListener('pointerup', once, true);
    window.removeEventListener('click', once, true);
    window.removeEventListener('keydown', once, true);
    unlockAudio();
  };
  // 사용자 활성화가 생기는 이벤트에서(터치는 pointerdown 이 아니라 pointerup·click)
  window.addEventListener('pointerup', once, true);
  window.addEventListener('click', once, true);
  window.addEventListener('keydown', once, true);
}

if (typeof document !== 'undefined') {
  // 탭이 다시 보이면 자동으로 재생하지 않고, 다음 사용자 동작에서 재개한다
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ctx && ctx.state !== 'running') armGestureResume();
  });
}

const live = () => !muted && ctx && ctx.state === 'running' && synth;

export function playImpact(e) { if (live()) synth.impact(e); }
export function playRollTick(coin, intensity, pan) { if (live()) synth.rollTick(coin, intensity, pan); }
export function playShakeClinks(intensity) { if (live()) synth.shakeClinks(intensity); }
