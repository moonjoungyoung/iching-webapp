import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
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
 * 화면 비율에 맞춰 카메라 거리·시야를 정한다.
 * 세로 화면은 하단 조작부가 크므로 판을 화면 위쪽으로 조금 올린다.
 */
export function computeView(w, h) {
  const aspect = w / h;
  const portrait = aspect < 1;
  const fov = portrait ? 44 : 36;
  const halfFov = THREE.MathUtils.degToRad(fov / 2);
  const needHalfW = portrait ? 2.62 : 3.2;
  const needHalfH = portrait ? 3.4 : 3.75;
  const dW = needHalfW / (Math.tan(halfFov) * aspect);
  const dH = needHalfH / Math.tan(halfFov);
  const dist = Math.max(dW, dH);
  const polar = portrait ? 0.5 : 0.62; // 수직에서 기운 각(라디안)
  return { fov, dist, polar, shiftY: portrait ? 0.075 : 0.1 };
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
  scene.fog = new THREE.FogExp2(0x120d0a, 0.045);

  // 은은한 실내 반사(동전·옻칠 광택용). 한 번 만들고 원본 장면은 버린다.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment(renderer);
  const envTex = pmrem.fromScene(room, 0.04).texture;
  scene.environment = envTex;
  room.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  pmrem.dispose();

  // --- 카메라 ---
  const view = computeView(window.innerWidth, window.innerHeight);
  const camera = new THREE.PerspectiveCamera(view.fov, window.innerWidth / window.innerHeight, 0.1, 80);
  const target = new THREE.Vector3(0, 0, 0);
  const placeCamera = (v, polar = v.polar, dist = v.dist) => {
    camera.position.set(0, Math.cos(polar) * dist, Math.sin(polar) * dist).add(target);
    camera.lookAt(target);
  };
  placeCamera(view);
  const applyShift = (w, h, v) => camera.setViewOffset(w, h, 0, Math.round(h * v.shiftY), w, h);
  applyShift(window.innerWidth, window.innerHeight, view);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = 1.05;
  controls.minDistance = view.dist * 0.65;
  controls.maxDistance = view.dist * 1.3;
  controls.rotateSpeed = 0.6;

  // --- 빛: 왼쪽 위 등잔 같은 주광 + 뒤쪽 낮은 따뜻한 역광 + 아주 옅은 하늘빛 ---
  scene.add(new THREE.HemisphereLight(0x8e8070, 0x0b0705, 0.5));

  const key = new THREE.DirectionalLight(0xffe2bb, 2.3);
  key.position.set(-3.6, 9, 4.2);
  key.castShadow = true;
  key.shadow.mapSize.set(quality.shadow, quality.shadow);
  const sc = key.shadow.camera;
  sc.near = 2; sc.far = 20; sc.left = -3.4; sc.right = 3.4; sc.top = 3.4; sc.bottom = -3.4;
  key.shadow.radius = 5;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const rim = new THREE.PointLight(0xffb36b, 16, 14, 2);
  rim.position.set(3.4, 2.2, -3.2);
  scene.add(rim);

  // --- 점판(둥근 칠기 쟁반): 물리 단면(PHYS.tray)과 같은 모양 ---
  const T = PHYS.tray;
  const rimY = (T.bevelOuter - T.flatRadius) * Math.tan(T.bevelAngle);
  const floorTex = createTrayFloorTexture(quality.floorTex);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(T.flatRadius + 0.02, 96),
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
    [T.wallRadius + 0.04, rimY - 0.06], [T.wallRadius + 0.07, -0.62],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const tray = new THREE.Mesh(new THREE.LatheGeometry(profile, 160), lacquer);
  tray.castShadow = true;
  tray.receiveShadow = true;
  scene.add(tray);

  // 턱과 운두가 만나는 금선 한 줄
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a65e, metalness: 1, roughness: 0.32, envMapIntensity: 1.1 });
  const goldLine = new THREE.Mesh(new THREE.TorusGeometry(T.bevelOuter, 0.009, 6, 192), gold);
  goldLine.rotation.x = Math.PI / 2;
  goldLine.position.y = rimY + 0.002;
  scene.add(goldLine);

  // --- 탁자 ---
  const table = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ map: createTableTexture(), roughness: 0.82, metalness: 0, envMapIntensity: 0.25 }),
  );
  table.rotation.x = -Math.PI / 2;
  table.position.y = -0.62;
  table.receiveShadow = true;
  scene.add(table);

  /** 화면 크기 변경: 사용자가 돌려 놓은 방위·목표점은 두고 시야·거리만 새 비율에 맞춘다 */
  function resize(prevView) {
    const w = window.innerWidth, h = window.innerHeight;
    const v = computeView(w, h);
    if (prevView) {
      const offset = camera.position.clone().sub(controls.target).multiplyScalar(v.dist / prevView.dist);
      camera.position.copy(controls.target).add(offset);
    }
    camera.aspect = w / h;
    camera.fov = v.fov;
    controls.minDistance = v.dist * 0.65;
    controls.maxDistance = v.dist * 1.3;
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

  return { renderer, scene, camera, controls, quality, view, placeCamera, resize, lowerQuality, target };
}
