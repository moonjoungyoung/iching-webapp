import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createTrayFloorTexture, createTableTexture } from './textures.js';
import { PHYS } from './physics-core.js';

/**
 * 화질 기본값. 터치 기기(폰·태블릿)는 iPhone 처럼 deviceMemory 가 없고 코어 수도 많아
 * 사양 추정이 어렵기 때문에 처음부터 한 단계 낮춰 시작한다. 실제로 느리면 stage.js 가 한 단계 더 낮춘다.
 */
export function detectQuality() {
  const cores = navigator.hardwareConcurrency || 8;
  const mem = navigator.deviceMemory || 8;
  const coarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  const low = cores <= 4 || mem <= 4;
  const reduced = low || coarse;
  return {
    low,
    coarse,
    dpr: Math.min(window.devicePixelRatio || 1, reduced ? 1.5 : 2),
    shadow: reduced ? 1024 : 2048,
    floorTex: low ? 1024 : coarse ? 1536 : 2048,
  };
}

/**
 * 화면 비율에 맞춘 카메라 구도.
 * 판 앞쪽 위의 손(그릇)에서 판 가운데로 이어지는 궤적이 한 화면에 들어오도록 앞쪽 비스듬한 위에서 본다.
 * 세로 화면에서는 동전 지름이 화면 폭의 약 14% 가 되도록 보이는 폭(halfW)을 정한다.
 */
export function computeView(w, h) {
  const aspect = w / h;
  const portrait = aspect < 1;
  const fov = portrait ? 40 : 34;
  const halfFov = THREE.MathUtils.degToRad(fov / 2);
  // 보이는 반폭·반높이(목표점 거리에서, 단위). 동전 지름 1 단위 / (2 × halfW) = 화면 폭 대비 동전 크기
  const halfW = portrait ? 3.55 : 4.6;
  const halfH = portrait ? 4.2 : 5.6;
  const dW = halfW / (Math.tan(halfFov) * aspect);
  const dH = halfH / Math.tan(halfFov);
  const dist = Math.max(dW, dH);
  // 수직에서 기운 각(라디안): 앞쪽 비스듬한 위. 가로 화면은 세로 여유가 적어 조금 더 내려다본다(던진 동전의 정점이 화면 안에)
  const polar = portrait ? 0.8 : 0.62;
  const target = portrait ? new THREE.Vector3(0, 0.9, 0.55) : new THREE.Vector3(0, 1.6, 1.4);
  return { fov, dist, polar, target, shiftY: portrait ? 0.1 : 0 };
}

