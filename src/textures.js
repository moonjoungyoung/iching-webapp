import * as THREE from 'three';

/**
 * 동전 앞면/뒷면 텍스처 생성 (Canvas 1024px)
 */
export function createCoinFaceTexture(isHeads) {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2, cy = size / 2, r = size / 2 - 12;

  ctx.clearRect(0, 0, size, size);

  // 동전 바탕 — 다층 그라디언트로 입체감
  const grad = ctx.createRadialGradient(cx * 0.85, cy * 0.8, r * 0.05, cx, cy, r);
  grad.addColorStop(0, '#e2c070');
  grad.addColorStop(0.25, '#d4a84a');
  grad.addColorStop(0.55, '#b87333');
  grad.addColorStop(0.8, '#8b5e20');
  grad.addColorStop(1, '#6b4510');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // 외곽 테두리 — 이중 링 (양각)
  ctx.beginPath();
  ctx.arc(cx, cy, r - 3, 0, Math.PI * 2);
  ctx.strokeStyle = '#ddb866';
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r - 12, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(160,120,40,0.4)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 내곽 원 (구멍 주변 장식)
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.38, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(160,120,40,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 사각 구멍 — 그림자 효과
  const hole = size * 0.09;
  // 구멍 그림자
  ctx.fillStyle = 'rgba(10,5,0,0.6)';
  ctx.fillRect(cx - hole + 3, cy - hole + 3, hole * 2, hole * 2);
  // 구멍 본체
  ctx.fillStyle = '#0e0800';
  ctx.fillRect(cx - hole, cy - hole, hole * 2, hole * 2);
  // 구멍 양각 테두리
  ctx.strokeStyle = '#c9a84c';
  ctx.lineWidth = 4;
  ctx.strokeRect(cx - hole, cy - hole, hole * 2, hole * 2);
  // 내부 밝은 테두리
  ctx.strokeStyle = 'rgba(220,180,80,0.3)';
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - hole + 4, cy - hole + 4, hole * 2 - 8, hole * 2 - 8);

  if (isHeads) {
    // 앞면: 開元通寶 — 양각 효과 (그림자 + 하이라이트)
    const fontSize = size * 0.11;
    const charDist = r * 0.42;
    const chars = [
      { ch: '開', x: cx, y: cy - charDist },
      { ch: '元', x: cx, y: cy + charDist },
      { ch: '通', x: cx - charDist, y: cy },
      { ch: '寶', x: cx + charDist, y: cy },
    ];

    ctx.font = `bold ${fontSize}px "LXGW WenKai TC", "Noto Serif SC", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 그림자 (음각 깊이감)
    ctx.fillStyle = 'rgba(40,20,5,0.7)';
    chars.forEach(({ ch, x, y }) => ctx.fillText(ch, x + 2, y + 2));

    // 본체
    ctx.fillStyle = '#6b4a18';
    chars.forEach(({ ch, x, y }) => ctx.fillText(ch, x, y));

    // 하이라이트 (양각 반사)
    ctx.fillStyle = 'rgba(220,180,100,0.3)';
    chars.forEach(({ ch, x, y }) => ctx.fillText(ch, x - 1.5, y - 1.5));

    // 네 모서리 장식 점
    const dotDist = r * 0.7;
    const dotR = 4;
    ctx.fillStyle = 'rgba(100,70,20,0.5)';
    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([dx, dy]) => {
      ctx.beginPath();
      ctx.arc(cx + dx * dotDist * 0.5, cy + dy * dotDist * 0.5, dotR, 0, Math.PI * 2);
      ctx.fill();
    });
  } else {
    // 뒷면: 월아(月牙) 초승달 + 점 (전통 뒷면 디자인)
    ctx.fillStyle = '#6b4a18';

    // 위쪽 초승달
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.32, 14, Math.PI * 0.15, Math.PI * 0.85, false);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#6b4a18';
    ctx.stroke();

    // 아래쪽 점
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.32, 7, 0, Math.PI * 2);
    ctx.fill();

    // 미세한 동심원 장식
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(120,85,30,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 세월의 흔적 — 미세 노이즈 + 녹청 자국
  const imgData = ctx.getImageData(0, 0, size, size);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const noise = (Math.random() - 0.5) * 14;
    d[i] = Math.max(0, Math.min(255, d[i] + noise));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + noise));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + noise));

    // 랜덤 녹청 자국 (초록빛)
    if (Math.random() < 0.003) {
      d[i] = Math.max(0, d[i] - 15);
      d[i + 1] = Math.min(255, d[i + 1] + 8);
      d[i + 2] = Math.min(255, d[i + 2] + 5);
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * 나무 질감 테이블 텍스처 생성
 */
export function createWoodTexture() {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#2a1810';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 90; i++) {
    const y = Math.random() * size;
    const r = 45 + Math.random() * 35;
    const g = 22 + Math.random() * 22;
    const b = 8 + Math.random() * 14;
    const a = 0.12 + Math.random() * 0.22;
    ctx.strokeStyle = `rgba(${r},${g},${b},${a})`;
    ctx.lineWidth = 0.4 + Math.random() * 2.2;
    ctx.beginPath();
    const phase = Math.random() * Math.PI * 2;
    const freq = 30 + Math.random() * 40;
    const amp = 1.5 + Math.random() * 3;
    for (let x = 0; x <= size; x += 4) {
      const yy = y + Math.sin(x / freq + phase) * amp;
      x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }

  for (let i = 0; i < 2; i++) {
    const kx = 120 + Math.random() * (size - 240);
    const ky = 120 + Math.random() * (size - 240);
    const kr = 18 + Math.random() * 25;
    const grad = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
    grad.addColorStop(0, 'rgba(18,10,4,0.5)');
    grad.addColorStop(0.6, 'rgba(35,20,10,0.25)');
    grad.addColorStop(1, 'rgba(42,24,16,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(kx - kr, ky - kr, kr * 2, kr * 2);
  }

  const sheen = ctx.createRadialGradient(size * 0.45, size * 0.4, 0, size / 2, size / 2, size * 0.6);
  sheen.addColorStop(0, 'rgba(60,35,18,0.15)');
  sheen.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
