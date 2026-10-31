// 동전 물리 통계 시뮬레이터 (헤드리스, Rapier).
// 웹앱과 같은 src/physics-core.js 를 그대로 써서 여러 번 던지고
// 앞면 비율·안정 시간·모서리 착지율·이탈(터널링)을 보고한다.
// 버튼 던지기(기본값)와 폰 털기의 경계값(약하게/세게, 좌우 방향)을 각각 검증한다.
//
//   node scripts/physics-sim.mjs            # 시나리오별 400회
//   node scripts/physics-sim.mjs 1000 42    # 시나리오별 횟수, 시드

import RAPIER from '@dimforge/rapier3d-compat';
import { createCoinWorld, PHYS } from '../src/physics-core.js';

const THROWS = Number(process.argv[2] || 400);
const SEED = Number(process.argv[3] || 20261031);
const MAX_SIM_SECONDS = 15;

const SCENARIOS = [
  { name: '버튼 던지기(기본)', opts: {} },
  { name: '약한 털기(power 0, spin 0)', opts: { power: 0, spin: 0, dirX: 0 } },
  { name: '강한 털기(power 1, spin 1, 왼쪽)', opts: { power: 1, spin: 1, dirX: -1 } },
  { name: '강한 털기(power 1, spin 1, 오른쪽)', opts: { power: 1, spin: 1, dirX: 1 } },
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

await RAPIER.init();

function run(opts, seed) {
  const rng = mulberry32(seed);
  const cw = createCoinWorld(RAPIER);
  const r = {
    heads: 0, coins: 0, times: [], edge: 0, nudged: 0, damped: 0, unsettled: 0, retries: 0,
    oob: 0, below: 0, maxH: 0, sums: { 6: 0, 7: 0, 8: 0, 9: 0 },
  };
  const maxSteps = Math.round(MAX_SIM_SECONDS / PHYS.dt);
  for (let n = 0; n < THROWS; n++) {
    cw.reset();
    cw.launch(rng, opts);
    let settled = false, oob = false, below = false;
    for (let s = 0; s < maxSteps; s++) {
      const res = cw.step(rng);
      if (res === 'retry') { r.retries++; break; } // 앱은 이 효를 기록하지 않고 다시 던지게 한다
      settled = res === true;
      for (const { body } of cw.coins) {
        const p = body.translation();
        if (Math.hypot(p.x, p.z) > PHYS.tray.wallRadius + 0.05) oob = true;
        if (p.y < -0.02) below = true;
        if (p.y > r.maxH) r.maxH = p.y;
      }
      if (settled) break;
    }
    if (oob) r.oob++;
    if (below) r.below++;
    if (!settled) { r.unsettled++; continue; } // 다시 던지기 포함
    r.times.push(cw.sim.t);
    if (cw.sim.damped) r.damped++;
    let sum = 0;
    cw.readFaces().forEach((h) => { if (h) r.heads++; sum += h ? 3 : 2; r.coins++; });
    r.sums[sum]++;
    cw.coins.forEach((c) => { if (c.edgeEvents > 0) r.edge++; if (c.nudges > 0) r.nudged++; });
  }
  return r;
}

function report(name, r) {
  const ok = r.times.length;
  const sorted = [...r.times].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] || 0;
  const mean = r.times.reduce((a, b) => a + b, 0) / Math.max(1, ok);
  const ratio = r.heads / Math.max(1, r.coins);
  const sigma = Math.sqrt(0.25 / Math.max(1, r.coins));
  console.log(`\n[${name}] 던지기 ${THROWS}회, 동전 ${r.coins}개`);
  console.log(`  앞면 비율 ${(ratio * 100).toFixed(2)}%  (1σ=±${(sigma * 100).toFixed(2)}%p, 편차 ${((ratio - 0.5) / sigma).toFixed(2)}σ)`);
  console.log(`  효 분포 6:${r.sums[6]} 7:${r.sums[7]} 8:${r.sums[8]} 9:${r.sums[9]}  (기대 1:3:3:1 = ${(ok / 8).toFixed(0)}/${(ok * 3 / 8).toFixed(0)}/${(ok * 3 / 8).toFixed(0)}/${(ok / 8).toFixed(0)})`);
  console.log(`  안정 시간 평균 ${mean.toFixed(2)}s · 중앙 ${pct(0.5).toFixed(2)}s · p90 ${pct(0.9).toFixed(2)}s · 최대 ${pct(1).toFixed(2)}s`);
  console.log(`  모서리로 선 동전(넛지) ${r.edge}개 (${(r.edge / Math.max(1, r.coins) * 100).toFixed(2)}%), 넛지 받은 동전 ${r.nudged}개, 감쇠 보정 ${r.damped}회`);
  console.log(`  다시 던지기(${PHYS.giveUpTime}초 안에 착지·저속·평평 못 채움) ${r.retries}회 (${(r.retries / THROWS * 100).toFixed(2)}%), 그 밖의 미안정 ${r.unsettled - r.retries}회`);
  console.log(`  판 밖 이탈 ${r.oob}회 · 바닥 아래(터널링) ${r.below}회 · 최고 높이 ${r.maxH.toFixed(2)}`);
  return r;
}

console.log(`seed=${SEED}, dt=1/${Math.round(1 / PHYS.dt)}, 중력 ${PHYS.gravity}`);
const all = { heads: 0, coins: 0 };
SCENARIOS.forEach((sc, i) => {
  const r = report(sc.name, run(sc.opts, SEED + i * 7919));
  all.heads += r.heads; all.coins += r.coins;
});
const ratio = all.heads / all.coins;
const sigma = Math.sqrt(0.25 / all.coins);
console.log(`\n[전체] 동전 ${all.coins}개 앞면 ${(ratio * 100).toFixed(2)}% (편차 ${((ratio - 0.5) / sigma).toFixed(2)}σ)`);
