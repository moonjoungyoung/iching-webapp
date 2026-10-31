// 동전 물리 코어 (Rapier): three.js 에 의존하지 않는다.
// 브라우저(stage.js)와 node 통계 시뮬레이터(scripts/physics-sim.mjs)가
// 같은 파라미터·같은 손(그릇)·같은 던지기·같은 안정 판정을 공유하도록 한곳에 둔다.
//
// 크기와 시간: 동전 반경 0.5 단위 = 실제 엽전 약 12mm 로 본다(1 단위 = 24mm).
//   실제 중력 9.81 m/s² = 9.81 / 0.024 = 408.75 단위/s².
//   실제 속도 그대로면 손에서 판까지 0.25초 남짓에 끝나 눈으로 따라가기 어렵고, 초당 20회 넘는 뒤집힘은 화면에서 끊겨 보인다.
//   그래서 모든 움직임을 0.65배 느리게 보여 준다(일관된 시간 배율). 중력 = 408.75 × 0.65² ≈ 172.7.
//   이 값에서 손에서 판까지 비행은 약 0.4~0.6초, 뒤집힘은 초당 5~10회로 보인다.

export const COIN_RADIUS = 0.5;
export const COIN_THICKNESS = 0.12;
const COIN_BORDER = 0.022; // 둥근 모서리(라운드 실린더) 반경: 테두리로 구르고 흔들리게

export const UNIT_METERS = 0.024;
export const REAL_G = 9.81 / UNIT_METERS; // 408.75 단위/s²
export const TIME_FACTOR = 0.65; //          화면 속 시간 배율(1 = 실제 속도)

export const PHYS = {
  gravity: -REAL_G * TIME_FACTOR * TIME_FACTOR, // ≈ -172.7
  dt: 1 / 240, //        고정 시간 간격(빠른 동전·얇은 두께에 맞춰 촘촘히)
  solverIterations: 8,
  contactHz: 13, //      접촉 강성: 중력이 커진 만큼 단단하게(가라앉음 ≈ g/ω² ≈ 0.026)
  // 점판: 평평한 바닥 반경, 비스듬한 턱(바깥 반경·각도), 운두 반경, 보이지 않는 안전벽 높이
  tray: { flatRadius: 2.7, bevelOuter: 3.25, bevelAngle: 0.61, bevelFriction: 0.14, wallRadius: 3.45, wallTop: 9, segments: 72 },
  coin: { density: 8.9, friction: 0.3, restitution: 0.36 },
  table: { friction: 0.5, restitution: 0.3 },
  // 손(모아 쥔 두 손): 판 바로 앞, 보는 사람 쪽 공중의 보이지 않는 그릇.
  // 판 운두(반경 3.45) 바깥이라 화면에서 판과 겹치지 않고 판 아래쪽(손 자리)에 보인다
  cup: {
    base: { x: 0, y: 2.0, z: 5.0 },
    maxStep: 0.07, //      스텝(1/240초)당 손이 움직일 수 있는 최대 거리: 갑자기 튀어 동전이 벽을 뚫지 않게
    innerRadius: 1.2,
    floorY: -0.55, //      그릇 안쪽 바닥(로컬)
    lidY: 0.85, //         그릇 안쪽 뚜껑(로컬)
    walls: 14,
    friction: 0.35,
    restitution: 0.25,
    maxOffset: { x: 0.85, y: 0.6, z: 0.6 }, // 흔들기 진폭 한계(사람 손은 3~5cm 폭으로 흔든다)
  },
  linearDamping: 0.03, //  공기 저항(작게)
  angularDamping: 0.08,
  // 바닥에 닿아 구르거나 흔들릴 때의 저항(구름 마찰 근사)
  groundLinearDamping: 1.4,
  groundAngularDamping: 2.2,
  rollingResistance: 14,
  // 안정 판정(속도는 이 크기·시간 배율에 맞춘 값)
  stillLin: 0.18,
  stillAng: 0.55,
  stillTime: 0.2,
  calmLin: 0.6,
  calmAng: 3.5,
  calmTime: 0.25,
  calmDamping: 30,
  calmSettle: 0.55,
  tiltLin: 0.38, //        이보다 느리게 기울어 멈춰 있으면 넛지
  tiltTime: 0.3,
  flatUp: 0.8, //          |up.y| 가 이 이상이면 면으로 누운 것
  minTime: 0.45,
  softTimeout: 2.6, //     이후 감쇠를 서서히 올려 물리적으로 멈추게 한다(결과 판정에는 쓰지 않는다)
  giveUpTime: 10, //       그래도 착지·저속·평평 조건을 못 채우면 이 효는 기록하지 않고 다시 던진다
  soundForceThreshold: 260,
  // 던지기: 손에서 판까지 비행 시간(초)과 판 위 목표 반경
  flight: { minT: 0.4, maxT: 0.52, landY: 0.45, centerZ: -0.25, spread: [0.45, 1.2] },
  flipRps: [5, 10], //     공중 뒤집힘(초당 회전 수)
};

