// 동전 물리 코어 (Rapier): three.js 에 의존하지 않는다.
// 브라우저(stage.js)와 node 통계 시뮬레이터(scripts/physics-sim.mjs)가
// 같은 파라미터·같은 던지기·같은 안정 판정을 공유하도록 한곳에 둔다.

export const COIN_RADIUS = 0.5;
export const COIN_THICKNESS = 0.12;
const COIN_BORDER = 0.022; // 둥근 모서리(라운드 실린더) 반경: 테두리로 구르고 흔들리게

export const PHYS = {
  gravity: -26,
  dt: 1 / 120,           // 고정 시간 간격
  // 점판: 평평한 바닥 반경, 비스듬한 턱(바깥 반경·각도), 안전벽 반경
  tray: { flatRadius: 2.0, bevelOuter: 2.55, bevelAngle: 0.61, bevelFriction: 0.12, wallRadius: 2.75, segments: 64 },
  coin: { density: 8.9, friction: 0.25, restitution: 0.32 },
  table: { friction: 0.52, restitution: 0.26 },
  linearDamping: 0.08,
  angularDamping: 0.22,
  contactHz: 5,
  // 바닥에 닿아 구르거나 흔들릴 때의 저항(구름 마찰 근사). 공중에서는 위의 작은 감쇠만.
  groundLinearDamping: 0.6,
  groundAngularDamping: 1.0,
  rollingResistance: 6,
  // 안정 판정
  stillLin: 0.07,
  stillAng: 0.22,
  stillTime: 0.28,        // 이 시간 동안 멈춰 있어야 안정
  calmLin: 0.25,
  calmAng: 1.5,
  calmTime: 0.5,
  calmDamping: 12,
  calmSettle: 1.1,
  flatUp: 0.8,            // |up.y| 가 이 이상이면 면으로 누운 것
  minTime: 0.7,
  softTimeout: 3.2,       // 이후 감쇠를 서서히 올려 물리적으로 멈추게 한다(결과 판정에는 쓰지 않는다)
  giveUpTime: 12,         // 그래도 착지·저속·평평 조건을 못 채우면 이 효는 기록하지 않고 다시 던진다
  soundForceThreshold: 55,
};

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

