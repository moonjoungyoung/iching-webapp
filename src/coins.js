import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { coinPhysMaterial } from './physics.js';

const COIN_RADIUS = 0.5;
const COIN_THICKNESS = 0.12;
const COIN_SEGMENTS = 48;
const PHYS_HEIGHT = 0.14;

/**
 * 이미지를 캔버스에 로드하고 배경을 평균색(어둡게)으로 채움
 */
function loadTex(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const size = Math.max(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');

      // 1) 이미지를 일단 그려서 평균 색상 추출
      ctx.drawImage(img, (size - img.width) / 2, (size - img.height) / 2);
      const sample = ctx.getImageData(0, 0, size, size).data;
      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      const cx = size / 2, cy = size / 2, r = size * 0.4;
      for (let y = 0; y < size; y += 4) {
        for (let x = 0; x < size; x += 4) {
          const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
          if (dist > r) continue; // 동전 영역만 샘플링
          const i = (y * size + x) * 4;
          const brightness = (sample[i] + sample[i+1] + sample[i+2]) / 3;
          if (brightness < 200) { // 너무 밝은 것 제외
            rSum += sample[i]; gSum += sample[i+1]; bSum += sample[i+2];
            count++;
          }
        }
      }
      // 평균색을 약간 어둡게 (0.6배)
      const darkFactor = 0.6;
      const avgR = Math.round((rSum / count) * darkFactor);
      const avgG = Math.round((gSum / count) * darkFactor);
      const avgB = Math.round((bSum / count) * darkFactor);

      // 2) 캔버스를 평균 어두운색으로 채우고 이미지 다시 그리기
      ctx.fillStyle = `rgb(${avgR},${avgG},${avgB})`;
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, (size - img.width) / 2, (size - img.height) / 2);

      // 3) 가장자리 밝은 픽셀 → 평균 어두운색으로 교체
      const data = ctx.getImageData(0, 0, size, size);
      const d = data.data;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4;
          const brightness = (d[i] + d[i+1] + d[i+2]) / 3;
          if (brightness > 160) {
            d[i] = avgR; d[i+1] = avgG; d[i+2] = avgB;
          }
        }
      }
      ctx.putImageData(data, 0, 0);

      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      resolve(tex);
    };
    img.src = src;
  });
}

/**
 * 사각 구멍 알파맵 생성 (중앙 투명)
 */
function createHoleAlpha() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  // 전체 불투명 (흰색)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  // 원 바깥도 투명 (검정) — CylinderGeometry cap이 원이므로 불필요하지만 안전
  // 중앙 사각 구멍 (검정 = 투명)
  const hole = size * 0.09;
  ctx.fillStyle = '#000000';
  ctx.fillRect(size / 2 - hole, size / 2 - hole, hole * 2, hole * 2);

  const tex = new THREE.CanvasTexture(c);
  return tex;
}

/**
 * 동전 3개 생성
 */
export async function createCoins(scene, world) {
  const [headsTex, tailsTex] = await Promise.all([
    loadTex('/coin-front.png'),
    loadTex('/coin-back.png'),
  ]);

  const holeAlpha = createHoleAlpha();

  // CylinderGeometry groups: 0=side, 1=top cap (heads), 2=bottom cap (tails)
  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0x5a4a1e,
    metalness: 0.85,
    roughness: 0.35,
  });

  const headsMat = new THREE.MeshStandardMaterial({
    map: headsTex,
    alphaMap: holeAlpha,
    transparent: true,
    alphaTest: 0.5,
    metalness: 0.3,
    roughness: 0.55,
    side: THREE.DoubleSide,
  });

  const tailsMat = new THREE.MeshStandardMaterial({
    map: tailsTex,
    alphaMap: holeAlpha,
    transparent: true,
    alphaTest: 0.5,
    metalness: 0.3,
    roughness: 0.6,
    side: THREE.DoubleSide,
  });

  const materials = [edgeMat, headsMat, tailsMat];

  const coins = [];

  for (let i = 0; i < 3; i++) {
    const geom = new THREE.CylinderGeometry(
      COIN_RADIUS, COIN_RADIUS, COIN_THICKNESS, COIN_SEGMENTS
    );
    const mesh = new THREE.Mesh(geom, materials);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const shape = new CANNON.Cylinder(COIN_RADIUS, COIN_RADIUS, PHYS_HEIGHT, 12);
    const body = new CANNON.Body({
      mass: 0.08,
      material: coinPhysMaterial,
      linearDamping: 0.5,
      angularDamping: 0.6,
    });
    body.addShape(shape);
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.1;
    body.sleepTimeLimit = 0.3;
    world.addBody(body);

    coins.push({ mesh, body });
  }

  resetCoins(coins);
  return coins;
}

export function resetCoins(coins) {
  const positions = [[-0.7, 0.15, 0], [0, 0.15, 0], [0.7, 0.15, 0]];
  coins.forEach(({ mesh, body }, i) => {
    const [x, y, z] = positions[i];
    body.position.set(x, y, z);
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    body.quaternion.set(0, 0, 0, 1);
    body.wakeUp();
    mesh.position.set(x, y, z);
    mesh.quaternion.set(0, 0, 0, 1);
  });
}

export function syncMeshesToBodies(coins) {
  coins.forEach(({ mesh, body }) => {
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
  });
}

export function isHeadsUp(body) {
  const localUp = new CANNON.Vec3(0, 1, 0);
  const worldUp = new CANNON.Vec3();
  body.quaternion.vmult(localUp, worldUp);
  return worldUp.y > 0;
}
