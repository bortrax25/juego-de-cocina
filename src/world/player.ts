import * as THREE from 'three/webgpu';
import type { Engine } from '../core/engine';
import type { Input } from '../core/input';
import { Cook } from './cook';
import type { Kitchen, Station } from './kitchen';
import { NavGrid, kitchenColliders, kitchenOccluders, pushOut, type Rect } from './nav';

export const PLAYER_RADIUS = 0.28;
const WALK = 2.2;
const RUN = 3.4;
const AUTO = 2.35; // velocidad de crucero al caminar solo hacia una estación
const ACCEL = 11; // m/s²
const DECEL = 14;
const ARRIVE_DECEL = 3.4; // frenada suave al llegar
const CARROT = 0.55; // distancia de la "zanahoria" sobre el camino
const NPC_R = 0.24;
const STRIDE = 0.72; // metros por paso (para el callback de pasos)

/** Punto donde se para el jugador para trabajar en una estación (mirando al punto de trabajo). */
export function standPoint(st: Station): { x: number; z: number; ry: number } {
  let nx = st.eye.x, nz = st.eye.z;
  const l = Math.hypot(nx, nz);
  if (l < 1e-6) (nx = 0), (nz = 1);
  else (nx /= l), (nz /= l);
  const x = st.work.x + nx * 0.6, z = st.work.z + nz * 0.6;
  return { x, z, ry: Math.atan2(st.work.x - x, st.work.z - z) };
}

interface Walk {
  path: THREE.Vector2[];
  idx: number;
  ry: number | undefined;
  resolve: (ok: boolean) => void;
  arrived: boolean;
  settle: number;
  checkT: number;
  checkD: number;
  stuck: number;
  gx: number;
  gz: number;
}

/**
 * El cocinero que controla el jugador: aceleración/frenado, giro suave, choque con deslizamiento
 * contra los muebles y caminata automática por la grilla de navegación.
 */
export class Player {
  root = new THREE.Group();
  cook: Cook;
  enabled = true;
  /** Ocultar el cuerpo cuando la cámara se mete en la cabeza (vista POV de minijuego). */
  autoHide = true;
  /** Callback opcional en cada paso (pie 0/1, velocidad en m/s). */
  onStep: ((foot: 0 | 1, speed: number) => void) | null = null;
  readonly nav: NavGrid;
  private colliders: Rect[];
  private pos = new THREE.Vector2();
  private vel = new THREE.Vector2();
  private facing = 0;
  private faceGoal: number | null = null;
  private walk: Walk | null = null;
  private t = 0;
  private stepPhase = 0;
  private lean = 0;
  private bank = 0;
  private lastFacing = 0;
  private tmp = new THREE.Vector2();
  private des = new THREE.Vector2();
  private v3 = new THREE.Vector3();

  constructor(private eng: Engine, private kitchen: Kitchen, private input: Input) {
    this.cook = new Cook({ hair: '#24170f', skin: '#e9b896' });
    this.root.add(this.cook.root);
    this.root.name = 'player';
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    eng.scene.add(this.root);
    this.colliders = kitchenColliders(kitchen);
    this.nav = new NavGrid(this.colliders, PLAYER_RADIUS);
    if (!eng.camOccluders.length) eng.camOccluders = kitchenOccluders(kitchen);
    this.teleport(0, 2.2, Math.PI);
  }

  get position() {
    return this.root.position;
  }

  get moving() {
    return this.vel.length() > 0.1 || (!!this.walk && !this.walk.arrived);
  }

  /** ¿Está caminando solo hacia un destino? */
  get autoWalking() {
    return !!this.walk;
  }

  teleport(x: number, z: number, ry: number) {
    this.cancelWalk();
    const p = { x, z };
    pushOut(p, PLAYER_RADIUS, this.colliders);
    this.pos.set(p.x, p.z);
    this.vel.set(0, 0);
    this.facing = this.lastFacing = ry;
    this.faceGoal = ry;
    this.lean = this.bank = 0;
    this.sync();
    this.eng.snapFollow();
  }

