// 동전 물리 통계 시뮬레이터 (헤드리스, Rapier).
// 웹앱과 같은 src/physics-core.js(같은 손·같은 흔들기 패턴·같은 던지기·같은 안정 판정)를 그대로 써서
// 여러 번 던지고 앞면 비율·안정 시간·비행 시간·다시 던지기 비율·판 이탈을 보고한다.
// 흔든 시간·세기와 던지는 세기·방향(버튼 탭, 길게 흔들기, 약한/강한 털기, 좌우·앞뒤 끌어 던지기)을 각각 검증한다.
//
//   node scripts/physics-sim.mjs            # 시나리오별 300회
//   node scripts/physics-sim.mjs 1000 42    # 시나리오별 횟수, 시드

import RAPIER from '@dimforge/rapier3d-compat';
import { createCoinWorld, PHYS, autoShakeOffset, createWristSpring } from '../src/physics-core.js';

const THROWS = Number(process.argv[2] || 300);
const SEED = Number(process.argv[3] || 20261031);
const MAX_SIM_SECONDS = 14;

// shake: 손을 흔든 시간(초), intensity: 흔들기 세기, opts: 던지는 세기·방향
const SCENARIOS = [
  { name: '버튼 탭(짧게 흔들고 던짐)', shake: 0.38, intensity: 0.75, opts: { power: 0.4 } },
  { name: '버튼 길게(2초 흔들고 놓기)', shake: 2.0, intensity: 0.75, opts: { power: 1 } },
  { name: '약한 털기(power 0)', shake: 0.6, intensity: 0.3, opts: { power: 0, dirX: 0 } },
  { name: '강한 털기(power 1, 왼쪽 앞)', shake: 1.2, intensity: 1, opts: { power: 1, dirX: -1, dirZ: 0.6 } },
  { name: '강한 털기(power 1, 오른쪽 뒤)', shake: 1.2, intensity: 1, opts: { power: 1, dirX: 1, dirZ: -1 } },
  { name: '캔버스 끌어 던지기(위로 빠르게)', shake: 0.8, intensity: 0.6, opts: { power: 0.9, dirX: 0.2, dirZ: -1 } },
  // 판 위를 누른 채 손을 크게 끌며 흔들기(포인터 변위 + 저역 필터, 진폭 한계 끝까지)
  { name: '포인터로 크게 끌며 흔들기', shake: 1.0, input: 'pointer', opts: { power: 0.8, dirX: -0.4, dirZ: -0.8 } },
  // 폰 흔들기: 손목 스프링에 4Hz 로 세게 흔든 가속도(최대 약 20 m/s²)를 넣고 털기
  { name: '폰 흔들기(손목 스프링)', shake: 1.6, input: 'phone', opts: { power: 0.9, dirX: 0.3, dirZ: -0.3 } },
  // 손에 거두자마자(동전이 아직 쌓여 떠 있을 때) 바로 던지기
  { name: '거두자마자 바로 던지기', shake: 0, settle: 0, opts: { power: 0.5 } },
];

// 재현 가능한 난수 (mulberry32)
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pct = (a, b) => `${((a / Math.max(1, b)) * 100).toFixed(1)}%`;
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0; };

await RAPIER.init();
const cw = createCoinWorld(RAPIER);
const rng = mulberry32(SEED);
console.log(`시나리오별 ${THROWS}회, 시드 ${SEED}, 중력 ${PHYS.gravity.toFixed(1)} 단위/s², dt 1/${Math.round(1 / PHYS.dt)}`);
let allHeads = 0, allCoins = 0;

