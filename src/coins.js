import * as THREE from 'three';
import { COIN_RADIUS, COIN_THICKNESS } from './physics-core.js';
// 미리 구운 텍스처(scripts/bake-assets.py): 바탕을 어둡게 채우고 네모 구멍만 투명
import frontUrl from './assets/coin-front.webp';
import backUrl from './assets/coin-back.webp';

/**
 * 開元通寶 동전 메시 3개. 물리 몸체는 stage.js 가 Rapier 로 만든다.
 */
export async function createCoinMeshes(scene, anisotropy = 4) {
  const loader = new THREE.TextureLoader();
  const [front, back] = await Promise.all([frontUrl, backUrl].map((u) => loader.loadAsync(u)));
  [front, back].forEach((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
  });

  // CylinderGeometry 그룹: 0=옆면, 1=윗면(앞면 開元通寶), 2=아랫면(뒷면)
  const edge = new THREE.MeshStandardMaterial({ color: 0x6a4e26, metalness: 0.9, roughness: 0.38, envMapIntensity: 1 });
  // 사진의 푸른 녹을 살리되 청동빛이 돌도록 살짝 따뜻하게 곱한다
  const face = (map, rough) => new THREE.MeshStandardMaterial({
    map, color: 0xe6cfae, alphaTest: 0.5, metalness: 0.55, roughness: rough, envMapIntensity: 0.9,
  });
  const materials = [edge, face(front, 0.5), face(back, 0.55)];
  const geom = new THREE.CylinderGeometry(COIN_RADIUS, COIN_RADIUS, COIN_THICKNESS, 48);

  const meshes = [];
  for (let i = 0; i < 3; i++) {
    const mesh = new THREE.Mesh(geom, materials);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}
