import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  // Rapier(@dimforge/rapier3d)의 .wasm 을 별도 파일로 내보내고 ESM 으로 불러온다.
  // 생성 코드가 top-level await 를 쓰므로 빌드 대상은 es2022(iOS Safari 15+, Chrome 89+).
  plugins: [wasm()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    open: true,
  },
  worker: { plugins: () => [wasm()] },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/@dimforge')) return 'rapier';
          return undefined;
        },
      },
    },
  },
  optimizeDeps: {
    // 개발 서버에서 wasm 패키지를 미리 묶지 않는다(플러그인이 직접 처리)
    exclude: ['@dimforge/rapier3d'],
  },
});
