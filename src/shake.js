// 폰 흔들기 → 털기(flick)로 동전 던지기.
// 흔드는 동안 기운(energy)을 모으고, 평소보다 큰 가속 피크 뒤에 손이 멎으면 던진다.
// 동작의 세기는 던지는 힘·회전에만 반영되고, 동전의 처음 자세는 언제나 무작위라 결과는 공정하다.

const SHAKE_MIN = 6; //        m/s². 중력을 뺀 가속도가 이보다 크면 흔드는 중
const FLICK_PEAK = 19; //      털기로 볼 최소 피크
const FLICK_OVER_SHAKE = 1.25; // 털기 피크는 흔들 때 평균 피크보다 이만큼 커야 한다
const CALM = 4.5; //           털고 난 뒤 잠잠함 기준
const CALM_MS = 130; //        잠잠함이 이만큼 이어져야 털기 확정
const PEAK_WINDOW = 480; //    피크 뒤 이 안에 잠잠해져야 한다(ms)
const MIN_CHARGE = 0.2; //     조금이라도 흔들어 모은 뒤에만 던진다
const COOLDOWN = 1400; //      연속 트리거 방지(ms)
const TICK_MS = 110;

import { now } from './clock.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * @param {{
 *   canUse: () => boolean,
 *   onAvailable?: () => void,
 *   onCharge?: (energy:number) => void,
 *   onTick?: (intensity:number) => void,
 *   onFlick?: (opts:{power:number, spin:number, dirX:number}) => void,
 *   onSample?: (ax:number, ay:number, az:number) => void,
 * }} h
 *   onSample: 가속도 표본 하나하나(손 안 그릇을 흔드는 데 쓴다). canUse 일 때만 부른다
 */
export function createShake(h) {
  let attached = false;
  let available = false;
  let energy = 0;
  let lastT = 0;
  let lastTick = 0;
  let lastReported = -1;
  let grav = null;
  let prevM = 0;
  let rising = false;
  let shakePeakAvg = 0;
  let peak = null;
  let calmSince = 0;
  let cooldownUntil = 0;

  function report(force) {
    if (force || Math.abs(energy - lastReported) > 0.015) {
      lastReported = energy;
      if (h.onCharge) h.onCharge(energy);
    }
  }

  function resetCharge() {
    energy = 0;
    peak = null;
    calmSince = 0;
    shakePeakAvg = 0;
    report(true);
  }

  /** 가속도 표본 하나(중력 제외, m/s²)를 처리한다 */
  function sample(ax, ay, az, t) {
    const dt = lastT ? Math.min(0.1, Math.max(0, (t - lastT) / 1000)) : 1 / 60;
    lastT = t;
    if (!h.canUse() || t < cooldownUntil) {
      if (energy > 0 || peak) resetCharge();
      prevM = 0;
      return;
    }
    const m = Math.hypot(ax, ay, az);
    if (h.onSample) h.onSample(ax, ay, az);

    // 기운 모으기
    if (m > SHAKE_MIN) energy = clamp01(energy + (m - SHAKE_MIN) * dt * 0.12);
    else energy = clamp01(energy - dt * 0.3);

    if (energy > 0.04 && m > SHAKE_MIN && t - lastTick > TICK_MS) {
      lastTick = t;
      if (h.onTick) h.onTick(clamp01((m - SHAKE_MIN) / 18));
    }

    // 국소 최댓값: 흔들 때의 평균 피크와 비교해 유난히 큰 것만 털기 후보
    if (m < prevM && rising && prevM > SHAKE_MIN) {
      const localMax = prevM;
      const need = Math.max(FLICK_PEAK, shakePeakAvg * FLICK_OVER_SHAKE);
      if (localMax >= need && energy >= MIN_CHARGE) {
        peak = { m: localMax, t, x: ax, y: ay };
      }
      shakePeakAvg = shakePeakAvg ? shakePeakAvg * 0.75 + localMax * 0.25 : localMax;
    }
    rising = m > prevM;
    prevM = m;

    if (m < CALM) { if (!calmSince) calmSince = t; } else calmSince = 0;

    if (peak && t - peak.t > PEAK_WINDOW + CALM_MS) peak = null;
    if (peak && calmSince && t - calmSince >= CALM_MS && calmSince - peak.t < PEAK_WINDOW) {
      const opts = {
        power: clamp01(((peak.m - FLICK_PEAK) / 24) * 0.6 + energy * 0.4),
        spin: clamp01(energy),
        dirX: Math.max(-1, Math.min(1, (peak.x / (peak.m || 1)) * 1.6)),
      };
      cooldownUntil = t + COOLDOWN;
      resetCharge();
      if (h.onFlick) h.onFlick(opts);
      return;
    }
    report(false);
  }

  function onMotion(e) {
    let x, y, z;
    const a = e.acceleration;
    if (a && Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z)) {
      x = a.x; y = a.y; z = a.z;
    } else {
      const g = e.accelerationIncludingGravity;
      if (!g || !Number.isFinite(g.x)) return;
      // 중력 성분을 저역 통과로 추정해서 뺀다
      if (!grav) grav = { x: g.x, y: g.y, z: g.z };
      grav.x += (g.x - grav.x) * 0.1; grav.y += (g.y - grav.y) * 0.1; grav.z += (g.z - grav.z) * 0.1;
      x = g.x - grav.x; y = g.y - grav.y; z = g.z - grav.z;
    }
    if (!available) {
      available = true;
      if (h.onAvailable) h.onAvailable();
    }
    sample(x, y, z, now());
  }

  function attach() {
    if (attached || typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return;
    attached = true;
    window.addEventListener('devicemotion', onMotion);
  }

  // 권한이 따로 필요 없는 기기(안드로이드 등)는 바로 듣는다
  const needsPermission = typeof window !== 'undefined' && window.DeviceMotionEvent
    && typeof window.DeviceMotionEvent.requestPermission === 'function';
  if (!needsPermission) attach();

  return {
    get available() { return available; },
    /** iOS 13+ 처럼 사용자 동작 안에서 권한을 물어야 하는 기기 */
    needsPermission: !!needsPermission,
    /** 사용자 동작(클릭) 안에서 불러야 한다: iOS 13+ 권한 요청 */
    requestPermission() {
      if (!needsPermission || attached) return Promise.resolve(attached);
      return window.DeviceMotionEvent.requestPermission()
        .then((r) => { if (r === 'granted') attach(); return r === 'granted'; })
        .catch(() => false);
    },
    reset: resetCharge,
  };
}
