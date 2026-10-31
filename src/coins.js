import * as THREE from 'three';
import { COIN_RADIUS, COIN_THICKNESS } from './physics-core.js';
// 미리 구운 텍스처(scripts/bake-assets.py): 색(네모 구멍만 투명) + 양각 노멀맵 + 가림·거칠기·금속성
import frontUrl from './assets/coin-front.webp';
import backUrl from './assets/coin-back.webp';
import frontNormalUrl from './assets/coin-front-normal.webp';
import backNormalUrl from './assets/coin-back-normal.webp';
import frontOrmUrl from './assets/coin-front-orm.webp';
import backOrmUrl from './assets/coin-back-orm.webp';

/**
 * 開元通寶 동전 메시 3개. 물리 몸체는 stage.js 가 Rapier 로 만든다.
 * 앞면은 밝은 청동 바탕에 글자가 금빛으로 도드라지고, 뒷면은 글자 없이 조금 더 어둡고 녹청이 돈다.
 * 테·글자 같은 도드라진 곳은 닳아 반짝이고(매끈·금속성 높음) 바탕은 녹이 낀 무광이다.
 */
export async function createCoinMeshes(scene, anisotropy = 4) {
  const loader = new THREE.TextureLoader();
  const [front, back, frontN, backN, frontOrm, backOrm] = await Promise.all(
    [frontUrl, backUrl, frontNormalUrl, backNormalUrl, frontOrmUrl, backOrmUrl].map((u) => loader.loadAsync(u)),
  );
  [front, back].forEach((t) => { t.colorSpace = THREE.SRGBColorSpace; });
  [front, back, frontN, backN, frontOrm, backOrm].forEach((t) => { t.anisotropy = anisotropy; });

  // CylinderGeometry 그룹: 0=옆면, 1=윗면(앞면 開元通寶), 2=아랫면(뒷면)
  const edge = new THREE.MeshStandardMaterial({ color: 0x6a4e26, metalness: 0.9, roughness: 0.38, envMapIntensity: 1 });
  const face = (map, normalMap, orm, normal) => new THREE.MeshStandardMaterial({
    map, normalMap, normalScale: new THREE.Vector2(normal, normal),
    // 거칠기는 G, 금속성은 B 채널에서 읽는다(값 자체는 텍스처가 정하므로 배율 1)
    roughnessMap: orm, metalnessMap: orm, aoMap: orm, roughness: 1, metalness: 1,
    alphaTest: 0.5, envMapIntensity: 1,
  });
  const materials = [edge, face(front, frontN, frontOrm, 1), face(back, backN, backOrm, 0.8)];
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