// 충돌 그룹(위 16비트 = 소속, 아래 16비트 = 상대 필터)
const GROUP_WALL = (0x0002 << 16) | 0xffff;
const GROUP_COIN_HAND = (0x0001 << 16) | 0xfffd; //   손 안: 벽은 통과, 동전끼리는 부딪힌다(짤랑임)
const GROUP_COIN_FLIGHT = (0x0001 << 16) | 0xfffc; // 손을 떠나 판 안에 들기 전: 벽·다른 동전 모두 통과(손 안에서 겹쳐 있던 동전이 서로 튕겨 판 밖으로 나가지 않게)
const GROUP_COIN_INSIDE = (0x0001 << 16) | 0xffff; //  판 안으로 들어온 뒤: 벽·동전 모두와 부딪힌다
const INSIDE_RADIUS = PHYS.tray.wallRadius - 0.6; //    동전 중심이 이 반경 안이면 '판 안'

// 균일 분포 무작위 회전 (Shoemake)
function randomQuat(rng) {
  const u1 = rng(), u2 = rng() * Math.PI * 2, u3 = rng() * Math.PI * 2;
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  return { x: a * Math.sin(u2), y: a * Math.cos(u2), z: b * Math.sin(u3), w: b * Math.cos(u3) };
}

export function upY(rot) {
  // 동전 로컬 +Y(앞면 법선)를 월드로 돌렸을 때의 y 성분
  return 1 - 2 * (rot.x * rot.x + rot.z * rot.z);
}

const len3 = (v) => Math.hypot(v.x, v.y, v.z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** 점판 단면(반경, 높이)을 회전시켜 만든 삼각망. 화면의 쟁반 모양(scene.js)도 같은 단면을 쓴다. */
export function trayProfile() {
  const T = PHYS.tray;
  const rimY = (T.bevelOuter - T.flatRadius) * Math.tan(T.bevelAngle);
  return [
    [0, 0], [T.flatRadius * 0.5, 0], [T.flatRadius, 0],
    [T.bevelOuter, rimY], [T.wallRadius, rimY], [T.wallRadius, T.wallTop],
  ];
}

function latheMesh(prof) {
  const n = PHYS.tray.segments;
  const verts = [], idx = [], rings = [];
  prof.forEach(([r, y]) => {
    const start = verts.length / 3;
    if (r === 0) { verts.push(0, y, 0); rings.push({ start, center: true }); return; }
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      verts.push(Math.cos(a) * r, y, Math.sin(a) * r);
    }
    rings.push({ start, center: false });
  });
  for (let k = 0; k < rings.length - 1; k++) {
    const A = rings[k], B = rings[k + 1];
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      // 위(안쪽)를 향하도록 감기 방향을 맞춘다. 가운데 점은 부채꼴 하나로(퇴화 삼각형 없음)
      if (A.center) { idx.push(A.start, B.start + i2, B.start + i); continue; }
      const a = A.start + i, b = A.start + i2, c = B.start + i, d = B.start + i2;
      idx.push(a, b, c, b, d, c);
    }
  }
  return [new Float32Array(verts), new Uint32Array(idx)];
}