export function createScene(canvas) {
  const quality = detectQuality();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(quality.dpr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x120d0a);
  scene.fog = new THREE.FogExp2(0x120d0a, 0.02);

  // 은은한 실내 반사(동전·옻칠 광택용). 한 번 만들고 원본 장면은 버린다.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment(renderer);
  const envTex = pmrem.fromScene(room, 0.04).texture;
  scene.environment = envTex;
  room.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  pmrem.dispose();

  // --- 카메라: 고정 구도(사용자가 돌리지 않음). 목표점·각·거리로만 움직인다 ---
  const view = computeView(window.innerWidth, window.innerHeight);
  const camera = new THREE.PerspectiveCamera(view.fov, window.innerWidth / window.innerHeight, 0.1, 120);
  const target = view.target.clone();
  /** 목표점(target)을 중심으로 수직에서 polar 만큼 기운 dist 거리에 둔다 */
  const placeCamera = (v, polar = v.polar, dist = v.dist, t = target) => {
    camera.position.set(0, Math.cos(polar) * dist, Math.sin(polar) * dist).add(t);
    camera.lookAt(t);
  };
  placeCamera(view);
  const applyShift = (w, h, v) => camera.setViewOffset(w, h, 0, Math.round(h * v.shiftY), w, h);
  applyShift(window.innerWidth, window.innerHeight, view);

  // --- 빛: 왼쪽 위 등잔 같은 주광 + 뒤쪽 낮은 따뜻한 역광 + 아주 옅은 하늘빛 ---
  scene.add(new THREE.HemisphereLight(0x8e8070, 0x0b0705, 0.5));

  const key = new THREE.DirectionalLight(0xffe2bb, 2.3);
  key.position.set(-4.2, 11, 5.2);
  key.castShadow = true;
  key.shadow.mapSize.set(quality.shadow, quality.shadow);
  const sc = key.shadow.camera;
  sc.near = 2; sc.far = 26; sc.left = -4.3; sc.right = 4.3; sc.top = 4.3; sc.bottom = -4.3;
  key.shadow.radius = 5;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const rim = new THREE.PointLight(0xffb36b, 22, 17, 2);
  rim.position.set(4.2, 2.6, -4);
  scene.add(rim);

  // --- 점판(둥근 칠기 쟁반): 물리 단면(PHYS.tray)과 같은 모양 ---
  const T = PHYS.tray;
  const rimY = (T.bevelOuter - T.flatRadius) * Math.tan(T.bevelAngle);
  const floorTex = createTrayFloorTexture(quality.floorTex);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(T.flatRadius + 0.02, 112),
    new THREE.MeshPhysicalMaterial({
      map: floorTex, roughness: 0.46, metalness: 0.0, clearcoat: 0.7, clearcoatRoughness: 0.24, envMapIntensity: 0.55,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.001;
  floor.receiveShadow = true;
  scene.add(floor);

  const lacquer = new THREE.MeshPhysicalMaterial({
    color: 0x1f0f0b, roughness: 0.5, clearcoat: 0.8, clearcoatRoughness: 0.28, envMapIntensity: 0.3, side: THREE.DoubleSide,
  });
  const profile = [
    [T.flatRadius, 0], [T.bevelOuter, rimY], [T.wallRadius, rimY],
    [T.wallRadius + 0.05, rimY - 0.07], [T.wallRadius + 0.09, -0.62],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const tray = new THREE.Mesh(new THREE.LatheGeometry(profile, 180), lacquer);
  tray.castShadow = true;
  tray.receiveShadow = true;
  scene.add(tray);

  // 턱과 운두가 만나는 금선 한 줄
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a65e, metalness: 1, roughness: 0.32, envMapIntensity: 1.1 });
  const goldLine = new THREE.Mesh(new THREE.TorusGeometry(T.bevelOuter, 0.011, 6, 220), gold);
  goldLine.rotation.x = Math.PI / 2;
  goldLine.position.y = rimY + 0.002;
  scene.add(goldLine);

  // --- 탁자 ---
  const table = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ map: createTableTexture(), roughness: 0.82, metalness: 0, envMapIntensity: 0.25 }),
  );
  table.rotation.x = -Math.PI / 2;
  table.position.y = -0.62;
  table.receiveShadow = true;
  scene.add(table);

  // --- 손(그릇) 암시: 먹빛이 비치는 얕은 사발 윤곽 + 판 위에 드리운 옅은 그림자 ---
  const C = PHYS.cup;
  const hand = new THREE.Group();
  const bowlGeo = new THREE.SphereGeometry(C.innerRadius + 0.18, 48, 16, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45);
  const bowl = new THREE.Mesh(bowlGeo, new THREE.MeshStandardMaterial({
    color: 0x2a1a12, roughness: 0.55, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
  }));
  bowl.position.y = C.floorY + C.innerRadius * 0.75;
  hand.add(bowl);
  const lip = new THREE.Mesh(
    new THREE.TorusGeometry(C.innerRadius + 0.12, 0.01, 6, 96),
    new THREE.MeshStandardMaterial({ color: 0xc9a65e, metalness: 1, roughness: 0.35, transparent: true, opacity: 0.32, depthWrite: false }),
  );
  lip.rotation.x = Math.PI / 2;
  lip.position.y = bowl.position.y - (C.innerRadius + 0.18) * Math.cos(Math.PI * 0.55);
  hand.add(lip);
  hand.position.set(C.base.x, C.base.y, C.base.z);
  scene.add(hand);

  const shadowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const handShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 2.6),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
  );
  handShadow.rotation.x = -Math.PI / 2;
  // 손은 판 앞 탁자 위 공중에 있으므로 그림자는 탁자 면에 드리운다
  handShadow.position.set(C.base.x, -0.6, C.base.z - 0.2);
  scene.add(handShadow);

  /** 화면 크기 변경: 시야·거리를 새 비율에 맞춘다 */
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const v = computeView(w, h);
    camera.aspect = w / h;
    camera.fov = v.fov;
    applyShift(w, h, v);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    return v;
  }

  /** 프레임이 무거우면 한 단계 더 낮춘다(해상도 1배, 그림자 512) */
  function lowerQuality() {
    renderer.setPixelRatio(1);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    key.shadow.mapSize.set(512, 512);
    if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
  }

  return { renderer, scene, camera, quality, view, placeCamera, resize, lowerQuality, target, hand, handShadow };
}
