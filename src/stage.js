// 3D 무대: three.js 장면 + Rapier 물리 + 필요할 때만 그리는 렌더 루프.
// 동전은 던지기 전 판 앞쪽 위의 손(보이지 않는 그릇, kinematic) 안에 있다.
// 흔들면 그릇이 움직이고 동전이 그 안에서 부딪히며, 놓으면 그릇이 열려 판으로 던져진다.
// main.js 가 동적 import 하므로 three/Rapier 는 첫 화면을 막지 않는다.
import * as THREE from 'three';
import { createScene } from './scene.js';
import { createCoinMeshes } from './coins.js';
import { PHYS, createCoinWorld, upY, autoShakeOffset, createWristSpring } from './physics-core.js';
import { playImpact, playRollTick } from './sound.js';
import { now as clockNow, TIME_SCALE } from './clock.js';

const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/**
 * @param {HTMLCanvasElement} canvas
 * @param {Promise<any>} rapierModule import('@dimforge/rapier3d') 결과
 */
export async function createStage(canvas, rapierModule) {
  const s = createScene(canvas);
  const { renderer, scene, camera } = s;
  let view = s.view;

  const meshes = await createCoinMeshes(scene, renderer.capabilities.getMaxAnisotropy() > 4 ? 4 : 2);
  // 물리가 준비되기 전에도 손 안에 쥔 모양으로 보여 준다
  meshes.forEach((m, i) => {
    const C = PHYS.cup;
    m.position.set(C.base.x + (i - 1) * 0.35, C.base.y + C.floorY + 0.08 + i * 0.13, C.base.z + (i % 2) * 0.2);
    m.rotation.set(0.1 * i, i, 0.15);
  });

  // 보간용 이전/현재 자세
  const prev = meshes.map(() => ({ p: new THREE.Vector3(), q: new THREE.Quaternion() }));
  const curr = meshes.map(() => ({ p: new THREE.Vector3(), q: new THREE.Quaternion() }));
  const cupPrev = new THREE.Vector3(), cupCurr = new THREE.Vector3();
  const cupQPrev = new THREE.Quaternion(), cupQCurr = new THREE.Quaternion();
  // 소리: Rapier 접촉 세기 이벤트(충돌음) + 구르기·흔들림의 잦은 미세 충격
  let eventQueue = null;
  let coinMass = 1;
  const coinByHandle = new Map();
  let cupHandles = new Set();
  const pairForce = new Map();
  const pairSeen = new Map();
  const pairLast = new Map();
  const lastCoinSound = meshes.map(() => -1);
  const rollPhase = meshes.map(() => Math.random());
  let stepNo = 0;

  let cw = null;
  // hand: 손 안 / flight: 던져서 판 위에서 움직이는 중 / tray: 판 위에 누워 있음 / gather: 손으로 거두는 중
  let mode = 'hand';
  let acc = 0;
  let settleResolve = null;
  let simClock = 0;

  // --- 흔들기 입력 ---
  const shake = {
    auto: false, //          버튼·키·캔버스를 누르고 있는 동안 자동 흔들기
    autoT: 0,
    phase: Math.random() * 10,
    intensity: 0.7,
    pointer: { x: 0, z: 0 }, // 누른 채 끄는 손 움직임(목표)
    pointerSm: { x: 0, z: 0 }, // 저역 필터를 거친 손 움직임(한 스텝에 튀지 않게)
    motion: createWristSpring(), // 폰 가속도 → 손목 스프링 → 그릇
    settleUntil: 0, //       흔들기를 멈춘 뒤 동전이 손 안에서 가라앉을 때까지 물리를 돌린다
  };
  const handOffset = { x: 0, y: 0, z: 0 };

  // --- 렌더 루프: 움직일 것이 있을 때만 돈다 ---
  let raf = 0;
  let last = 0;
  let contextLost = false;
  const camTarget = view.target.clone();
  const camGoal = view.target.clone();
  let entrance = null;
  let gatherAnim = null;
  // 손(그릇) 윤곽의 짙기: 동전을 쥐고 있을 때만 보이고, 던진 뒤에는 거의 사라진다
  let handVis = 1;
  const handMats = s.hand.children.map((m) => ({ m: m.material, base: m.material.opacity }));
  const shadowBase = s.handShadow.material.opacity;
  // 첫 프레임을 그리면 풀리는 약속(인트로 전환은 이것을 기다린 뒤 시작한다)
  let firstFrameResolve = null;
  const firstFrame = new Promise((r) => { firstFrameResolve = r; });

  // 처음 그린 60프레임의 프레임 시간이 나쁘면 화질을 한 단계 더 낮춘다
  const perf = { samples: [], decided: false };
  function measure(sec) {
    // 카메라 진입 중에는 재지 않는다(인트로 전환과 겹치는 프레임은 사양을 대표하지 않는다)
    if (perf.decided || entrance || sec <= 0 || sec > 0.1) return;
    perf.samples.push(sec);
    if (perf.samples.length < 60) return;
    perf.decided = true;
    const sorted = [...perf.samples].sort((a, b) => a - b);
    if (sorted[Math.floor(sorted.length / 2)] > 1 / 40) s.lowerQuality();
  }

  function request() {
    if (!raf && !document.hidden && !contextLost) raf = requestAnimationFrame(frame);
  }

  function readBody(i) {
    const b = cw.coins[i].body;
    const t = b.translation(), r = b.rotation();
    curr[i].p.set(t.x, t.y, t.z);
    curr[i].q.set(r.x, r.y, r.z, r.w);
  }

  function readCup() {
    const t = cw.cup.body.translation(), r = cw.cup.body.rotation();
    cupCurr.set(t.x, t.y, t.z);
    cupQCurr.set(r.x, r.y, r.z, r.w);
  }

  function snapMeshes() {
    meshes.forEach((m, i) => {
      readBody(i);
      prev[i].p.copy(curr[i].p); prev[i].q.copy(curr[i].q);
      m.position.copy(curr[i].p); m.quaternion.copy(curr[i].q);
    });
    readCup();
    cupPrev.copy(cupCurr); cupQPrev.copy(cupQCurr);
    s.hand.position.copy(cupCurr);
    s.hand.quaternion.copy(cupQCurr);
  }

  function onContactForce(ev) {
    const h1 = ev.collider1(), h2 = ev.collider2();
    const c1 = coinByHandle.get(h1), c2 = coinByHandle.get(h2);
    if (c1 === undefined && c2 === undefined) return;
    // 손(그릇) 벽에 닿는 소리는 내지 않는다(살에 닿는 소리). 손 안에서는 동전끼리 짤랑임만
    if (cupHandles.has(h1) || cupHandles.has(h2)) return;
    const F = ev.maxForceMagnitude();
    const key = h1 < h2 ? `${h1}:${h2}` : `${h2}:${h1}`;
    const prevF = pairSeen.get(key) === stepNo - 1 ? (pairForce.get(key) || 0) : 0;
    pairForce.set(key, F);
    pairSeen.set(key, stepNo);
    const dv = (F * PHYS.dt) / coinMass; // 이 스텝에서 받은 충격을 속도 변화로 환산
    if (dv < 1.4) return;
    // 새로 부딪힌 순간(힘이 갑자기 커짐)만 소리 낸다. 미끄러지며 눌린 접촉은 무시
    const onset = prevF < F * 0.4 || simClock - (pairLast.get(key) ?? -1) > 0.09;
    if (!onset) return;
    const coin = c1 !== undefined ? c1 : c2;
    if (simClock - lastCoinSound[coin] < 0.035) return; // 동전당 쿨다운
    pairLast.set(key, simClock);
    lastCoinSound[coin] = simClock;
    const both = c1 !== undefined && c2 !== undefined;
    playImpact({
      kind: both ? 'coin' : 'table',
      strength: Math.min(1, (dv - 1.4) / 14),
      coin,
      other: both ? (coin === c1 ? c2 : c1) : undefined,
      pan: curr[coin].p.x / 2.6,
    });
  }

  /** 판에 닿은 채 구르거나(모서리) 오일러 원반처럼 눕기 직전 흔들릴 때의 '드르르' */
  function rollSounds() {
    cw.coins.forEach(({ body }, i) => {
      if (body.isSleeping()) { rollPhase[i] = 0; return; }
      const y = curr[i].p.y;
      const uy = Math.abs(upY(body.rotation()));
      const w = body.angvel();
      const om = Math.hypot(w.x, w.y, w.z);
      let rate = 0, k = 0;
      if (y < 0.56 && uy < 0.5 && om > 5) {
        rate = 2 + om * 0.45; // 모서리로 구르기
        k = Math.min(1, om / 36) * 0.7;
      } else if (y < 0.3 && uy > 0.5 && uy < 0.997 && om > 3) {
        const tilt = 1 - uy;
        rate = 3 + (om * 0.35) / Math.sqrt(Math.max(tilt, 0.005)); // 기울기가 작아질수록 빨라진다
        k = Math.min(1, Math.sqrt(tilt) * 2.2) * Math.min(1, om / 15);
      }
      if (!rate) { rollPhase[i] = 0; return; }
      rollPhase[i] += Math.min(70, rate) * PHYS.dt;
      if (rollPhase[i] >= 1) {
        rollPhase[i] -= 1 + (Math.random() - 0.5) * 0.3;
        playRollTick(i, k, curr[i].p.x / 2.6);
      }
    });
  }

  /** 지금 그릇 변위(자동 흔들기 + 폰 가속도 + 누른 손 움직임) */
  function computeHandOffset(dt) {
    const o = { x: 0, y: 0, z: 0 };
    if (shake.auto) {
      shake.autoT += dt;
      const a = autoShakeOffset(shake.autoT, shake.phase, shake.intensity);
      // 누르자마자 확 튀지 않게 0.12초에 걸쳐 진폭을 올린다
      const k = Math.min(1, shake.autoT / 0.12);
      o.x += a.x * k; o.y += a.y * k; o.z += a.z * k;
    }
    // 폰 가속도: 손목 스프링 모형. 가속도를 힘으로 받아 위치로 바꾸고, 놓으면 제자리로
    const m = shake.motion.step(dt);
    o.x += m.x; o.y += m.y; o.z += m.z;
    // 누른 채 끄는 손 움직임: 저역 필터(시간 상수 약 70ms). 스텝당 이동 제한은 physics-core 가 한 번 더 건다
    const kp = 1 - Math.exp(-dt / 0.07);
    shake.pointerSm.x += (shake.pointer.x - shake.pointerSm.x) * kp;
    shake.pointerSm.z += (shake.pointer.z - shake.pointerSm.z) * kp;
    o.x += shake.pointerSm.x;
    o.z += shake.pointerSm.z;
    // 동작 줄이기: 손이 흔들리는 폭을 크게 줄인다. 결과의 공정성은 손에 거둘 때마다 정하는 균일 무작위 자세가 지키므로
    // 흔드는 폭과 무관하다
    if (reduceMotion()) { o.x *= 0.2; o.y *= 0.2; o.z *= 0.2; }
    handOffset.x = o.x; handOffset.y = o.y; handOffset.z = o.z;
    return o;
  }

  function handActive(now) {
    if (!cw || mode !== 'hand') return false;
    const pm = Math.abs(shake.pointer.x) + Math.abs(shake.pointer.z) + Math.abs(shake.pointerSm.x) + Math.abs(shake.pointerSm.z);
    return shake.auto || shake.motion.moving() || now < shake.settleUntil || pm > 0.001;
  }

  function stepOnce() {
    meshes.forEach((_, i) => { prev[i].p.copy(curr[i].p); prev[i].q.copy(curr[i].q); });
    cupPrev.copy(cupCurr); cupQPrev.copy(cupQCurr);
    stepNo++;
    if (mode === 'hand') cw.setCupOffset(computeHandOffset(PHYS.dt));
    const done = cw.step(Math.random, eventQueue);
    simClock += PHYS.dt;
    meshes.forEach((_, i) => readBody(i));
    readCup();
    eventQueue.drainContactForceEvents(onContactForce);
    if (mode === 'flight') rollSounds();
    return done;
  }

  /** 기다리던 던지기 약속을 한 번만 정리한다 */
  function settle(result) {
    const r = settleResolve;
    settleResolve = null;
    if (r) r(result);
  }

  /** @param {boolean} ok false 면 제한 시간 안에 못 멈춘 것: 동전을 손으로 거두고 다시 던지게 한다 */
  function finishThrow(ok) {
    acc = 0;
    camGoal.copy(view.target);
    if (!ok) {
      // 다시 던지기: 동전을 손 위에서 떨어뜨려 손바닥에 자연스럽게 내려앉게 한다(공중에 멈춰 있지 않게)
      const reason = cw.sim.retryReason || 'timeout';
      mode = 'hand';
      dropIntoHand();
      settle({ status: 'retry', reason });
      return;
    }
    mode = 'tray';
    meshes.forEach((m, i) => { m.position.copy(curr[i].p); m.quaternion.copy(curr[i].q); });
    settle({ status: 'settled', faces: cw.readFaces() });
  }

  function interpolate() {
    const a = Math.min(1, acc / PHYS.dt);
    meshes.forEach((m, i) => {
      m.position.lerpVectors(prev[i].p, curr[i].p, a);
      m.quaternion.slerpQuaternions(prev[i].q, curr[i].q, a);
    });
    s.hand.position.lerpVectors(cupPrev, cupCurr, a);
    s.hand.quaternion.slerpQuaternions(cupQPrev, cupQCurr, a);
  }

  function placeCam() {
    s.placeCamera(view, view.polar, view.dist, camTarget);
  }

  function frame(rafT) {
    raf = 0;
    // 평소에는 rAF 시각을 쓰고, 녹화 검증(?debug&timescale)일 때만 앱 시계를 쓴다.
    // 녹화 때는 CDP 가 문서 타임라인(rAF 시각)도 늦추므로 rAF 시각에 배율을 또 곱하면 이중으로 늦춰진다
    const now = TIME_SCALE === 1 && Number.isFinite(rafT) ? rafT : clockNow();
    if (last) measure((now - last) / 1000);
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 1 / 60;
    last = now;
    let active = false;

    if (gatherAnim) {
      // 판 위 동전을 손으로 거두는 짧은 호(弧) 이동(물리 밖에서 그린다)
      const t = Math.min(1, (now - gatherAnim.start) / gatherAnim.dur);
      const e = easeOutCubic(t);
      meshes.forEach((m, i) => {
        const g = gatherAnim.items[i];
        m.position.lerpVectors(g.from, g.to, e);
        m.position.y += Math.sin(Math.PI * e) * 1.2;
        m.quaternion.slerpQuaternions(g.qFrom, g.qTo, e);
      });
      if (t >= 1) {
        const done = gatherAnim.done;
        gatherAnim = null;
        done();
      }
      active = true;
    } else if (cw && (mode === 'flight' || handActive(now))) {
      acc += dt;
      let done = false;
      let n = 0;
      while (acc >= PHYS.dt && n < 48) {
        done = stepOnce();
        acc -= PHYS.dt;
        n++;
        if (done) break;
      }
      if (done && mode === 'flight') {
        finishThrow(done === true);
      } else {
        interpolate();
        if (mode === 'flight' && !reduceMotion()) {
          // 날아가는 동전을 은근히 따라간다(동전 무리 중심 쪽으로 가로 22%, 높이 22%만)
          const c = new THREE.Vector3();
          meshes.forEach((m) => c.add(m.position));
          c.multiplyScalar(1 / 3);
          camGoal.set(view.target.x + c.x * 0.22, view.target.y + Math.max(0, c.y - 1) * 0.22, view.target.z + (c.z - view.target.z) * 0.18);
        }
      }
      active = true;
    }

    // 카메라 목표점 부드럽게
    if (camTarget.distanceToSquared(camGoal) > 1e-6) {
      if (reduceMotion()) camTarget.copy(camGoal); else camTarget.lerp(camGoal, 1 - Math.exp(-dt * 3));
      active = true;
    }

    if (entrance) {
      const t = Math.min(1, (now - entrance.start) / entrance.dur);
      const e = entrance.ease(t);
      const polar = entrance.polar0 + (view.polar - entrance.polar0) * e;
      const dist = entrance.dist0 + (view.dist - entrance.dist0) * e;
      const tgt = new THREE.Vector3().lerpVectors(entrance.target0, camTarget, e);
      s.placeCamera(view, polar, dist, tgt);
      if (!entrance.dropped && t >= entrance.dropAt) {
        entrance.dropped = true;
        // 이미 누르고 흔드는 중이면 떨어뜨리지 않는다
        if (cw && mode === 'hand' && !shake.auto) dropIntoHand();
      }
      if (t >= 1) entrance = null;
      active = true;
    } else {
      placeCam();
    }

    const hv = mode === 'hand' || mode === 'gather' ? 1 : 0;
    if (Math.abs(handVis - hv) > 0.01) {
      handVis += (hv - handVis) * (1 - Math.exp(-dt * (hv ? 8 : 5)));
      active = true;
    } else {
      handVis = hv;
    }
    // 던진 뒤에는 손 암시와 그림자를 완전히 지운다(판 앞에 남는 유령 고리가 없게). 그림자는 손을 따라간다
    handMats.forEach(({ m, base }) => { m.opacity = base * handVis; });
    s.handShadow.material.opacity = shadowBase * handVis;
    s.hand.visible = handVis > 0.005;
    s.handShadow.visible = handVis > 0.005;
    s.handShadow.position.x = s.hand.position.x;
    s.handShadow.position.z = s.hand.position.z - 0.2;

    renderer.render(scene, camera);
    if (firstFrameResolve) { firstFrameResolve(); firstFrameResolve = null; }
    if (active) request(); else last = 0;
  }

  window.addEventListener('resize', () => {
    view = s.resize();
    camGoal.copy(view.target);
    camTarget.copy(view.target);
    request();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    } else {
      request();
    }
  });
  // GPU 컨텍스트를 잃으면 그리기를 멈추고, 돌아오면(three 가 자원을 다시 올린다) 다시 그린다
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    contextLost = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false;
    renderer.shadowMap.needsUpdate = true;
    request();
  });

  request();

  /** 동전을 손 안 위쪽에서 떨어뜨려 손바닥에 내려앉게 한다(진입 연출·거둔 직후) */
  function dropIntoHand() {
    const L = cw.cupLayout(Math.random);
    L.forEach((l, i) => { l.p.y += 0.25 + i * 0.05; });
    cw.gather(Math.random, L);
    snapMeshes();
    shake.settleUntil = clockNow() + 1500;
    request();
  }

  // --- 물리: main.js 가 미리 내려받기 시작한 Rapier 를 받아 월드를 만든다 ---
  const physicsReady = (async () => {
    const mod = await rapierModule;
    const RAPIER = mod.default || mod;
    if (typeof RAPIER.init === 'function') await RAPIER.init();
    cw = createCoinWorld(RAPIER);
    eventQueue = new RAPIER.EventQueue(true);
    coinMass = cw.coins[0].body.mass();
    cw.coins.forEach(({ body }, i) => coinByHandle.set(body.collider(0).handle, i));
    cupHandles = cw.cup.handles;
    mode = 'hand';
    dropIntoHand();
  })();

  /** 판 위 동전을 손으로 거둔다. animate 면 짧게 날아오고, 아니면 바로 */
  function gatherToHand(animate = true) {
    if (!cw) return Promise.resolve();
    if (mode === 'hand') return Promise.resolve();
    settle({ status: 'canceled' });
    if (!animate || reduceMotion() || mode !== 'tray') {
      gatherAnim = null;
      cw.gather(Math.random);
      mode = 'hand';
      snapMeshes();
      shake.settleUntil = clockNow() + 900;
      request();
      return Promise.resolve();
    }
    mode = 'gather';
    const L = cw.cupLayout(Math.random);
    return new Promise((resolve) => {
      gatherAnim = {
        start: clockNow(),
        dur: 420,
        items: meshes.map((m, i) => ({
          from: m.position.clone(), to: new THREE.Vector3(L[i].p.x, L[i].p.y, L[i].p.z),
          qFrom: m.quaternion.clone(), qTo: new THREE.Quaternion(L[i].q.x, L[i].q.y, L[i].q.z, L[i].q.w),
        })),
        done: () => {
          cw.gather(Math.random, L);
          mode = 'hand';
          snapMeshes();
          shake.settleUntil = clockNow() + 900;
          resolve();
        },
      };
      request();
    });
  }

  /** 진행 중인 던지기·흔들기를 멈추고 동전을 손으로. 기다리던 쪽에는 'canceled' */
  function abortThrow() {
    shake.auto = false;
    shake.pointer.x = 0; shake.pointer.z = 0;
    gatherAnim = null;
    settle({ status: 'canceled' });
    if (!cw) return;
    mode = 'hand';
    dropIntoHand(); // 공중에 멈춰 있지 않게 손 위에서 떨어뜨린다
    camGoal.copy(view.target);
    request();
  }

  return {
    physicsReady,
    firstFrame,
    get mode() { return mode; },

    /**
     * 인트로에서 이어지는 진입: 위에서 내려다보던 카메라가 손 앞 시점으로 내려앉고,
     * 끝 무렵 동전이 손 안으로 떨어진다. dur(ms)·ease 는 2D 오버레이 소멸과 같은 값을 쓴다.
     */
    playEntrance({ dur = 1200, ease = easeOutCubic } = {}) {
      if (reduceMotion() || !dur) { placeCam(); request(); return; }
      entrance = {
        start: clockNow(), dur, ease, dropAt: 0.62, dropped: false,
        polar0: 0.04, dist0: view.dist * 1.08, target0: new THREE.Vector3(0, 0, 0),
      };
      request();
    },

    /** 흔들기 시작(버튼·키·캔버스 누름). intensity 0~1 */
    startShake(intensity = 0.7) {
      if (!cw) return;
      if (mode === 'tray') gatherToHand(true);
      if (mode === 'flight') return;
      shake.auto = true;
      shake.autoT = 0;
      shake.phase = Math.random() * 10;
      shake.intensity = intensity;
      request();
    },
    /** 흔들기 멈춤(던지지 않고) */
    stopShake() {
      shake.auto = false;
      shake.pointer.x = 0; shake.pointer.z = 0;
      shake.settleUntil = clockNow() + 900;
      request();
    },
    /** 누른 채 끄는 손 움직임(화면 기준 -1~1) → 그릇 변위 */
    pointerMove(nx, ny) {
      shake.pointer.x = Math.max(-1, Math.min(1, nx)) * PHYS.cup.maxOffset.x;
      shake.pointer.z = Math.max(-1, Math.min(1, ny)) * PHYS.cup.maxOffset.z;
      request();
    },
    /** 폰 가속도 표본(m/s², 중력 제외. 기기 좌표 x 오른쪽 y 위 z 화면 밖) → 그릇 흔들림 */
    motionSample(ax, ay, az) {
      if (!cw || mode === 'flight' || mode === 'gather') return;
      // 판 위에 누운 동전은 분명히 흔들 때만(가벼운 손떨림·센서 잡음이 아니라) 손으로 거둔다
      if (mode === 'tray') { if (Math.hypot(ax, ay, az) > 6) gatherToHand(true); return; }
      if (mode !== 'hand') return;
      // 데드존(약 1.5 m/s² 이하)은 0 으로 본다. 그 이하의 표본은 물리·렌더를 깨우지 않는다
      if (Math.hypot(ax, ay, az) <= 1.5) return;
      shake.motion.sample(ax, ay, -az);
      shake.settleUntil = clockNow() + 900;
      request();
    },

    /**
     * 손을 열어 던진다. 물리로 멈추면 { status:'settled', faces }, 제한 시간 안에 못 멈추면 { status:'retry' },
     * 중간에 취소되면 { status:'canceled' }.
     * @param {{ power?:number, dirX?:number, dirZ?:number }} opts 세기 0~1, 방향(털거나 끈 방향) -1~1
     */
    async throwCoins(opts = {}) {
      if (!cw) throw new Error('physics not ready');
      settle({ status: 'canceled' }); // 혹시 남은 이전 약속 정리
      if (mode === 'tray' || mode === 'gather') {
        await gatherToHand(false);
      }
      entrance = null;
      shake.auto = false;
      shake.pointer.x = 0; shake.pointer.z = 0;
      cw.release(Math.random, opts);
      mode = 'flight';
      meshes.forEach((_, i) => { readBody(i); prev[i].p.copy(curr[i].p); prev[i].q.copy(curr[i].q); });
      acc = 0;
      request();
      return new Promise((resolve) => { settleResolve = resolve; });
    },

    gatherToHand,
    abortThrow,

    /** 검증용: 동전 위치와 상태 */
    debugState() {
      return {
        mode,
        coins: meshes.map((m) => ({ x: +m.position.x.toFixed(2), y: +m.position.y.toFixed(2), z: +m.position.z.toFixed(2) })),
        upY: cw ? cw.coins.map((c) => +upY(c.body.rotation()).toFixed(2)) : [],
        hand: { ...handOffset },
        cam: { p: camera.position.toArray().map((v) => +v.toFixed(2)), t: camTarget.toArray().map((v) => +v.toFixed(2)), entrance: !!entrance, view: { dist: +view.dist.toFixed(2), polar: view.polar } },
        screenCoinPx: (() => {
          // 손 안 동전 지름이 화면 폭에서 차지하는 비율(구도 검증)
          const p0 = new THREE.Vector3(0, 0.06, 0).project(camera);
          const p1 = new THREE.Vector3(1, 0.06, 0).project(camera);
          return Math.abs(p1.x - p0.x) / 2;
        })(),
      };
    },
  };
}