/**
 * 손으로 흔드는 자동 패턴(버튼을 누르고 있을 때·시뮬레이터). 몇 개의 사인파를 섞어 사람 손처럼 불규칙하게.
 * @returns {{x:number,y:number,z:number}} 그릇 기준 위치에서의 변위
 */
export function autoShakeOffset(t, phase = 0, intensity = 0.7) {
  // 진폭은 화면에서 손이 흔들리는 게 분명히 보이도록(약 1.3~2.4cm), 위아래 가속이 중력보다 커서 동전이 손 안에서 튀어 오르며 부딪도록
  const A = 0.3 + 0.26 * clamp(intensity, 0, 1);
  const tau = Math.PI * 2;
  return {
    x: A * (Math.sin(tau * 4.2 * t + phase) + 0.3 * Math.sin(tau * 8.7 * t + phase * 1.7)),
    y: A * 0.9 * Math.sin(tau * 5.3 * t + phase * 2.3),
    z: A * 0.7 * Math.sin(tau * 3.6 * t + phase * 0.6),
  };
}

/**
 * 손목 스프링: 폰 가속도(m/s², 중력 제외)를 힘으로 받아 손 변위(단위)로 바꾼다. 놓으면 제자리로 돌아온다.
 * |a| 가 데드존 이하이면 0 으로 본다(정지한 폰의 센서 잡음 무시).
 */
export function createWristSpring({ hz = 3.2, zeta = 0.55, gain = 28, deadzone = 1.5, lowpass = 0.5 } = {}) {
  const w = Math.PI * 2 * hz;
  const o = { x: 0, y: 0, z: 0 }, v = { x: 0, y: 0, z: 0 }, a = { x: 0, y: 0, z: 0 };
  return {
    o, v, a,
    /** 가속도 표본(기기 좌표를 화면·손 좌표로 바꾼 값) */
    sample(ax, ay, az) {
      const m = Math.hypot(ax, ay, az);
      const k = m <= deadzone ? 0 : 1;
      a.x += (ax * k - a.x) * lowpass;
      a.y += (ay * k - a.y) * lowpass;
      a.z += (az * k - a.z) * lowpass;
    },
    /** dt 초 진행하고 변위를 돌려준다 */
    step(dt) {
      for (const key of ['x', 'y', 'z']) {
        const acc = gain * a[key] - w * w * o[key] - 2 * zeta * w * v[key];
        v[key] += acc * dt;
        o[key] += v[key] * dt;
      }
      const decay = Math.exp(-dt * 30);
      a.x *= decay; a.y *= decay; a.z *= decay;
      return o;
    },
    /** 아직 움직이는 중인지 */
    moving() {
      return Math.abs(o.x) + Math.abs(o.y) + Math.abs(o.z) + Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z) > 0.004;
    },
  };
}

/**
 * Rapier 월드와 동전 3개, 손(그릇)을 만든다.
 * @param {*} RAPIER Rapier 모듈(compat 이면 init() 완료 후)
 */
