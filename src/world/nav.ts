import * as THREE from 'three/webgpu';
import type { Kitchen } from './kitchen';

/** Huella en planta (AABB en x/z) de algo que bloquea el paso. */
export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const R = (cx: number, cz: number, w: number, d: number): Rect => ({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });

/** Límites de la sala (interior de las paredes). */
export const ROOM = { minX: -7, maxX: 7, minZ: -5, maxZ: 5 };

/**
 * Huellas de respaldo, medidas a partir de la geometría de kitchen.ts (v1), por si la cocina
 * todavía no expone `colliders`.
 */
export const FALLBACK_COLLIDERS: Rect[] = [
  // paredes (gruesas, por fuera de la sala)
  { minX: -8, maxX: 8, minZ: -6, maxZ: -5 },
  { minX: -8, maxX: 8, minZ: 5, maxZ: 6 },
  { minX: -8, maxX: -7, minZ: -6, maxZ: 6 },
  { minX: 7, maxX: 8, minZ: -6, maxZ: 6 },
  // isla de prep
  R(0, 0, 3.2, 1.0),
  // garde manger (refrigeradores bajo mostrador)
  R(-2.8, -4.6, 4.4, 0.72),
  // combis
  R(0.9, -4.5, 1.0, 0.85),
  R(2.1, -4.5, 1.0, 0.85),
  // mesa de ahumado
  R(4.6, -4.55, 2.2, 0.8),
  // bloque de estufa + freidora (pared izquierda)
  R(-6.45, -0.2, 0.95, 3.6),
  // cámara fría: puerta + carrito de entregas
  R(6.92, -1.0, 0.16, 1.8),
  R(5.7, -0.6, 0.9, 0.6),
  // almacén seco + racks apilados
  R(6.7, 2.3, 0.5, 2.6),
  R(5.9, 3.9, 0.5, 0.5),
  // lockers
  R(-6.0, 4.75, 1.6, 0.45),
  // oficina
  R(3.8, 4.6, 1.4, 0.7),
  // lavadero de vajilla
  R(1.2, 4.55, 2.2, 0.8),
];

/** Volúmenes altos que la cámara de seguimiento debe esquivar (campanas). */
export const FALLBACK_OCCLUDERS: THREE.Box3[] = [
  new THREE.Box3(new THREE.Vector3(-7, 2.15, -2.15), new THREE.Vector3(-5.4, 2.75, 1.75)),
  new THREE.Box3(new THREE.Vector3(0.2, 2.23, -4.95), new THREE.Vector3(2.8, 2.67, -3.85)),
];

export function kitchenColliders(kitchen: Kitchen): Rect[] {
  const c = (kitchen as unknown as { colliders?: Rect[] }).colliders;
  return c && c.length ? c : FALLBACK_COLLIDERS;
}

export function kitchenOccluders(kitchen: Kitchen): THREE.Box3[] {
  const c = (kitchen as unknown as { camOccluders?: THREE.Box3[] }).camOccluders;
  return c && c.length ? c : FALLBACK_OCCLUDERS;
}

/** Empuja un círculo (x,z,r) fuera de todos los rectángulos. Devuelve la normal acumulada (para deslizar). */
export function pushOut(p: { x: number; z: number }, r: number, rects: Rect[], n?: { x: number; z: number }) {
  let hit = false;
  for (let it = 0; it < 3; it++) {
    let moved = false;
    for (const b of rects) {
      const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
      let dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-6) {
        // centro dentro de la caja: salimos por el lado más cercano
        const l = p.x - b.minX, rr = b.maxX - p.x, t = p.z - b.minZ, bb = b.maxZ - p.z;
        const m = Math.min(l, rr, t, bb);
        if (m === l) (dx = -1), (dz = 0), (d = -l);
        else if (m === rr) (dx = 1), (dz = 0), (d = -rr);
        else if (m === t) (dx = 0), (dz = -1), (d = -t);
        else (dx = 0), (dz = 1), (d = -bb);
        p.x += dx * (r - d);
        p.z += dz * (r - d);
      } else {
        dx /= d;
        dz /= d;
        p.x += dx * (r - d);
        p.z += dz * (r - d);
      }
      if (n) {
        n.x += dx;
        n.z += dz;
      }
      hit = moved = true;
    }
    if (!moved) break;
  }
  return hit;
}