for (const sc of SCENARIOS) {
  let heads = 0, coins = 0, retries = 0, oob = 0, below = 0, inHandEscape = 0, maxH = 0, handRegather = 0;
  const settle = [], flights = [];
  const sumDist = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (let n = 0; n < THROWS; n++) {
    cw.gather(rng);
    const regather0 = cw.sim.handRegathers;
    // 손 안에서 가라앉히기 → 흔들기 → 잠깐 멈춤
    const settleS = sc.settle ?? 0.4;
    for (let s = 0; s < Math.round(settleS / PHYS.dt); s++) { cw.setCupOffset({ x: 0, y: 0, z: 0 }); cw.step(rng); }
    const phase = rng() * 10;
    const spring = createWristSpring();
    const pm = { x: 0, z: 0 };
    for (let s = 0; s < Math.round(sc.shake / PHYS.dt); s++) {
      const t = s * PHYS.dt;
      let off;
      if (sc.input === 'pointer') {
        // 목표 변위가 진폭 한계 끝까지 크게 오가고, 브라우저와 같은 저역 필터(70ms)를 거친다
        const tx = Math.sign(Math.sin(t * Math.PI * 2 * 2.5 + phase)) * PHYS.cup.maxOffset.x;
        const tz = Math.sin(t * Math.PI * 2 * 1.7 + phase) * PHYS.cup.maxOffset.z;
        const k = 1 - Math.exp(-PHYS.dt / 0.07);
        pm.x += (tx - pm.x) * k; pm.z += (tz - pm.z) * k;
        off = { x: pm.x, y: 0, z: pm.z };
      } else if (sc.input === 'phone') {
        const g = 20 * Math.sin(t * Math.PI * 2 * 4 + phase);
        spring.sample(g * 0.8, g * 0.6, g * 0.2);
        off = { ...spring.step(PHYS.dt) };
      } else {
        off = autoShakeOffset(t, phase, sc.intensity);
      }
      cw.setCupOffset(off);
      cw.step(rng);
    }
    if (cw.sim.handRegathers > regather0) handRegather++;
    // 흔드는 동안 손 밖으로 빠져나간 동전이 있는지(그릇 벽 터널링)
    const C = cw.cup.body.translation(); // 흔들린 지금 손 위치 기준
    if (cw.coins.some(({ body }) => { const p = body.translation(); return Math.hypot(p.x - C.x, p.z - C.z) > PHYS.cup.innerRadius + 0.5 || p.y < C.y - 1.5; })) inHandEscape++;
    cw.release(rng, sc.opts);
    let res = false, out = false, bl = false, landed = null;
    for (let s = 0; s < Math.round(MAX_SIM_SECONDS / PHYS.dt); s++) {
      res = cw.step(rng);
      for (const { body } of cw.coins) {
        const p = body.translation();
        if (p.y > maxH) maxH = p.y;
        if (p.y < -0.7) bl = true;
        if (landed === null && p.y < 0.6 && Math.hypot(p.x, p.z) < PHYS.tray.flatRadius) landed = cw.sim.t;
      }
      if (res) break;
    }
    for (const { body } of cw.coins) {
      const p = body.translation();
      if (Math.hypot(p.x, p.z) > PHYS.tray.wallRadius + 0.05) out = true;
    }
    if (landed !== null) flights.push(landed);
    if (out) oob++;
    if (bl) below++;
    if (res !== true) { retries++; continue; }
    settle.push(cw.sim.t);
    const f = cw.readFaces();
    const h = f.filter(Boolean).length;
    sumDist[h]++;
    heads += h; coins += 3;
  }
  allHeads += heads; allCoins += coins;
  const done = THROWS - retries;
  console.log(`\n[${sc.name}] 흔들기 ${sc.shake}s`);
  console.log(`  앞면 비율 ${pct(heads, coins)}  (앞면 수 0/1/2/3: ${[0, 1, 2, 3].map((k) => pct(sumDist[k], done)).join(' / ')}, 기대 12.5/37.5/37.5/12.5%)`);
  console.log(`  안정 시간 평균 ${mean(settle).toFixed(2)}s  중앙 ${q(settle, 0.5).toFixed(2)}s  p90 ${q(settle, 0.9).toFixed(2)}s  최대 ${q(settle, 1).toFixed(2)}s`);
  console.log(`  첫 착지까지 비행 평균 ${mean(flights).toFixed(2)}s (최소 ${q(flights, 0).toFixed(2)} 최대 ${q(flights, 1).toFixed(2)})  최고 높이 ${maxH.toFixed(1)}`);
  console.log(`  다시 던지기 ${retries}회(${pct(retries, THROWS)})  판 이탈 ${oob}  바닥 관통 ${below}  손 안 이탈(던지는 순간) ${inHandEscape}  흔드는 중 빠져나가 다시 모음 ${handRegather}`);
}
console.log(`\n전체 앞면 비율 ${pct(allHeads, allCoins)} (${allCoins}닢)`);
