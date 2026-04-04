import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createWoodTexture } from './textures.js';

/**
 * Three.js 씬 전체 구성: renderer, scene, camera, lights, table
 */
export function createScene(canvas) {
  // --- Renderer ---
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // --- Scene ---
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0808);
  scene.fog = new THREE.FogExp2(0x0a0808, 0.04);

  // --- Camera ---
  const isMobile = window.innerWidth < 769;
  const camera = new THREE.PerspectiveCamera(
    isMobile ? 50 : 42,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  // 모바일: 더 위에서 내려다보기 (3D 동전이 잘 보이도록)
  camera.position.set(0, isMobile ? 8 : 7, isMobile ? 4.5 : 5.5);
  camera.lookAt(0, 0, 0);

  // --- OrbitControls ---
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxPolarAngle = Math.PI / 2.15;
  controls.minPolarAngle = Math.PI / 8;
  controls.minDistance = 3;
  controls.maxDistance = 12;
  controls.target.set(0, 0, 0);
  controls.enablePan = false;

  // --- Lights ---
  // 1) 앰비언트 (따뜻한 분위기)
  const ambient = new THREE.AmbientLight(0xffeedd, 1.0);
  scene.add(ambient);

  // 2) 디렉셔널 (메인 조명, 그림자)
  const dirLight = new THREE.DirectionalLight(0xffeedd, 1.8);
  dirLight.position.set(3, 8, 4);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 20;
  dirLight.shadow.camera.left = -5;
  dirLight.shadow.camera.right = 5;
  dirLight.shadow.camera.top = 5;
  dirLight.shadow.camera.bottom = -5;
  dirLight.shadow.radius = 4;
  dirLight.shadow.bias = -0.0005;
  scene.add(dirLight);

  // 3) 포인트 라이트 (등잔불 느낌)
  const warmLight = new THREE.PointLight(0xffaa66, 1.2, 18);
  warmLight.position.set(-1, 4, -1);
  scene.add(warmLight);

  // 4) 림 라이트 (뒤에서 오는 보조광)
  const rimLight = new THREE.DirectionalLight(0x6677aa, 0.4);
  rimLight.position.set(-3, 3, -5);
  scene.add(rimLight);

  // --- Table ---
  const woodTex = createWoodTexture();
  const tableMat = new THREE.MeshStandardMaterial({
    map: woodTex,
    roughness: 0.7,
    metalness: 0.05,
    color: 0x3d2b1f,
  });

  const tableGeom = new THREE.BoxGeometry(8, 0.3, 8);
  const table = new THREE.Mesh(tableGeom, tableMat);
  table.position.y = -0.15;
  table.receiveShadow = true;
  scene.add(table);

  // 테이블 가장자리 장식선
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0x1a0e06,
    roughness: 0.8,
    metalness: 0.1,
  });
  const edgeThickness = 0.08;
  const edgeHeight = 0.1;
  const half = 4;
  const edgePositions = [
    { size: [half * 2 + edgeThickness, edgeHeight, edgeThickness], pos: [0, edgeHeight / 2 - 0.02, -half] },
    { size: [half * 2 + edgeThickness, edgeHeight, edgeThickness], pos: [0, edgeHeight / 2 - 0.02, half] },
    { size: [edgeThickness, edgeHeight, half * 2], pos: [-half, edgeHeight / 2 - 0.02, 0] },
    { size: [edgeThickness, edgeHeight, half * 2], pos: [half, edgeHeight / 2 - 0.02, 0] },
  ];
  edgePositions.forEach(({ size, pos }) => {
    const geom = new THREE.BoxGeometry(...size);
    const mesh = new THREE.Mesh(geom, rimMat);
    mesh.position.set(...pos);
    mesh.receiveShadow = true;
    scene.add(mesh);
  });

  // --- Resize ---
  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  return { renderer, scene, camera, controls };
}
