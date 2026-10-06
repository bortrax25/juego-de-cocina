import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Todo Three.js (incluidos los addons de examples/jsm) debe resolver al build WebGPU
// para no duplicar clases entre "three" y "three/webgpu".
const threeWebGPU = fileURLToPath(new URL('./node_modules/three/build/three.webgpu.js', import.meta.url));

export default defineConfig({
  base: './',
  resolve: {
    alias: [{ find: /^three$/, replacement: threeWebGPU }],
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
});