  /** Camina solo (A*) hasta (x,z). true al llegar, false si se cancela o no hay camino. */
  walkTo(x: number, z: number, ry?: number): Promise<boolean> {
    this.cancelWalk();
    const g = { x, z };
    pushOut(g, PLAYER_RADIUS, this.colliders); // destino alcanzable más cercano
    const path = this.nav.findPath(this.pos.x, this.pos.y, g.x, g.z, this.npcRects(g.x, g.z));
    if (!path) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const d = Math.hypot(g.x - this.pos.x, g.z - this.pos.y);
      this.walk = { path, idx: 1, ry, resolve, arrived: d < 0.05, settle: 0, checkT: 0, checkD: Infinity, stuck: 0, gx: g.x, gz: g.z };
      this.faceGoal = null;
      if (this.walk.arrived) this.faceGoal = ry ?? null;
    });
  }

  cancelWalk() {
    const w = this.walk;
    if (!w) return;
    this.walk = null;
    w.resolve(false);
  }

  faceTo(x: number, z: number) {
    this.faceGoal = Math.atan2(x - this.pos.x, z - this.pos.y);
  }

  update(dt: number) {
    if (dt <= 0) return;
    this.t += dt;
    const des = this.des.set(0, 0);
    const mv = this.input.move;
    const manual = this.enabled && mv.lengthSq() > 0.0004;
    if (manual && this.walk && mv.length() > 0.15) this.cancelWalk();

    if (this.walk) this.followPath(dt, des);
    else if (manual) {
      // relativo a la cámara: adelante = hacia donde mira la cámara en el piso
      const yaw = this.eng.followYaw;
      const s = Math.sin(yaw), c = Math.cos(yaw);
      const fx = -s, fz = -c, rx = c, rz = -s;
      des.set(rx * mv.x + fx * mv.y, rz * mv.x + fz * mv.y);
      const k = Math.min(1, des.length());
      if (k > 0) des.multiplyScalar(((this.input.running ? RUN : WALK) * k) / des.length());
      this.faceGoal = null;
    }

    // aceleración / frenado (más fuerte al invertir el sentido)
    const dv = this.tmp.subVectors(des, this.vel);
    const speeding = des.lengthSq() > this.vel.lengthSq() && des.dot(this.vel) >= 0;
    const a = speeding ? ACCEL : DECEL * (des.dot(this.vel) < 0 ? 1.25 : 1);
    const max = a * dt;
    if (dv.length() > max) dv.setLength(max);
    this.vel.add(dv);
    if (des.lengthSq() === 0 && this.vel.lengthSq() < 0.0004) this.vel.set(0, 0);

    this.integrate(dt);

    // giro suave hacia la dirección de marcha (o hacia el objetivo al quedarse quieto)
    const speed = this.vel.length();
    let target = this.facing;
    if (this.faceGoal !== null && speed < 0.6) target = this.faceGoal;
    else if (speed > 0.08) target = Math.atan2(this.vel.x, this.vel.y);
    const turnK = 1 - Math.exp(-dt * (speed > 0.3 ? 13 : 9));
    this.facing += shortAngle(this.facing, target) * turnK;
    const turnRate = shortAngle(this.lastFacing, this.facing) / dt;
    this.lastFacing = this.facing;

    // inclinación hacia adelante con la velocidad/aceleración y "peralte" en las curvas
    const fwdAcc = (dv.x * Math.sin(this.facing) + dv.y * Math.cos(this.facing)) / dt;
    const leanT = THREE.MathUtils.clamp(speed * 0.022 + fwdAcc * 0.006, -0.06, 0.12);
    this.lean += (leanT - this.lean) * (1 - Math.exp(-dt * 8));
    const bankT = THREE.MathUtils.clamp(-turnRate * speed * 0.012, -0.09, 0.09);
    this.bank += (bankT - this.bank) * (1 - Math.exp(-dt * 8));

    // pasos
    if (speed > 0.15) {
      const prev = Math.floor(this.stepPhase);
      this.stepPhase += (speed * dt) / STRIDE;
      const now = Math.floor(this.stepPhase);
      if (now !== prev) this.onStep?.((now & 1) as 0 | 1, speed);
    }

    this.cook.walking = speed > 0.12;
    (this.cook as unknown as { speed: number }).speed = speed;
    this.sync();
    this.cook.update(dt, this.t);
    this.updateVisibility();
  }

  /**
   * En las vistas fijas (POV de minijuego) el cuerpo del jugador quedaría delante de la cámara:
   * lo ocultamos si la cámara está casi dentro de él o si tapa la línea de visión.
   */
  private updateVisibility() {
    let hide = false;
    if (this.autoHide) {
      const cam = this.eng.camera;
      const c = cam.position;
      const y = Math.max(0, Math.min(1.8, c.y));
      const d = Math.hypot(c.x - this.pos.x, c.y - y, c.z - this.pos.y);
      hide = d < (this.root.visible ? 0.62 : 0.8);
      if (!hide && this.eng.mode === 'locked') {
        const f = cam.getWorldDirection(this.v3);
        for (const py of [0.9, 1.3, 1.65]) {
          const px = this.pos.x - c.x, pyy = py - c.y, pz = this.pos.y - c.z;
          const t = px * f.x + pyy * f.y + pz * f.z;
          if (t <= 0 || t > 2.4) continue;
          const perp = Math.hypot(px - f.x * t, pyy - f.y * t, pz - f.z * t);
          if (perp < 0.3 + t * 0.12) {
            hide = true;
            break;
          }
        }
      }
    }
    this.root.visible = !hide;
  }

  private sync() {
    this.root.position.set(this.pos.x, 0, this.pos.y);
    this.root.rotation.y = this.facing;
    this.cook.root.rotation.set(this.lean, 0, this.bank);
  }

  /** Movimiento en sub-pasos con choque círculo-vs-AABB y deslizamiento. */
  private integrate(dt: number) {
    const len = this.vel.length() * dt;
    if (len === 0) return;
    const n = Math.max(1, Math.ceil(len / 0.07));
    const sx = (this.vel.x * dt) / n, sz = (this.vel.y * dt) / n;
    const p = { x: this.pos.x, z: this.pos.y };
    const nrm = { x: 0, z: 0 };
    for (let i = 0; i < n; i++) {
      p.x += sx;
      p.z += sz;
      pushOut(p, PLAYER_RADIUS, this.colliders, nrm);
      this.pushNpcs(p, nrm);
    }
    this.pos.set(p.x, p.z);
    // quitamos la componente de la velocidad que empuja contra la pared: así se desliza
    const nl = Math.hypot(nrm.x, nrm.z);
    if (nl > 1e-6) {
      const nx = nrm.x / nl, nz = nrm.z / nl;
      const vn = this.vel.x * nx + this.vel.y * nz;
      if (vn < 0) {
        this.vel.x -= nx * vn;
        this.vel.y -= nz * vn;
      }
    }
  }

  /** Cocineros como obstáculos para planificar (menos los que están sobre el destino). */
  private npcRects(gx: number, gz: number): Rect[] {
    const out: Rect[] = [];
    const clear = NPC_R + PLAYER_RADIUS + 0.05;
    for (const c of this.kitchen.cooks) {
      const q = c.root.position;
      if (Math.hypot(q.x - gx, q.z - gz) < clear) continue;
      out.push({ minX: q.x - NPC_R, maxX: q.x + NPC_R, minZ: q.z - NPC_R, maxZ: q.z + NPC_R });
    }
    return out;
  }

  private pushNpcs(p: { x: number; z: number }, nrm: { x: number; z: number }) {
    const rr = NPC_R + PLAYER_RADIUS;
    for (const c of this.kitchen.cooks) {
      const q = c.root.position;
      const dx = p.x - q.x, dz = p.z - q.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      p.x += (dx / d) * (rr - d);
      p.z += (dz / d) * (rr - d);
      nrm.x += dx / d;
      nrm.z += dz / d;
    }
    // que el empujón de un NPC nunca nos meta en un mueble
    pushOut(p, PLAYER_RADIUS, this.colliders);
  }

  /** Seguimiento de camino con "zanahoria": esquinas redondeadas y frenada al final. */
  private followPath(dt: number, des: THREE.Vector2) {
    const w = this.walk!;
    const P = w.path;
    const last = P.length - 1;
    if (w.arrived) {
      if (w.ry !== undefined) this.faceGoal = w.ry;
      w.settle += dt;
      const turned = w.ry === undefined || Math.abs(shortAngle(this.facing, w.ry)) < 0.12;
      if ((this.vel.length() < 0.05 && turned) || w.settle > 0.9) {
        this.walk = null;
        w.resolve(true);
      }
      return;
    }
    // avanzar de segmento cuando pasamos el waypoint
    while (w.idx < last) {
      const a = P[w.idx - 1], b = P[w.idx];
      const abx = b.x - a.x, abz = b.y - a.y;
      const L2 = abx * abx + abz * abz;
      const t = L2 > 0 ? ((this.pos.x - a.x) * abx + (this.pos.y - a.y) * abz) / L2 : 1;
      if (t >= 1 || this.pos.distanceTo(b) < 0.22) w.idx++;
      else break;
    }
    // distancia que falta
    let rem = this.pos.distanceTo(P[w.idx]);
    for (let i = w.idx; i < last; i++) rem += P[i].distanceTo(P[i + 1]);
    if (rem < 0.035) {
      w.arrived = true;
      return;
    }
    // zanahoria: punto CARROT metros adelante sobre el camino
    let left = CARROT;
    let cx = P[w.idx].x, cz = P[w.idx].y;
    const d0 = this.pos.distanceTo(P[w.idx]);
    if (d0 > left) {
      cx = this.pos.x + ((cx - this.pos.x) / d0) * left;
      cz = this.pos.y + ((cz - this.pos.y) / d0) * left;
    } else {
      left -= d0;
      for (let i = w.idx; i < last && left > 0; i++) {
        const sl = P[i].distanceTo(P[i + 1]);
        const k = Math.min(1, left / sl);
        cx = P[i].x + (P[i + 1].x - P[i].x) * k;
        cz = P[i].y + (P[i + 1].y - P[i].y) * k;
        left -= sl;
      }
    }
    let dx = cx - this.pos.x, dz = cz - this.pos.y;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    // esquivar a los cocineros que están en el camino
    for (const c of this.kitchen.cooks) {
      const ox = c.root.position.x - this.pos.x, oz = c.root.position.z - this.pos.y;
      const od = Math.hypot(ox, oz);
      if (od > 1.2 || od < 1e-4 || ox * dx + oz * dz <= 0 || od > rem + 0.3) continue;
      // perpendicular (dz,-dx) alejándose del obstáculo
      const side = ox * dz - oz * dx > 0 ? -1 : 1;
      const k = ((1.2 - od) / 1.2) * 0.9;
      const px = dz * side, pz = -dx * side;
      dx += px * k;
      dz += pz * k;
      const nl = Math.hypot(dx, dz) || 1;
      dx /= nl;
      dz /= nl;
    }
    const v = Math.max(0.28, Math.min(AUTO, Math.sqrt(2 * ARRIVE_DECEL * rem)));
    des.set(dx * v, dz * v);

    // atasco: si no avanzamos, recalculamos; si sigue, nos damos por llegados (cerca) o abortamos
    w.checkT += dt;
    if (w.checkT > 0.5) {
      if (rem > w.checkD - 0.06) {
        w.stuck++;
        if (w.stuck >= 3) {
          if (rem < 0.7) w.arrived = true;
          else {
            this.walk = null;
            w.resolve(false);
          }
          return;
        }
        const np = this.nav.findPath(this.pos.x, this.pos.y, w.gx, w.gz, this.npcRects(w.gx, w.gz));
        if (np) {
          w.path = np;
          w.idx = 1;
        }
      } else w.stuck = 0;
      w.checkT = 0;
      w.checkD = rem;
    }
  }
}

function shortAngle(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
