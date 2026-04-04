import * as CANNON from 'cannon-es';

export const GRAVITY = -30;

// 재질 정의
export const coinPhysMaterial = new CANNON.Material('coin');
export const groundPhysMaterial = new CANNON.Material('ground');

/**
 * Cannon-es 물리 월드 생성
 */
export function createWorld() {
  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, GRAVITY, 0),
    allowSleep: true,
  });

  world.broadphase = new CANNON.SAPBroadphase(world);
  world.solver.iterations = 10;
  world.solver.tolerance = 0.0001;

  // 접촉 재질: 동전 ↔ 바닥
  world.addContactMaterial(new CANNON.ContactMaterial(coinPhysMaterial, groundPhysMaterial, {
    friction: 0.4,
    restitution: 0.3,
  }));

  // 접촉 재질: 동전 ↔ 동전
  world.addContactMaterial(new CANNON.ContactMaterial(coinPhysMaterial, coinPhysMaterial, {
    friction: 0.2,
    restitution: 0.35,
  }));

  // 바닥 평면 (Y=0, 위를 향함)
  const groundBody = new CANNON.Body({
    mass: 0,
    material: groundPhysMaterial,
    shape: new CANNON.Plane(),
  });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(groundBody);

  // 보이지 않는 벽 4개 (동전이 테이블 밖으로 나가지 않도록)
  const wallSize = 2;
  const wallPositions = [
    { pos: [0, 1, -wallSize], rot: [0, 0, 0] },
    { pos: [0, 1, wallSize], rot: [0, Math.PI, 0] },
    { pos: [-wallSize, 1, 0], rot: [0, Math.PI / 2, 0] },
    { pos: [wallSize, 1, 0], rot: [0, -Math.PI / 2, 0] },
  ];
  wallPositions.forEach(({ pos, rot }) => {
    const wall = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    wall.position.set(...pos);
    wall.quaternion.setFromEuler(...rot);
    world.addBody(wall);
  });

  return world;
}
