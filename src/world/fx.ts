import * as THREE from 'three/webgpu';
import { softDot } from './textures';

interface P {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  grow: number;
  gravity: number;
  drag: number;
  color: THREE.Color;
}

export interface Emit {
  pos: THREE.Vector3;
  count?: number;
  spread?: number;
  vel?: THREE.Vector3;
  velSpread?: number;
  life?: number;
  size?: number;
  grow?: number;
  gravity?: number;
  drag?: number;
  color?: THREE.ColorRepresentation;
  colorJitter?: number;
}

/** Pool de partículas billboard instanciadas: 1 draw call por modo de mezcla, cero GC. */
class Pool {
  mesh: THREE.InstancedMesh;
  ps: P[] = [];
  private m = new THREE.Matrix4();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  constructor(max: number, private additive: boolean) {
    const mat = new THREE.MeshBasicMaterial({
      map: softDot(),
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    for (let i = 0; i < max; i++) {
      this.ps.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, max: 1, size: 0.02, grow: 0, gravity: 0, drag: 0, color: new THREE.Color() });
      this.mesh.setColorAt(i, this.c.set('#fff'));
    }
    this.mesh.renderOrder = additive ? 11 : 10;
  }

  emit(e: Emit) {
    const n = e.count ?? 1;
    for (let k = 0; k < n; k++) {
      const p = this.ps.find((q) => !q.alive);
      if (!p) return;
      const sp = e.spread ?? 0;
      p.alive = true;
      p.pos.copy(e.pos).add(this.s.set((Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp));
      const vs = e.velSpread ?? 0;
      p.vel.copy(e.vel ?? this.s.set(0, 0, 0)).add(this.s.set((Math.random() - 0.5) * vs, (Math.random() - 0.5) * vs, (Math.random() - 0.5) * vs));
      p.max = p.life = (e.life ?? 1) * (0.7 + Math.random() * 0.6);
      p.size = (e.size ?? 0.02) * (0.7 + Math.random() * 0.6);
      p.grow = e.grow ?? 0;
      p.gravity = e.gravity ?? 0;
      p.drag = e.drag ?? 0;
      p.color.set(e.color ?? '#ffffff');
      if (e.colorJitter) p.color.offsetHSL(0, 0, (Math.random() - 0.5) * e.colorJitter);
    }
  }

  update(dt: number, cam: THREE.Camera) {
    let n = 0;
    for (const p of this.ps) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(1 - p.drag * dt);
      p.pos.addScaledVector(p.vel, dt);
      const k = p.life / p.max;
      const size = p.size + p.grow * (1 - k);
      const fade = Math.min(1, k * 3);
      this.s.setScalar(size * (0.4 + 0.6 * fade));
      this.m.compose(p.pos, cam.quaternion, this.s);
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, this.additive ? this.c.copy(p.color).multiplyScalar(fade) : p.color);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class FX {
  normal = new Pool(260, false);
  glow = new Pool(200, true);
  constructor(scene: THREE.Scene) {
    scene.add(this.normal.mesh, this.glow.mesh);
  }
  emit(e: Emit) { this.normal.emit(e); }
  emitGlow(e: Emit) { this.glow.emit(e); }
  update(dt: number, cam: THREE.Camera) {
    this.normal.update(dt, cam);
    this.glow.update(dt, cam);
  }

  // Recetas de efectos comunes
  steam(pos: THREE.Vector3, n = 1) {
    this.emit({ pos, count: n, spread: 0.12, vel: new THREE.Vector3(0, 0.25, 0), velSpread: 0.08, life: 1.6, size: 0.06, grow: 0.18, color: '#f4f6f7', drag: 0.5 });
  }
  flour(pos: THREE.Vector3, n = 4) {
    this.emit({ pos, count: n, spread: 0.03, vel: new THREE.Vector3(0, 0.12, 0), velSpread: 0.2, life: 0.8, size: 0.015, grow: 0.03, gravity: 0.2, color: '#ffffff', drag: 2 });
  }
  fire(pos: THREE.Vector3, n = 3, scale = 1) {
    this.emitGlow({ pos, count: n, spread: 0.06 * scale, vel: new THREE.Vector3(0, 0.6 * scale, 0), velSpread: 0.3 * scale, life: 0.45, size: 0.09 * scale, grow: -0.05 * scale, color: '#ff7a1a', colorJitter: 0.2 });
    if (Math.random() < 0.4) this.emitGlow({ pos, count: 1, spread: 0.05, vel: new THREE.Vector3(0, 0.8, 0), velSpread: 0.4, life: 0.3, size: 0.06 * scale, color: '#ffd27a' });
  }
  bubbles(pos: THREE.Vector3, area: number, n = 2, color: THREE.ColorRepresentation = '#ffe7a8') {
    this.emit({ pos, count: n, spread: area, vel: new THREE.Vector3(0, 0.05, 0), velSpread: 0.03, life: 0.35, size: 0.012, grow: 0.01, color });
  }
  sparkle(pos: THREE.Vector3, color: THREE.ColorRepresentation = '#ffffff', n = 10) {
    this.emitGlow({ pos, count: n, spread: 0.02, vel: new THREE.Vector3(0, 0.2, 0), velSpread: 0.6, life: 0.45, size: 0.02, gravity: 0.6, color, drag: 1.5 });
  }
  splash(pos: THREE.Vector3, color: THREE.ColorRepresentation, n = 8) {
    this.emit({ pos, count: n, spread: 0.02, vel: new THREE.Vector3(0, 0.4, 0), velSpread: 0.6, life: 0.5, size: 0.012, gravity: 2.5, color });
  }
}
