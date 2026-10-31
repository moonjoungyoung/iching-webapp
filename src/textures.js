import * as THREE from 'three';

// 팔괘(先天): 건태리진손감간곤. 1=양효, 0=음효 (안쪽→바깥쪽)
const TRIGRAMS = [
  [1, 1, 1], [1, 1, 0], [1, 0, 1], [1, 0, 0],
  [0, 1, 1], [0, 1, 0], [0, 0, 1], [0, 0, 0],
];

function rand(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 점판 바닥: 흑칠 바탕 + 금니(金泥)로 그은 원(一圓相) + 가장자리 팔괘 새김.
 * 캔버스 그리기만 쓰고 픽셀 단위 루프는 쓰지 않는다.
 */
export function createTrayFloorTexture(size = 2048) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const R = size / 2;
  const rnd = rand(64);

  // 흑칠: 가운데가 아주 조금 붉게 비치는 검정
  const base = ctx.createRadialGradient(R * 0.92, R * 0.86, R * 0.05, R, R, R);
  base.addColorStop(0, '#2a1611');
  base.addColorStop(0.6, '#1b0e0b');
  base.addColorStop(1, '#120a08');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // 옻칠 붓결: 동심원을 따라 흐르는 아주 옅은 결
  ctx.lineCap = 'round';
  for (let i = 0; i < 140; i++) {
    const r = R * (0.08 + rnd() * 0.9);
    const a0 = rnd() * Math.PI * 2;
    ctx.strokeStyle = rnd() < 0.5 ? `rgba(70,32,22,${0.05 + rnd() * 0.08})` : `rgba(0,0,0,${0.08 + rnd() * 0.1})`;
    ctx.lineWidth = size * (0.0015 + rnd() * 0.004);
    ctx.beginPath();
    ctx.arc(R, R, r, a0, a0 + 0.4 + rnd() * 1.6);
    ctx.stroke();
  }

  // 一圓相: 붓 한 번에 긋는 원. 별도 캔버스에 불투명하게 그은 뒤 옅게 얹어 이음매 얼룩을 없앤다
  const ec = document.createElement('canvas');
  ec.width = ec.height = size;
  const e = ec.getContext('2d');
  e.lineCap = 'round';
  e.strokeStyle = '#c49e56';
  const er = R * 0.64;
  const start = -Math.PI * 0.62;
  const sweep = Math.PI * 1.86;
  const steps = 420;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const a = start + sweep * t;
    // 처음엔 먹을 듬뿍(굵게), 끝으로 갈수록 가늘고 갈라진다
    const w = size * (0.006 + 0.016 * Math.sin(Math.min(1, t * 1.4) * Math.PI * 0.5) * (1 - t * 0.75));
    const wob = Math.sin(t * 23) * size * 0.0012;
    e.lineWidth = w;
    e.beginPath();
    e.arc(R, R, er + wob, a, a + sweep / steps * 1.6);
    e.stroke();
  }
  // 마른 붓 끝의 갈라짐
  e.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 70; i++) {
    const t = 0.55 + rnd() * 0.45;
    const a = start + sweep * t;
    e.lineWidth = size * (0.0008 + rnd() * 0.0016);
    e.beginPath();
    e.arc(R, R, er + (rnd() - 0.5) * size * 0.014, a, a + 0.05 + rnd() * 0.25);
    e.stroke();
  }
  ctx.globalAlpha = 0.34;
  ctx.drawImage(ec, 0, 0);
  ctx.globalAlpha = 1;

  // 팔괘 띠: 가는 금선 두 줄 사이에 괘를 새긴다
  ctx.strokeStyle = 'rgba(201,166,94,0.32)';
  ctx.lineWidth = Math.max(1, size * 0.0012);
  [0.78, 0.95].forEach((k) => { ctx.beginPath(); ctx.arc(R, R, R * k, 0, Math.PI * 2); ctx.stroke(); });

  const ringR = R * 0.865, barLen = R * 0.15, barH = R * 0.016, gap = R * 0.03;
  ctx.fillStyle = 'rgba(201,166,94,0.42)';
  TRIGRAMS.forEach((tri, k) => {
    const ang = (k / 8) * Math.PI * 2 - Math.PI / 2;
    ctx.save();
    ctx.translate(R + Math.cos(ang) * ringR, R + Math.sin(ang) * ringR);
    ctx.rotate(ang + Math.PI / 2);
    tri.forEach((yang, j) => {
      const y = (1 - j) * gap; // 안쪽 효가 아래
      if (yang) ctx.fillRect(-barLen / 2, y - barH / 2, barLen, barH);
      else {
        const seg = barLen * 0.42;
        ctx.fillRect(-barLen / 2, y - barH / 2, seg, barH);
        ctx.fillRect(barLen / 2 - seg, y - barH / 2, seg, barH);
      }
    });
    ctx.restore();
  });

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 탁자: 반복되는 어두운 나뭇결 */
export function createTableTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const rnd = rand(7);
  ctx.fillStyle = '#140d0a';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 70; i++) {
    const y = rnd() * size;
    ctx.strokeStyle = `rgba(${40 + rnd() * 30},${22 + rnd() * 14},${12 + rnd() * 8},${0.12 + rnd() * 0.2})`;
    ctx.lineWidth = 0.6 + rnd() * 2;
    ctx.beginPath();
    const phase = rnd() * Math.PI * 2, amp = 1 + rnd() * 3;
    for (let x = 0; x <= size; x += 8) {
      const yy = y + Math.sin((x / size) * Math.PI * 2 * 2 + phase) * amp;
      if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
