import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import type { Engine } from '../core/engine';

export type Quality = 'high' | 'low';

/** Lo que el motor expone para post-proceso (lo agrega el agente PLAYER en engine.ts). */
type EngineWithOverride = Engine & { renderOverride?: (() => void) | null };

export interface RenderSetup {
  quality: Quality;
  key: THREE.DirectionalLight | null;
  bloom: boolean;
}

/** Calidad automática: baja en táctil / pantallas chicas / WebGL2. Forzable con ?hq o ?lq. */
export function pickQuality(eng: Engine): Quality {
  const q = new URLSearchParams(location.search);
  if (q.has('hq')) return 'high';
  if (q.has('lq')) return 'low';
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  if (coarse || small || eng.backendName !== 'WebGPU') return 'low';
  return 'high';
}

/**
 * Configura el look final: sombras suaves de una luz principal que sigue a la cámara,
 * tone mapping neutro y brillante, y bloom sutil (sólo en calidad alta).
 */
export function setupRendering(eng: Engine, force?: Quality): RenderSetup {
  const quality = force ?? pickQuality(eng);
  const r = eng.renderer;
  const scene = eng.scene;
  const high = quality === 'high';

  // Tone mapping: Neutral conserva los blancos limpios del azulejo y los colores de la comida.
  r.toneMapping = THREE.NeutralToneMapping;
  r.toneMappingExposure = 0.95;
  r.outputColorSpace = THREE.SRGBColorSpace;

  // Sombras: PCF con radio (en WebGPURenderer PCFSoft ya no existe; el radio da el borde suave)
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap;

  let key = scene.getObjectByName('key') as THREE.DirectionalLight | undefined;
  if (!key) {
    key = new THREE.DirectionalLight('#fbfaf6', 1.9);
    key.name = 'key';
    key.position.set(-3.2, 6.5, 4.6);
    scene.add(key, key.target);
  }
  const offset = key.position.clone().sub(key.target.position).normalize().multiplyScalar(9);
  key.castShadow = true;
  const sh = key.shadow;
  const size = high ? 2048 : 1024;
  sh.mapSize.set(size, size);
  sh.radius = high ? 3.5 : 2;
  sh.bias = -0.0004;
  sh.normalBias = 0.025;
  const cam = sh.camera;
  cam.near = 1;
  cam.far = 20;
  let extent = 6;
  const setExtent = (e: number) => {
    cam.left = -e;
    cam.right = e;
    cam.top = e;
    cam.bottom = -e;
    cam.updateProjectionMatrix();
  };
  setExtent(extent);

  // La luz sigue el punto del piso al que mira la cámara; el encuadre de la sombra se ajusta
  // a la distancia (cerca = sombras nítidas en las estaciones, lejos = cubre toda la vista).
  const fwd = new THREE.Vector3(), center = new THREE.Vector3(), tmp = new THREE.Vector3();
  const lightRot = new THREE.Matrix4(), lightInv = new THREE.Matrix4();
  lightRot.lookAt(offset, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  lightInv.copy(lightRot).invert();
  eng.addUpdate(() => {
    const c = eng.camera;
    c.getWorldDirection(fwd);
    // intersección del eje de la cámara con un plano a la altura de la mesada
    const planeY = 0.6;
    let d = fwd.y < -0.05 ? (c.position.y - planeY) / -fwd.y : 4;
    d = Math.min(d, 7);
    center.copy(c.position).addScaledVector(fwd, d);
    center.x = THREE.MathUtils.clamp(center.x, -6.5, 6.5);
    center.z = THREE.MathUtils.clamp(center.z, -4.6, 4.6);
    center.y = 0;
    const want = THREE.MathUtils.clamp(d * 1.25 + 1.2, 2.6, high ? 7 : 6);
    if (Math.abs(want - extent) > 0.15) {
      extent += (want - extent) * 0.2;
      setExtent(extent);
    }
    // Ajuste al texel de la sombra (evita el "temblor" de los bordes al mover la cámara)
    const texel = (extent * 2) / size;
    tmp.copy(center).applyMatrix4(lightInv);
    tmp.x = Math.round(tmp.x / texel) * texel;
    tmp.y = Math.round(tmp.y / texel) * texel;
    tmp.applyMatrix4(lightRot);
    key!.target.position.copy(tmp);
    key!.position.copy(tmp).add(offset);
    key!.target.updateMatrixWorld();
  });

  // Si los materiales ya se compilaron sin sombras, hay que reconstruirlos.
  scene.traverse((o) => {
    const mm = (o as THREE.Mesh).material;
    if (!mm) return;
    for (const x of Array.isArray(mm) ? mm : [mm]) x.needsUpdate = true;
  });

  // Bloom sutil en calidad alta: luminarias, lámparas de calor, llamas.
  let useBloom = false;
  if (high) {
    try {
      const pipeline = new THREE.RenderPipeline(r);
      const scenePass = pass(scene, eng.camera);
      const color = scenePass.getTextureNode('output');
      const glow = bloom(color, 0.3, 0.4, 1.85);
      pipeline.outputNode = color.add(glow);
      const e = eng as EngineWithOverride;
      let failed = false;
      e.renderOverride = () => {
        if (failed) {
          r.render(scene, eng.camera);
          return;
        }
        try {
          pipeline.render();
        } catch (err) {
          // Si el post-proceso falla (p. ej. en el fallback WebGL2), seguimos sin bloom.
          console.warn('Bloom desactivado', err);
          failed = true;
          e.renderOverride = null;
          r.render(scene, eng.camera);
        }
      };
      useBloom = true;
    } catch (err) {
      console.warn('Post-proceso no disponible', err);
    }
  }

  return { quality, key, bloom: useBloom };
}