export function createCoinWorld(RAPIER) {
  const world = new RAPIER.World({ x: 0, y: PHYS.gravity, z: 0 });
  world.timestep = PHYS.dt;
  world.numSolverIterations = PHYS.solverIterations;
  world.integrationParameters.contact_natural_frequency = PHYS.contactHz;

  // 점판(占盤): 둥근 칠기 쟁반. 평평한 바닥 둘레를 비스듬한 턱(bevel)이 감싸고, 그 위로
  // 보이지 않는 높은 벽이 이어진다. 바닥(마찰 큼)과 턱·벽(마찰 작음)은 매끈한 회전체 삼각망(내부 모서리 보정).
  // 턱이 비스듬하고 미끄러워 동전이 기대 서지 않고 바닥으로 내려온다.
  const tray = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const prof = trayProfile();
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(...latheMesh(prof.slice(0, 3)), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setFriction(PHYS.table.friction)
      .setRestitution(PHYS.table.restitution),
    tray,
  );
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(...latheMesh(prof.slice(2, 5)), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setFriction(PHYS.tray.bevelFriction)
      .setRestitution(PHYS.table.restitution),
    tray,
  );
  // 운두 위 보이지 않는 벽: 손이 판 바깥(앞쪽)에 있으므로, 동전이 판 안으로 들어온 뒤에만 막는다(충돌 그룹)
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(...latheMesh(prof.slice(4)), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setFriction(PHYS.tray.bevelFriction)
      .setRestitution(PHYS.table.restitution)
      .setCollisionGroups(GROUP_WALL),
    tray,
  );
  // 만일을 위한 두꺼운 안전판(평소엔 닿지 않는 높이)
  world.createCollider(RAPIER.ColliderDesc.cuboid(8, 0.5, 8).setTranslation(0, -0.58, 0), tray);

  // --- 손(그릇): kinematic 몸체 + 컵 모양 복합 충돌체(바닥·둘레 벽·뚜껑) ---
  const C = PHYS.cup;
  const cupBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(C.base.x, C.base.y, C.base.z),
  );
  const cupColliders = [];
  const cupDesc = (d) => {
    const col = world.createCollider(d.setFriction(C.friction).setRestitution(C.restitution), cupBody);
    cupColliders.push(col);
    return col;
  };
  // 흔들 때 그릇이 빠르게 움직여도 동전이 빠져나가지 않도록 벽·바닥·뚜껑을 두껍게
  const T_WALL = 0.35;
  const wallR = C.innerRadius + T_WALL;
  const wallHalf = (C.lidY - C.floorY) / 2 + T_WALL * 2;
  const wallY = (C.lidY + C.floorY) / 2;
  cupDesc(RAPIER.ColliderDesc.cylinder(T_WALL, C.innerRadius + T_WALL * 2).setTranslation(0, C.floorY - T_WALL, 0));
  cupDesc(RAPIER.ColliderDesc.cylinder(T_WALL, C.innerRadius + T_WALL * 2).setTranslation(0, C.lidY + T_WALL, 0));
  for (let i = 0; i < C.walls; i++) {
    const a = (i / C.walls) * Math.PI * 2;
    const half = -a / 2;
    cupDesc(
      RAPIER.ColliderDesc.cuboid(T_WALL, wallHalf, (Math.PI * wallR / C.walls) * 1.2)
        .setTranslation(Math.cos(a) * wallR, wallY, Math.sin(a) * wallR)
        .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }),
    );
  }
  const cupHandles = new Set(cupColliders.map((c) => c.handle));
  const cup = { body: cupBody, colliders: cupColliders, handles: cupHandles, offset: { x: 0, y: 0, z: 0 }, open: false };

  function setCupEnabled(on) {
    cupColliders.forEach((c) => c.setEnabled(on));
    cup.open = !on;
  }

  const coins = [];
  for (let i = 0; i < 3; i++) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(C.base.x + (i - 1) * 0.4, C.base.y + C.floorY + 0.1 + i * 0.3, C.base.z)
        .setCcdEnabled(true)
        .setLinearDamping(PHYS.linearDamping)
        .setAngularDamping(PHYS.angularDamping)
        .setCanSleep(true),
    );
    world.createCollider(
      RAPIER.ColliderDesc.roundCylinder(
        COIN_THICKNESS / 2 - COIN_BORDER, COIN_RADIUS - COIN_BORDER, COIN_BORDER,
      )
        .setDensity(PHYS.coin.density)
        .setFriction(PHYS.coin.friction)
        .setRestitution(PHYS.coin.restitution)
        // 소리용 접촉 세기 이벤트: 가만히 놓인 무게보다 충분히 큰 힘만 알린다
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(PHYS.soundForceThreshold)
        .setCollisionGroups(GROUP_COIN_HAND),
      body,
    );
    coins.push({ body, still: 0, tilt: 0, calm: 0, nudges: 0, edgeEvents: 0, inside: false });
  }

  // retryReason: 'outside'(판 밖) | 'timeout'(제한 시간). handRegathers: 손 안에서 빠져나가 다시 모은 횟수(검증용)
  const sim = { t: 0, active: false, damped: false, retryReason: null, handRegathers: 0 };

  function setDamping(lin, ang) {
    coins.forEach(({ body }) => { body.setLinearDamping(lin); body.setAngularDamping(ang); });
  }

  /**
   * 기울어 멈춘 동전을 아주 작게 밀어 눕힌다. 이미 기운 방향으로 계속 넘어가게 하고
   * 바닥 쪽은 판 안쪽으로 살짝 민다(벽에 기댄 경우 미끄러져 눕도록).
   */
  function nudge(c, uy, rng) {
    const b = c.body;
    const p = b.translation();
    const q = b.rotation();
    const nx = 2 * (q.x * q.y - q.w * q.z), nz = 2 * (q.y * q.z + q.w * q.x); // 면 법선의 수평 성분
    const r = Math.hypot(p.x, p.z);
    const a0 = rng() * Math.PI * 2;
    const dx = r > 1e-3 ? -p.x / r : Math.cos(a0), dz = r > 1e-3 ? -p.z / r : Math.sin(a0);
    const hl = Math.hypot(nx, nz);
    let fx = dx, fz = dz; // 윗부분이 넘어갈 방향
    if (hl > 0.2) {
      const sgn = Math.abs(uy) > 0.08 ? -Math.sign(uy) : ((nx * dx + nz * dz) >= 0 ? 1 : -1);
      fx = sgn * nx / hl; fz = sgn * nz / hl;
    }
    const m = b.mass();
    if (r > PHYS.tray.flatRadius - 0.6) {
      // 턱에 기댐: 바닥 쪽을 판 안쪽으로 끌어 윗부분이 미끄러져 눕게 한다
      const k = 2.3 + c.nudges * 0.9;
      b.applyImpulse({ x: dx * m * k, y: m * 0.4, z: dz * m * k }, true);
    } else {
      const s = 5 + c.nudges * 2;
      b.setAngvel({ x: fz * s, y: 0, z: -fx * s }, true);
      b.applyImpulse({ x: dx * m * 0.8, y: m * 0.8, z: dz * m * 0.8 }, true);
    }
    c.tilt = 0;
    c.still = 0;
    c.nudges++;
    if (Math.abs(uy) < 0.35) c.edgeEvents++;
  }

  /** 손(그릇) 안의 동전 자리: 세 층으로 겹쳐 쥔 모양, 자세는 균일 무작위(공정성의 바탕) */
  function cupLayout(rng = Math.random) {
    // gather() 가 손을 기준 위치로 되돌리므로 자리도 기준 위치 기준으로 잡는다
    const b = C.base, o = { x: 0, y: 0, z: 0 };
    const a0 = rng() * Math.PI * 2;
    return coins.map((_, i) => {
      const a = a0 + i * 2.1;
      const r = 0.15 + rng() * 0.35;
      return {
        p: { x: b.x + o.x + Math.cos(a) * r, y: b.y + o.y + C.floorY + 0.12 + i * 0.36, z: b.z + o.z + Math.sin(a) * r },
        q: randomQuat(rng),
      };
    });
  }

  /** 동전을 손 안에 둔다(던지기 전 상태). layout 을 주면 그 자리에, 아니면 새로 무작위 */
  function gather(rng = Math.random, layout = null) {
    sim.active = false;
    // 손을 기준 위치로 되돌리고 속도 기준점도 초기화한다(다음 흔들기는 스텝 제한을 따라 여기서부터 움직인다)
    cup.offset = { x: 0, y: 0, z: 0 };
    lastCupPos = { ...C.base };
    cupVel = { x: 0, y: 0, z: 0 };
    cupBody.setTranslation(C.base, true);
    cupBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    cupBody.setNextKinematicTranslation(C.base);
    cupBody.setNextKinematicRotation({ x: 0, y: 0, z: 0, w: 1 });
    setDamping(PHYS.linearDamping, PHYS.angularDamping);
    setCupEnabled(true);
    const L = layout || cupLayout(rng);
    coins.forEach((c, i) => {
      c.body.setTranslation(L[i].p, true);
      c.body.setRotation(L[i].q, true);
      c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      c.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      c.still = 0; c.tilt = 0; c.calm = 0; c.nudges = 0; c.edgeEvents = 0;
      c.inside = false;
      c.body.collider(0).setCollisionGroups(GROUP_COIN_HAND);
    });
    return L;
  }

  let lastCupPos = { ...C.base };
  let cupVel = { x: 0, y: 0, z: 0 };
  /**
   * 그릇(손) 위치를 정한다. offset 은 기준 위치에서의 변위(진폭 한계로 자름). 매 물리 스텝 전에 부른다.
   * 그릇이 기울어 보이도록 변위에 비례해 살짝 기울인다.
   */
  function setCupOffset(off) {
    const M = C.maxOffset;
    const want = { x: clamp(off.x, -M.x, M.x), y: clamp(off.y, -M.y, M.y), z: clamp(off.z, -M.z, M.z) };
    // 스텝당 이동 제한(입력이 갑자기 튀어도 손은 이어서 움직인다)
    const S = C.maxStep;
    const pos = {
      x: lastCupPos.x + clamp(C.base.x + want.x - lastCupPos.x, -S, S),
      y: lastCupPos.y + clamp(C.base.y + want.y - lastCupPos.y, -S, S),
      z: lastCupPos.z + clamp(C.base.z + want.z - lastCupPos.z, -S, S),
    };
    const o = { x: pos.x - C.base.x, y: pos.y - C.base.y, z: pos.z - C.base.z };
    cup.offset = o;
    cupVel = { x: (pos.x - lastCupPos.x) / PHYS.dt, y: (pos.y - lastCupPos.y) / PHYS.dt, z: (pos.z - lastCupPos.z) / PHYS.dt };
    lastCupPos = pos;
    cupBody.setNextKinematicTranslation(pos);
    const tx = o.z * 0.5, tz = -o.x * 0.5; // 작은 기울기(라디안)
    const hx = tx / 2, hz = tz / 2;
    const n = Math.hypot(hx, hz, 1);
    cupBody.setNextKinematicRotation({ x: hx / n, y: 0, z: hz / n, w: 1 / n });
  }

  /**
   * 손을 열어 던진다. 그릇 충돌체를 끄고, 그릇의 지금 속도에 판 쪽으로 던지는 속도를 더한다.
   * 동전마다 판 위 목표점을 정하고 비행 시간에 맞춘 포물선 속도를 준다. 뒤집힘은 날아가는 방향에 수직인 가로축.
   * @param {() => number} rng
   * @param {{ power?:number, dirX?:number, dirZ?:number }} opts power 0~1(세기), dirX·dirZ -1~1(털거나 끈 방향)
   */
  function release(rng = Math.random, opts = {}) {
    const F = PHYS.flight;
    const power = clamp(Number.isFinite(opts.power) ? opts.power : 0.5, 0, 1);
    const dirX = clamp(Number.isFinite(opts.dirX) ? opts.dirX : 0, -1, 1);
    const dirZ = clamp(Number.isFinite(opts.dirZ) ? opts.dirZ : 0, -1, 1);
    setCupEnabled(false);
    setDamping(PHYS.linearDamping, PHYS.angularDamping);
    const g = PHYS.gravity;
    const T = F.minT + (F.maxT - F.minT) * (0.25 + 0.75 * power) * (0.9 + rng() * 0.2);
    const cx = dirX * 0.75, cz = F.centerZ + dirZ * 0.55;
    const a0 = rng() * Math.PI * 2;
    // 놓는 순간 손이 움직이던 속도도 조금 싣는다(흔들던 손의 기운). 판 밖으로 벗어나지 않게 크기를 제한한다
    const hv = Math.hypot(cupVel.x, cupVel.z);
    const hk = hv > 0 ? Math.min(0.3, 1.2 / hv) : 0;
    coins.forEach((c, i) => {
      const b = c.body;
      const p = b.translation();
      const a = a0 + (i * Math.PI * 2) / 3 + (rng() - 0.5) * 0.7;
      const rad = F.spread[0] + rng() * (F.spread[1] - F.spread[0]);
      const tx = cx + Math.cos(a) * rad, tz = cz + Math.sin(a) * rad * 0.8;
      const Ti = T * (0.92 + rng() * 0.16);
      const v = {
        x: (tx - p.x) / Ti + cupVel.x * hk,
        y: (F.landY - p.y - 0.5 * g * Ti * Ti) / Ti + Math.min(1.5, Math.max(0, cupVel.y) * 0.2),
        z: (tz - p.z) / Ti + cupVel.z * hk,
      };
      b.setLinvel(v, true);
      // 가로축 뒤집힘: 회전축 = 위쪽 × 날아가는 방향
      const hl = Math.hypot(v.x, v.z) || 1;
      const dx = v.x / hl, dz = v.z / hl;
      const rps = PHYS.flipRps[0] + rng() * (PHYS.flipRps[1] - PHYS.flipRps[0]) + power * 1.5;
      const w = (rng() < 0.5 ? -1 : 1) * rps * Math.PI * 2;
      b.setAngvel({ x: dz * w + (rng() - 0.5) * 8, y: (rng() - 0.5) * 6, z: -dx * w + (rng() - 0.5) * 8 }, true);
      c.still = 0; c.tilt = 0; c.calm = 0; c.nudges = 0; c.edgeEvents = 0;
      c.inside = false;
      c.deferT = 0;
      b.collider(0).setCollisionGroups(GROUP_COIN_FLIGHT);
    });
    sim.t = 0;
    sim.active = true;
    sim.damped = false;
    sim.retryReason = null;
  }

  /**
   * 고정 스텝 1회 + 안정 판정.
   * 반환: true = 세 동전 모두 착지·저속·평평하게 멈춤(판정 가능), 'retry' = 제한 시간 안에 못 멈춤(다시 던지기),
   *       false = 아직 진행 중(또는 손 안에서 흔드는 중)
   * @param {() => number} rng 넛지 방향용 난수
   */
  function step(rng = Math.random, eventQueue) {
    world.step(eventQueue);
    if (!sim.active) {
      // 손 안: 동전이 손 반경·바닥·뚜껑 밖으로 빠져나가면 곧바로 다시 모은다
      if (!cup.open) {
        const cp = cupBody.translation();
        const out = coins.some(({ body }) => {
          const p = body.translation();
          return Math.hypot(p.x - cp.x, p.z - cp.z) > C.innerRadius + 0.3 || p.y < cp.y + C.floorY - 0.3 || p.y > cp.y + C.lidY + 0.4;
        });
        if (out) { sim.handRegathers++; gather(rng); }
      }
      return false;
    }
    sim.t += PHYS.dt;

    // 시간이 지나도 안 멈추면 감쇠를 서서히 올려 물리적으로 가라앉힌다(결과는 여전히 물리가 정함)
    const k = sim.t > PHYS.softTimeout ? Math.min(1, (sim.t - PHYS.softTimeout) / 2) : 0;
    if (k > 0) sim.damped = true;

    let allStill = true;
    let outside = false;
    const P = coins.map(({ body }) => body.translation());
    for (let ci = 0; ci < coins.length; ci++) {
      const c = coins[ci];
      const b = c.body;
      const pos = P[ci];
      const r = Math.hypot(pos.x, pos.z);
      if (!c.inside && r < INSIDE_RADIUS) {
        // 다른 동전과 겹친 채 서로 부딪히게 바꾸면 튕겨 나가므로, 겹침이 풀릴 때까지 한 스텝씩 미룬다(최대 0.3초)
        const overlap = P.some((q, j) => j !== ci && Math.hypot(q.x - pos.x, q.y - pos.y, q.z - pos.z) < COIN_RADIUS * 2.05);
        c.deferT = overlap ? (c.deferT || 0) + PHYS.dt : 0;
        if (!overlap || c.deferT > 0.3) {
          c.inside = true;
          b.collider(0).setCollisionGroups(GROUP_COIN_INSIDE);
        }
      }
      if (pos.y < -2) {
        // 판도 탁자도 벗어나 떨어짐: 기다리지 않고 다시 던진다
        sim.active = false;
        sim.retryReason = 'outside';
        setDamping(PHYS.linearDamping, PHYS.angularDamping);
        return 'retry';
      }
      if (r > PHYS.tray.wallRadius) outside = true;
      const lv = len3(b.linvel()), av = len3(b.angvel());
      const uy = upY(b.rotation());
      const grounded = b.translation().y < COIN_RADIUS + 0.45 && Math.abs(b.linvel().y) < 4;
      const asleep = b.isSleeping();
      // 잠든 몸체는 건드리지 않는다(깨우지 않고 속도를 바꾸면 접촉 없이 적분되어 바닥을 뚫는다)
      // 다른 동전·턱과 겹쳐 누운 채 미세하게 떨리면(접촉 솔버 지터) 강한 감쇠로 그 자세에 가라앉힌다
      if (grounded && Math.abs(uy) >= PHYS.flatUp && lv < PHYS.calmLin && av < PHYS.calmAng) c.calm += PHYS.dt;
      else c.calm = 0;
      const calm = c.calm > PHYS.calmTime;
      if (!asleep) {
        b.setLinearDamping(calm ? PHYS.calmDamping : (grounded ? PHYS.groundLinearDamping : PHYS.linearDamping) + k * 5);
        b.setAngularDamping(calm ? PHYS.calmDamping : (grounded ? PHYS.groundAngularDamping : PHYS.angularDamping) + k * 6);
      }
      if (grounded && !asleep) {
        // 구름 마찰: 동전 자기 축 둘레 회전(바퀴처럼 구르기·납작하게 팽이 돌기)만 줄인다.
        // 넘어지는 회전은 그대로 두어 오일러 원반처럼 흔들리며 눕게 한다.
        const q = b.rotation(), w = b.angvel();
        const ax = 2 * (q.x * q.y - q.w * q.z), ay = uy, az = 2 * (q.y * q.z + q.w * q.x);
        const wn = (w.x * ax + w.y * ay + w.z * az) * (1 - Math.exp(-PHYS.rollingResistance * PHYS.dt));
        b.setAngvel({ x: w.x - ax * wn, y: w.y - ay * wn, z: w.z - az * wn }, false);
      }
      const slow = asleep || (lv < PHYS.stillLin && av < PHYS.stillAng);
      if (slow) c.still += PHYS.dt; else c.still = 0;

      // 모서리로 서 있거나 턱·다른 동전에 기대 멈춘 상태(기울어진 채 거의 안 움직임)
      if (Math.abs(uy) < PHYS.flatUp && lv < PHYS.tiltLin && b.translation().y < 1.2) c.tilt += PHYS.dt; else c.tilt = 0;
      if (c.tilt > PHYS.tiltTime) nudge(c, uy, rng);
      // 판정은 오직 착지·저속·평평: 완전히 멈췄거나, 바닥에 누운 채 미세 떨림만 충분히 이어졌을 때
      const rested = c.still >= PHYS.stillTime || c.calm >= PHYS.calmSettle;
      if (!(rested && Math.abs(uy) >= PHYS.flatUp)) allStill = false;
    }

    if (allStill && sim.t >= PHYS.minTime) {
      sim.active = false;
      setDamping(PHYS.linearDamping, PHYS.angularDamping);
      // 판 밖에 떨어져 멈춘 동전이 있으면 판정하지 않고 다시 던진다
      if (outside) { sim.retryReason = 'outside'; return 'retry'; }
      return true;
    }
    if (sim.t >= PHYS.giveUpTime) {
      sim.active = false;
      sim.retryReason = outside ? 'outside' : 'timeout';
      setDamping(PHYS.linearDamping, PHYS.angularDamping);
      return 'retry';
    }
    return false;
  }

  /** 각 동전 앞면(陽) 여부: 물리 자세로만 판정 */
  function readFaces() {
    return coins.map(({ body }) => upY(body.rotation()) > 0);
  }

  gather(Math.random);
  return { world, coins, cup, sim, gather, cupLayout, setCupOffset, release, step, readFaces };
}