/** 점판 단면(반경, 높이)을 회전시켜 만든 삼각망. 화면의 쟁반 모양(scene.js)도 같은 단면을 쓴다. */
export function trayProfile() {
  const T = PHYS.tray;
  const rimY = (T.bevelOuter - T.flatRadius) * Math.tan(T.bevelAngle);
  return [
    [0, 0], [T.flatRadius * 0.5, 0], [T.flatRadius, 0],
    [T.bevelOuter, rimY], [T.wallRadius, rimY], [T.wallRadius, 4],
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
 * Rapier 월드와 동전 3개를 만든다.
 * @param {*} RAPIER init() 완료된 Rapier 모듈
 */
export function createCoinWorld(RAPIER) {
  const world = new RAPIER.World({ x: 0, y: PHYS.gravity, z: 0 });
  world.timestep = PHYS.dt;
  world.numSolverIterations = 8;
  // 접촉을 약간 부드럽게(기본 30Hz → 낮춤): 동전끼리 겹쳐 누웠을 때의 미세 떨림을 없앤다
  world.integrationParameters.contact_natural_frequency = PHYS.contactHz;

  // 점판(占盤): 둥근 칠기 쟁반. 평평한 바닥 둘레를 비스듬한 턱(bevel)이 감싸고, 그 위로
  // 보이지 않는 높은 벽이 이어진다. 바닥은 두꺼운 상자(관통 방지), 턱·벽은 매끈한 회전체 삼각망(마찰 작게)으로 나눈다.
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
    RAPIER.ColliderDesc.trimesh(...latheMesh(prof.slice(2)), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setFriction(PHYS.tray.bevelFriction)
      .setRestitution(PHYS.table.restitution),
    tray,
  );
  // 만일을 위한 두꺼운 안전판(평소엔 닿지 않는 높이)
  world.createCollider(RAPIER.ColliderDesc.cuboid(4, 0.5, 4).setTranslation(0, -0.58, 0), tray);

  const coins = [];
  for (let i = 0; i < 3; i++) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation((i - 1) * 1.1, COIN_THICKNESS / 2, 0)
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
        // 소리용 접촉 세기 이벤트: 가만히 놓인 무게(약 22)보다 충분히 큰 힘만 알린다
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(PHYS.soundForceThreshold),
      body,
    );
    coins.push({ body, still: 0, tilt: 0, calm: 0, nudges: 0, edgeEvents: 0 });
  }

  const sim = { t: 0, active: false, damped: false };

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
      // 윗부분은 -sign(uy)·법선수평 방향으로 기울어 있다. 거의 수직이면 판 안쪽으로.
      const sgn = Math.abs(uy) > 0.08 ? -Math.sign(uy) : ((nx * dx + nz * dz) >= 0 ? 1 : -1);
      fx = sgn * nx / hl; fz = sgn * nz / hl;
    }
    const m = b.mass();
    if (r > PHYS.tray.flatRadius - 0.6) {
      // 벽에 기댐: 바닥 쪽을 판 안쪽으로 끌어 윗부분이 벽을 타고 미끄러져 눕게 한다
      const k = 0.9 + c.nudges * 0.35;
      b.applyImpulse({ x: dx * m * k, y: m * 0.15, z: dz * m * k }, true);
    } else {
      const s = 2.0 + c.nudges * 0.8;
      b.setAngvel({ x: fz * s, y: 0, z: -fx * s }, true);
      b.applyImpulse({ x: dx * m * 0.3, y: m * 0.3, z: dz * m * 0.3 }, true);
    }
    c.tilt = 0;
    c.still = 0;
    c.nudges++;
    if (Math.abs(uy) < 0.35) c.edgeEvents++;
  }

  /** 처음 자리(나란히 앞면으로)로 되돌린다. */
  function reset() {
    setDamping(PHYS.linearDamping, PHYS.angularDamping);
    coins.forEach((c, i) => {
      c.body.setTranslation({ x: (i - 1) * 1.1, y: COIN_THICKNESS / 2, z: 0.2 }, true);
      c.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      c.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      c.still = 0; c.tilt = 0; c.calm = 0; c.nudges = 0; c.edgeEvents = 0;
    });
    sim.active = false;
  }

  /**
   * 사용자 쪽(+z)에서 손으로 흩뿌리듯 던진다. 회전은 던지는 방향에 수직인 축(x) 위주.
   * opts 는 폰 털기 동작의 세기를 반영한다(버튼 던지기는 기본값 0.5).
   * 초기 자세는 opts 와 무관하게 항상 균일 무작위라서 사용자 동작으로 결과를 고를 수 없다.
   * @param {() => number} rng 0~1 난수
   * @param {{ power?:number, spin?:number, dirX?:number }} opts power·spin 0~1, dirX -1~1
   */
  function launch(rng = Math.random, opts = {}) {
    const clamp = (v, a, b, d) => (Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d);
    const power = clamp(opts.power, 0, 1, 0.5);
    const spin = clamp(opts.spin, 0, 1, 0.5);
    const dirX = clamp(opts.dirX, -1, 1, 0);
    const up = 0.88 + 0.24 * power, fwd = 0.85 + 0.3 * power, rot = 0.8 + 0.4 * spin;
    setDamping(PHYS.linearDamping, PHYS.angularDamping);
    const order = [0, 1, 2].sort(() => rng() - 0.5); // 높이 순서도 섞는다
    coins.forEach((c, i) => {
      const x = (i - 1) * 1.04;
      const y = 0.75 + order[i] * 0.22 + rng() * 0.1;
      const z = 1.05 + (rng() - 0.5) * 0.18;
      c.body.setTranslation({ x, y, z }, true);
      c.body.setRotation(randomQuat(rng), true);
      c.body.setLinvel({
        x: x * 0.35 + (rng() - 0.5) * 1.2 + dirX * 0.5,
        y: (4.2 + rng() * 1.8) * up,
        z: -(1.4 + rng() * 1.0) * fwd,
      }, true);
      const flip = (rng() < 0.5 ? -1 : 1) * (13 + rng() * 15) * rot;
      c.body.setAngvel({
        x: flip + (rng() - 0.5) * 4,
        y: (rng() - 0.5) * 10,
        z: (rng() - 0.5) * 12,
      }, true);
      c.still = 0; c.tilt = 0; c.calm = 0; c.nudges = 0; c.edgeEvents = 0;
    });
    sim.t = 0;
    sim.active = true;
    sim.damped = false;
  }

  /**
   * 흔드는 동안 판 위의 동전을 살짝 들썩이게 한다(짤랑임). 결과 판정과는 무관하다.
   * @param {number} intensity 0~1
   */
  function jiggle(intensity, rng = Math.random) {
    if (sim.active) return;
    const k = Math.min(1, Math.max(0, intensity));
    coins.forEach(({ body }) => {
      if (body.translation().y > 0.35) return; // 이미 떠 있으면 건너뛴다
      const m = body.mass();
      body.applyImpulse({ x: (rng() - 0.5) * m * 0.6 * k, y: m * (1.3 + rng() * 1.3) * k, z: (rng() - 0.5) * m * 0.6 * k }, true);
      const a = rng() * Math.PI * 2;
      body.applyTorqueImpulse({ x: Math.cos(a) * m * 0.18 * k, y: (rng() - 0.5) * m * 0.06 * k, z: Math.sin(a) * m * 0.18 * k }, true);
    });
  }

  /**
   * 고정 스텝 1회 + 안정 판정.
   * 반환: true = 세 동전 모두 착지·저속·평평하게 멈춤(판정 가능), 'retry' = 제한 시간 안에 못 멈춤(다시 던지기),
   *       false = 아직 진행 중
   * @param {() => number} rng 넛지 방향용 난수
   */
  function step(rng = Math.random, eventQueue) {
    world.step(eventQueue);
    if (!sim.active) return false;
    sim.t += PHYS.dt;

    // 시간이 지나도 안 멈추면 감쇠를 서서히 올려 물리적으로 가라앉힌다(결과는 여전히 물리가 정함)
    const k = sim.t > PHYS.softTimeout ? Math.min(1, (sim.t - PHYS.softTimeout) / 2.5) : 0;
    if (k > 0) sim.damped = true;

    let allStill = true;
    for (const c of coins) {
      const b = c.body;
      const lv = len3(b.linvel()), av = len3(b.angvel());
      const uy = upY(b.rotation());
      const grounded = b.translation().y < COIN_RADIUS + 0.08 && Math.abs(b.linvel().y) < 1.5;
      const asleep = b.isSleeping();
      // 잠든 몸체는 건드리지 않는다(깨우지 않고 속도를 바꾸면 접촉 없이 적분되어 바닥을 뚫는다)
      // 다른 동전·턱과 겹쳐 누운 채 미세하게 떨리면(접촉 솔버 지터) 강한 감쇠로 그 자세에 가라앉힌다
      if (grounded && Math.abs(uy) >= PHYS.flatUp && lv < PHYS.calmLin && av < PHYS.calmAng) c.calm += PHYS.dt;
      else c.calm = 0;
      const calm = c.calm > PHYS.calmTime;
      if (!asleep) {
        b.setLinearDamping(calm ? PHYS.calmDamping : (grounded ? PHYS.groundLinearDamping : PHYS.linearDamping) + k * 2.2);
        b.setAngularDamping(calm ? PHYS.calmDamping : (grounded ? PHYS.groundAngularDamping : PHYS.angularDamping) + k * 2.6);
      }
      if (grounded && !asleep) {
        // 구름 마찰: 동전 자기 축 둘레 회전(바퀴처럼 구르기·납작하게 팽이 돌기)만 줄인다.
        // 넘어지는 회전은 그대로 두어 모서리로 선 채 멈추지 않게 한다.
        const q = b.rotation(), w = b.angvel();
        const ax = 2 * (q.x * q.y - q.w * q.z), ay = uy, az = 2 * (q.y * q.z + q.w * q.x);
        const wn = (w.x * ax + w.y * ay + w.z * az) * (1 - Math.exp(-PHYS.rollingResistance * PHYS.dt));
        b.setAngvel({ x: w.x - ax * wn, y: w.y - ay * wn, z: w.z - az * wn }, false);
      }
      const slow = asleep || (lv < PHYS.stillLin && av < PHYS.stillAng);
      if (slow) c.still += PHYS.dt; else c.still = 0;

      // 모서리로 서 있거나 벽·다른 동전에 기대 멈춘 상태(기울어진 채 거의 안 움직임)
      if (Math.abs(uy) < PHYS.flatUp && lv < 0.15) c.tilt += PHYS.dt; else c.tilt = 0;
      if (c.tilt > 0.45) nudge(c, uy, rng);
      // 판정은 오직 착지·저속·평평: 완전히 멈췄거나, 바닥에 누운 채 미세 떨림만 충분히 이어졌을 때
      const rested = c.still >= PHYS.stillTime || c.calm >= PHYS.calmSettle;
      if (!(rested && Math.abs(uy) >= PHYS.flatUp)) allStill = false;
    }

    if (allStill && sim.t >= PHYS.minTime) {
      sim.active = false;
      setDamping(PHYS.linearDamping, PHYS.angularDamping);
      return true;
    }
    if (sim.t >= PHYS.giveUpTime) {
      sim.active = false;
      setDamping(PHYS.linearDamping, PHYS.angularDamping);
      return 'retry';
    }
    return false;
  }

  /** 각 동전 앞면(陽) 여부: 물리 자세로만 판정 */
  function readFaces() {
    return coins.map(({ body }) => upY(body.rotation()) > 0);
  }

  return { world, coins, sim, reset, launch, jiggle, step, readFaces };
}