/** ¿El segmento a→b cruza algún rectángulo inflado en r? (prueba de slabs exacta) */
export function segmentBlocked(ax: number, az: number, bx: number, bz: number, r: number, rects: Rect[]) {
  const dx = bx - ax, dz = bz - az;
  for (const b of rects) {
    let t0 = 0, t1 = 1;
    const lo = [b.minX - r, b.minZ - r], hi = [b.maxX + r, b.maxZ + r], o = [ax, az], d = [dx, dz];
    let ok = true;
    for (let i = 0; i < 2 && ok; i++) {
      if (Math.abs(d[i]) < 1e-9) {
        if (o[i] <= lo[i] || o[i] >= hi[i]) ok = false;
      } else {
        let ta = (lo[i] - o[i]) / d[i], tb = (hi[i] - o[i]) / d[i];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 >= t1) ok = false;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** Grilla de navegación con A* (8 vecinos, sin cortar esquinas) y suavizado por "string pulling". */
export class NavGrid {
  readonly cell: number;
  readonly w: number;
  readonly h: number;
  private base: Uint8Array;
  private blocked: Uint8Array;
  private g: Float32Array;
  private from: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private run = 0;

  constructor(public rects: Rect[], public radius = 0.28, cell = 0.2, private margin = 0.04) {
    this.cell = cell;
    this.w = Math.round((ROOM.maxX - ROOM.minX) / cell);
    this.h = Math.round((ROOM.maxZ - ROOM.minZ) / cell);
    const n = this.w * this.h;
    this.base = new Uint8Array(n);
    this.blocked = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.from = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.rebuild();
  }

  /** Recalcula las celdas bloqueadas (si cambian los colliders). */
  rebuild() {
    const r = this.radius + this.margin;
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < this.w; i++) {
        const x = this.cx(i), z = this.cz(j);
        let b = 0;
        for (const q of this.rects) {
          const dx = Math.max(q.minX - x, 0, x - q.maxX), dz = Math.max(q.minZ - z, 0, z - q.maxZ);
          if (dx * dx + dz * dz < r * r) {
            b = 1;
            break;
          }
        }
        this.base[j * this.w + i] = b;
      }
    this.blocked.set(this.base);
  }

  private cx(i: number) {
    return ROOM.minX + (i + 0.5) * this.cell;
  }
  private cz(j: number) {
    return ROOM.minZ + (j + 0.5) * this.cell;
  }
  private ci(x: number) {
    return Math.max(0, Math.min(this.w - 1, Math.floor((x - ROOM.minX) / this.cell)));
  }
  private cj(z: number) {
    return Math.max(0, Math.min(this.h - 1, Math.floor((z - ROOM.minZ) / this.cell)));
  }

  isFree(x: number, z: number) {
    return !this.base[this.cj(z) * this.w + this.ci(x)];
  }

  /** Celda libre más cercana (búsqueda en anillos). */
  private nearestFree(x: number, z: number) {
    const i0 = this.ci(x), j0 = this.cj(z);
    if (!this.blocked[j0 * this.w + i0]) return j0 * this.w + i0;
    let best = -1, bd = Infinity;
    for (let rad = 1; rad < Math.max(this.w, this.h); rad++) {
      for (let j = j0 - rad; j <= j0 + rad; j++)
        for (let i = i0 - rad; i <= i0 + rad; i++) {
          if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
          if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== rad) continue;
          const k = j * this.w + i;
          if (this.blocked[k]) continue;
          const d = (this.cx(i) - x) ** 2 + (this.cz(j) - z) ** 2;
          if (d < bd) (bd = d), (best = k);
        }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** Marca obstáculos temporales (p. ej. cocineros parados) sobre la grilla estática. */
  private stamp2(dyn: Rect[]) {
    this.blocked.set(this.base);
    const r = this.radius + this.margin;
    for (const q of dyn) {
      const i0 = this.ci(q.minX - r), i1 = this.ci(q.maxX + r), j0 = this.cj(q.minZ - r), j1 = this.cj(q.maxZ + r);
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = this.cx(i), z = this.cz(j);
          const dx = Math.max(q.minX - x, 0, x - q.maxX), dz = Math.max(q.minZ - z, 0, z - q.maxZ);
          if (dx * dx + dz * dz < r * r) this.blocked[j * this.w + i] = 1;
        }
    }
  }

  /**
   * Camino de (sx,sz) a (gx,gz). El primer punto es el inicio y el último el destino (o el punto
   * libre más cercano si el destino está bloqueado). `dyn` = obstáculos temporales. null si no hay camino.
   */
  findPath(sx: number, sz: number, gx: number, gz: number, dyn: Rect[] = []): THREE.Vector2[] | null {
    const r = this.radius - 0.01;
    const rects = dyn.length ? this.rects.concat(dyn) : this.rects;
    const start = new THREE.Vector2(sx, sz), goal = new THREE.Vector2(gx, gz);
    // tramo directo: lo más común en una cocina abierta
    if (!segmentBlocked(sx, sz, gx, gz, r, rects)) return [start, goal];
    this.stamp2(dyn);
    const s = this.nearestFree(sx, sz), e = this.nearestFree(gx, gz);
    if (s < 0 || e < 0) return null;
    const cells = this.astar(s, e);
    if (!cells) return null;
    const pts = cells.map((k) => new THREE.Vector2(this.cx(k % this.w), this.cz(Math.floor(k / this.w))));
    pts[0] = start;
    pts.push(goal);
    return this.smooth(pts, r, rects);
  }

  /** String pulling: desde cada punto saltamos al más lejano visible. */
  private smooth(pts: THREE.Vector2[], r: number, rects: Rect[]) {
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && segmentBlocked(pts[i].x, pts[i].y, pts[j].x, pts[j].y, r, rects)) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  private astar(s: number, e: number): number[] | null {
    const W = this.w, H = this.h;
    const run = ++this.run;
    const ex = e % W, ez = Math.floor(e / W);
    const heur = (k: number) => {
      const dx = Math.abs((k % W) - ex), dz = Math.abs(Math.floor(k / W) - ez);
      return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };
    // montículo binario (f, celda): las entradas viejas se descartan al salir (closed)
    const hf: number[] = [], hk: number[] = [];
    const swap = (x: number, y: number) => {
      [hf[x], hf[y]] = [hf[y], hf[x]];
      [hk[x], hk[y]] = [hk[y], hk[x]];
    };
    const push = (k: number, f: number) => {
      hf.push(f);
      hk.push(k);
      let c = hf.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (hf[p] <= hf[c]) break;
        swap(p, c);
        c = p;
      }
    };
    const pop = () => {
      const top = hk[0];
      const lf = hf.pop()!, lk = hk.pop()!;
      if (hf.length) {
        hf[0] = lf;
        hk[0] = lk;
        let c = 0;
        for (;;) {
          const l = c * 2 + 1, rr = l + 1;
          let m = c;
          if (l < hf.length && hf[l] < hf[m]) m = l;
          if (rr < hf.length && hf[rr] < hf[m]) m = rr;
          if (m === c) break;
          swap(m, c);
          c = m;
        }
      }
      return top;
    };
    this.stamp[s] = run;
    this.g[s] = 0;
    this.from[s] = -1;
    push(s, heur(s));
    while (hf.length) {
      const k = pop();
      if (this.closed[k] === run) continue;
      this.closed[k] = run;
      if (k === e) {
        const path: number[] = [];
        for (let c = k; c >= 0; c = this.from[c]) path.push(c);
        return path.reverse();
      }
      const ki = k % W, kj = Math.floor(k / W);
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ki + di, nj = kj + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
          const n = nj * W + ni;
          if (this.blocked[n] || this.closed[n] === run) continue;
          // diagonal sin cortar esquinas
          if (di && dj && (this.blocked[kj * W + ni] || this.blocked[nj * W + ki])) continue;
          const g = this.g[k] + (di && dj ? Math.SQRT2 : 1);
          if (this.stamp[n] === run && g >= this.g[n]) continue;
          this.stamp[n] = run;
          this.g[n] = g;
          this.from[n] = k;
          push(n, g + heur(n));
        }
    }
    return null;
  }
}
