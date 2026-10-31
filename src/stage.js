// 3D 무대: three.js 장면 + Rapier 물리 + 필요할 때만 그리는 렌더 루프.
// main.js 가 동적 import 하므로 three/Rapier 는 첫 화면을 막지 않는다.
// Rapier 모듈(wasm)은 main.js 가 일찍 내려받기 시작해 promise 로 넘겨준다.
import * as THREE from 'three';
import { createScene } from './scene.js';
import { createCoinMeshes } from './coins.js';
import { PHYS, COIN_THICKNESS, createCoinWorld, upY } from './physics-core.js';
import { playImpact, playRollTick } from './sound.js';

const REST = [[-1.1, COIN_THICKNESS / 2, 0.2], [0, COIN_THICKNESS / 2, 0.2], [1.1, COIN_THICKNESS / 2, 0.2]];
const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {Promise<any>} rapierModule import('@dimforge/rapier3d') 결과
 */
export async function createStage(canvas, rapierModule) {
  const s = createScene(canvas);
  const { renderer, scene, camera, controls } = s;
  let view = s.view;

  const meshes = await createCoinMeshes(scene, renderer.capabilities.getMaxAnisotropy() > 4 ? 4 : 2);
  meshes.forEach((m, i) => m.position.set(...REST[i]));

  // 보간용 이전/현재 자세
  const prev = meshes.map(() => ({ p: new THREE.Vector3(), q: new THREE.Quaternion() }));
  const curr = meshes.map(() => ({ p: new THREE.Vector3(), q: new THREE.Quaternion() }));
  // 소리: Rapier 접촉 세기 이벤트(충돌음) + 구르기·흔들림의 잦은 미세 충격
  let eventQueue = null;
  let coinMass = 1;
  const coinByHandle = new Map();
  const pairForce = new Map();
  const pairSeen = new Map();
  const pairLast = new Map();
  const lastCoinSound = meshes.map(() => -1);
  const rollPhase = meshes.map(() => Math.random());
  let stepNo = 0;

  let cw = null;
  let simulating = false;
  let acc = 0;
  let settleResolve = null;
  let simClock = 0;
  let freeUntil = 0; // 흔들기(짤랑임) 뒤 동전이 다시 내려앉을 때까지 물리를 돌린다

  // --- 렌더 루프: 움직일 것이 있을 때만 돈다 ---
  let raf = 0;
  let last = 0;
  let contextLost = false;
  const followGoal = new THREE.Vector3();
  let following = false;
  let entrance = null;

  // 처음 그린 60프레임의 프레임 시간이 나쁘면 화질을 한 단계 더 낮춘다
  const perf = { samples: [], decided: false };
  function measure(sec) {
    if (perf.decided || sec <= 0 || sec > 0.1) return;
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

  function snapMeshes() {
    meshes.forEach((m, i) => {
      readBody(i);
      prev[i].p.copy(curr[i].p); prev[i].q.copy(curr[i].q);
      m.position.copy(curr[i].p); m.quaternion.copy(curr[i].q);
    });
  }

  function onContactForce(ev) {
    const h1 = ev.collider1(), h2 = ev.collider2();
    const c1 = coinByHandle.get(h1), c2 = coinByHandle.get(h2);
    if (c1 === undefined && c2 === undefined) return;
    const F = ev.maxForceMagnitude();
    const key = h1 < h2 ? `${h1}:${h2}` : `${h2}:${h1}`;
    const prevF = pairSeen.get(key) === stepNo - 1 ? (pairForce.get(key) || 0) : 0;
    pairForce.set(key, F);
    pairSeen.set(key, stepNo);
    const dv = (F * PHYS.dt) / coinMass; // 이 스텝에서 받은 충격을 속도 변화로 환산
    if (dv < 0.55) return;
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
      strength: Math.min(1, (dv - 0.55) / 5.5),
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
      if (y < 0.56 && uy < 0.5 && om > 2) {
        rate = 2 + om * 1.1; // 모서리로 구르기
        k = Math.min(1, om / 14) * 0.7;
      } else if (y < 0.3 && uy > 0.5 && uy < 0.997 && om > 1.2) {
        const tilt = 1 - uy;
        rate = 3 + (om * 0.9) / Math.sqrt(Math.max(tilt, 0.005)); // 기울기가 작아질수록 빨라진다
        k = Math.min(1, Math.sqrt(tilt) * 2.2) * Math.min(1, om / 6);
      }
      if (!rate) { rollPhase[i] = 0; return; }
      rollPhase[i] += Math.min(70, rate) * PHYS.dt;
      if (rollPhase[i] >= 1) {
        rollPhase[i] -= 1 + (Math.random() - 0.5) * 0.3;
        playRollTick(i, k, curr[i].p.x / 2.6);
      }
    });
  }

  function stepOnce() {
    meshes.forEach((_, i) => { prev[i].p.copy(curr[i].p); prev[i].q.copy(curr[i].q); });
    stepNo++;
    const done = cw.step(Math.random, eventQueue);
    simClock += PHYS.dt;
    meshes.forEach((_, i) => readBody(i));
    eventQueue.drainContactForceEvents(onContactForce);
    rollSounds();
    return done;
  }

  /** 기다리던 던지기 약속을 한 번만 정리한다 */
  function settle(result) {
    const r = settleResolve;
    settleResolve = null;
    if (r) r(result);
  }

  /** 카메라를 기본 시점(판 중심)으로 즉시 되돌린다 */
  function resetView() {
    controls.target.set(0, 0, 0);
    s.placeCamera(view);
  }

  /** 던진 뒤 카메라를 판 중심으로 되돌린다. 동작 줄이기 설정이면 움직임 없이 바로 */
  function startFollowBack() {
    followGoal.set(0, 0, 0);
    following = !reduceMotion();
    if (!following) resetView();
  }

  /** @param {boolean} ok false 면 제한 시간 안에 못 멈춘 것: 동전을 거두고 다시 던지게 한다 */
  function finishThrow(ok) {
    simulating = false;
    acc = 0;
    if (!ok) {
      cw.reset();
      snapMeshes();
    }
    meshes.forEach((m, i) => { m.position.copy(curr[i].p); m.quaternion.copy(curr[i].q); });
    startFollowBack();
    settle(ok ? { status: 'settled', faces: cw.readFaces() } : { status: 'retry' });
  }

  function moveTargetToward(goal, k) {
    const d = goal.clone().sub(controls.target).multiplyScalar(k);
    controls.target.add(d);
    camera.position.add(d);
    return d.lengthSq() > 1e-8 || controls.target.distanceToSquared(goal) > 1e-6;
  }

  function interpolate() {
    const a = Math.min(1, acc / PHYS.dt);
    meshes.forEach((m, i) => {
      m.position.lerpVectors(prev[i].p, curr[i].p, a);
      m.quaternion.slerpQuaternions(prev[i].q, curr[i].q, a);
    });
  }

  function frame(now) {
    raf = 0;
    if (last) measure((now - last) / 1000);
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 1 / 60;
    last = now;
    let active = false;

    if (!simulating && cw && now < freeUntil) {
      acc += dt;
      let n = 0;
      while (acc >= PHYS.dt && n < 24) { stepOnce(); acc -= PHYS.dt; n++; }
      interpolate();
      active = true;
    } else if (simulating) {
      acc += dt;
      let done = false;
      let n = 0;
      while (acc >= PHYS.dt && n < 24) {
        done = stepOnce();
        acc -= PHYS.dt;
        n++;
        if (done) break;
      }
      if (done) {
        finishThrow(done === true);
      } else {
        interpolate();
        // 동전 무리를 은근히 따라간다(판 중심 쪽으로 30%만). 동작 줄이기 설정이면 카메라를 움직이지 않는다
        if (!reduceMotion()) {
          followGoal.set(0, 0, 0);
          meshes.forEach((m) => { followGoal.x += m.position.x / 3; followGoal.z += m.position.z / 3; });
          followGoal.multiplyScalar(0.3);
          moveTargetToward(followGoal, 1 - Math.exp(-dt * 2.5));
        }
      }
      active = true;
    } else if (following) {
      following = moveTargetToward(followGoal, 1 - Math.exp(-dt * 2));
      active = following;
    }

    if (entrance) {
      const t = Math.min(1, (now - entrance.start) / entrance.dur);
      const e = 1 - Math.pow(1 - t, 3);
      s.placeCamera(view, entrance.polar0 + (view.polar - entrance.polar0) * e, entrance.dist0 + (view.dist - entrance.dist0) * e);
      if (t >= 1) entrance = null;
      active = true;
    }

    if (controls.update()) active = true;
    renderer.render(scene, camera);
    if (active) request(); else last = 0;
  }

  controls.addEventListener('change', request);
  controls.addEventListener('start', () => { entrance = null; request(); });
  window.addEventListener('resize', () => {
    view = s.resize(view);
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

  // --- 물리: main.js 가 미리 내려받기 시작한 Rapier 를 받아 월드를 만든다 ---
  const physicsReady = (async () => {
    const mod = await rapierModule;
    const RAPIER = mod.default || mod;
    if (typeof RAPIER.init === 'function') await RAPIER.init();
    cw = createCoinWorld(RAPIER);
    eventQueue = new RAPIER.EventQueue(true);
    coinMass = cw.coins[0].body.mass();
    cw.coins.forEach(({ body }, i) => coinByHandle.set(body.collider(0).handle, i));
    cw.reset();
    snapMeshes();
    request();
  })();

  /** 진행 중인 던지기·흔들림을 멈추고 동전을 처음 자리로. 기다리던 쪽에는 'canceled' 를 돌려준다 */
  function abortThrow() {
    simulating = false;
    freeUntil = 0;
    acc = 0;
    settle({ status: 'canceled' });
    if (!cw) return;
    cw.reset();
    snapMeshes();
    startFollowBack();
    request();
  }

  return {
    physicsReady,

    /** 위에서 내려다보던 시점에서 제자리로 내려앉는 카메라 진입 */
    playEntrance() {
      if (reduceMotion()) return;
      entrance = { start: performance.now(), dur: 1800, polar0: 0.14, dist0: view.dist * 1.18 };
      request();
    },

    /**
     * 세 동전을 던진다. 물리로 멈추면 { status:'settled', faces }, 제한 시간 안에 못 멈추면 { status:'retry' },
     * 중간에 취소되면 { status:'canceled' }.
     * @param {{ power?:number, spin?:number, dirX?:number }} opts 폰 털기 세기(버튼은 기본값)
     */
    throwCoins(opts = {}) {
      if (!cw) return Promise.reject(new Error('physics not ready'));
      settle({ status: 'canceled' }); // 혹시 남은 이전 약속 정리
      entrance = null;
      freeUntil = 0;
      cw.launch(Math.random, opts);
      meshes.forEach((_, i) => {
        readBody(i);
        prev[i].p.copy(curr[i].p); prev[i].q.copy(curr[i].q);
      });
      simulating = true;
      acc = 0;
      request();
      return new Promise((resolve) => { settleResolve = resolve; });
    },

    /** 흔드는 동안: 판 위 동전이 살짝 들썩이며 짤랑인다 */
    jiggle(intensity) {
      if (!cw || simulating) return;
      if (performance.now() >= freeUntil) {
        acc = 0;
        meshes.forEach((_, i) => { readBody(i); prev[i].p.copy(curr[i].p); prev[i].q.copy(curr[i].q); });
      }
      cw.jiggle(intensity, Math.random);
      freeUntil = performance.now() + 1400;
      request();
    },

    /** 던지기 취소·다시 점치기: 동전을 처음 자리로 */
    abortThrow,

    /** 판정 근거 확인용(개발자 도구): 각 동전의 위쪽 법선 y */
    debugUpY() { return cw ? cw.coins.map((c) => upY(c.body.rotation())) : []; },
  };
}
