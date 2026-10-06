import * as THREE from 'three/webgpu';
import { Minigame, type MGContext } from './base';
import { langoustine, lobster, hotelPan, knife } from '../world/props';
import { tween, ease, clamp, rand } from '../core/tween';
import { audio } from '../core/audio';

type Kind = 'langoustine' | 'lobstertail';

const TRAIL = 18;

/**
 * Deslizar para separar: cabezas de langostino (van al fondo) y colas de langosta.
 * El trazo debe cruzar la línea punteada lo más cerca posible del punto marcado.
 * El cuchillo deja estela; un corte perfecto congela el instante (hit-stop) y separa en cámara lenta.
 */
export class SwipeGame extends Minigame {
  private kind: Kind;
  private count: number;
  private idx = 0;
  private cur: { group: THREE.Group; head: THREE.Object3D; tail: THREE.Object3D } | null = null;
  private line: THREE.Mesh;
  private dot: THREE.Mesh;
  private trail: THREE.Mesh;
  private trailPos: Float32Array;
  private pts: number[] = []; // x,z de la estela (más viejo primero)
  private trailFade = 0;
  private blade = new THREE.Group(); // pivote en la punta: la hoja va detrás del dedo, sobre la estela
  private bladeYaw = 0;
  private start0: THREE.Vector3 | null = null;
  private last = new THREE.Vector3();
  private busy = true;
  private neck = new THREE.Vector3(0, 0.03, 0);
  private headPan = hotelPan(0.22, 0.16, 0.05);
  private tailPan = hotelPan(0.22, 0.16, 0.05);
  private nh = 0;
  private nt = 0;
  private tmpMid = new THREE.Vector3();

  constructor(ctx: MGContext) {
    super(ctx);
    this.kind = this.param<Kind>('kind', 'langoustine');
    this.count = this.param('count', 6);
    this.par = this.count * 2 + 3;
    this.line = new THREE.Mesh(new THREE.PlaneGeometry(0.005, 0.14), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthTest: false }));
    this.line.rotation.x = -Math.PI / 2;
    this.line.renderOrder = 5;
    this.dot = new THREE.Mesh(new THREE.RingGeometry(0.008, 0.012, 20), new THREE.MeshBasicMaterial({ color: '#7dff9a', depthTest: false, transparent: true }));
    this.dot.rotation.x = -Math.PI / 2;
    this.dot.renderOrder = 6;
    // estela: cinta de TRAIL puntos que se afina hacia la cola (buffers fijos, sin GC)
    this.trailPos = new Float32Array(TRAIL * 2 * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < TRAIL - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    tg.setIndex(idx);
    this.trail = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: '#eaf6ff', transparent: true, opacity: 0, depthTest: false, side: THREE.DoubleSide }));
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 7;
    this.group.add(this.line, this.dot, this.trail);
    const kn = knife();
    kn.position.x = -0.245;
    this.blade.add(kn);
    this.blade.scale.setScalar(0.75);
    this.group.add(this.blade);
    this.headPan.position.set(-0.2, 0, -0.24);
    this.tailPan.position.set(0.2, 0, -0.24);
    this.group.add(this.headPan, this.tailPan);
  }

  protected start() {
    this.ui.setInstruction(this.kind === 'langoustine' ? 'Pasa el cuchillo (desliza) a través de la línea, justo por el punto verde, para separar la cabeza.' : 'Pasa el cuchillo (desliza) a través de la línea, justo por el punto verde, para separar la cola.');
    this.spawn();
  }

  private spawn() {
    if (this.kind === 'langoustine') {
      const l = langoustine();
      l.group.scale.setScalar(1.9);
      this.cur = l;
      this.neck.set(0.01, 0.03, 0);
    } else {
      const l = lobster();
      l.mat.color.set('#d8361d');
      l.group.scale.setScalar(0.95);
      const body = new THREE.Group();
      // separamos "cabeza" (cuerpo+pinzas) de la cola para animar
      const tail = l.tail;
      l.group.remove(tail);
      body.add(l.group);
      const g = new THREE.Group();
      g.add(body, tail);
      tail.scale.setScalar(0.95);
      this.cur = { group: g, head: body, tail };
      this.neck.set(0.083, 0.03, 0);
    }
    const g = this.cur.group;
    g.rotation.y = rand(-0.15, 0.15);
    g.position.set(0, 0.02, 0.3);
    this.group.add(g);
    this.neck.x += rand(-0.01, 0.01);
    this.line.position.set(this.neck.x, 0.06, this.neck.z);
    this.dot.position.set(this.neck.x, 0.061, this.neck.z);
    this.line.visible = this.dot.visible = false;
    tween(0.25, (k) => (g.position.z = 0.3 * (1 - k)), ease.outCubic).then(() => {
      this.line.visible = this.dot.visible = true;
      this.busy = false;
    });
    this.ui.setProgress(this.idx, this.count);
  }

  protected onDown() {
    this.pts.length = 0;
    if (this.busy) return;
    this.start0 = this.pointerLocal(0.03);
    this.last.copy(this.start0);
    this.pushPt(this.start0);
  }

  private pushPt(p: THREE.Vector3) {
    this.pts.push(p.x, p.z);
    if (this.pts.length > TRAIL * 2) this.pts.splice(0, 2);
    this.trailFade = 1;
  }

  /** Reconstruye la cinta de la estela: ancho máximo en la punta, cero en la cola. */
  private buildTrail() {
    const n = this.pts.length / 2;
    const P = this.trailPos;
    const W = 0.006;
    for (let i = 0; i < TRAIL; i++) {
      const j = Math.min(i, n - 1);
      if (n < 2) {
        P.fill(0);
        break;
      }
      const x = this.pts[j * 2], z = this.pts[j * 2 + 1];
      const j0 = Math.max(0, j - 1), j1 = Math.min(n - 1, j + 1);
      let dx = this.pts[j1 * 2] - this.pts[j0 * 2], dz = this.pts[j1 * 2 + 1] - this.pts[j0 * 2 + 1];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const w = (W * j) / (n - 1);
      const o = i * 6;
      P[o] = x - dz * w; P[o + 1] = 0.062; P[o + 2] = z + dx * w;
      P[o + 3] = x + dz * w; P[o + 4] = 0.062; P[o + 5] = z - dx * w;
    }
    const attr = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
  }

  protected onMove() {
    if (this.busy || !this.eng.pointerDown) return;
    const p = this.pointerLocal(0.03);
    if (!this.start0) {
      // el dedo ya estaba apoyado cuando apareció la pieza (o tras el corte anterior)
      this.start0 = p.clone();
      this.last.copy(p);
      this.pts.length = 0;
      this.pushPt(p);
      return;
    }
    this.pushPt(p);
    // ¿el trazo last->p atravesó el cuerpo (eje z = neck.z)? medimos dónde lo cruzó en x
    const a = this.last.z - this.neck.z, b = p.z - this.neck.z;
    if (a * b <= 0 && Math.abs(p.z - this.last.z) > 1e-5) {
      const t = a / (a - b);
      const x = this.last.x + (p.x - this.last.x) * t;
      if (Math.abs(x - this.neck.x) < 0.06) this.cut(x);
    }
    if (Math.abs(p.x - this.last.x) + Math.abs(p.z - this.last.z) > 0.002) this.bladeYaw = Math.atan2(-(p.z - this.last.z), p.x - this.last.x);
    this.last.copy(p);
    if (this.busy) return;
    if (Math.random() < 0.3) audio.play('whoosh', 0.15);
  }

  protected onUp() {
    this.start0 = null;
  }

  private async cut(x: number) {
    this.busy = true;
    this.start0 = null;
    const off = Math.abs(x - this.neck.x);
    const q = clamp(1 - off / 0.045, 0.1, 1);
    const perfect = q >= 0.92;
    this.score(q, new THREE.Vector3(this.neck.x, 0.06, this.neck.z));
    audio.play(this.kind === 'langoustine' ? 'pluck' : 'chop');
    audio.play('scrape', 0.6);
    this.line.visible = this.dot.visible = false;
    this.fx.splash(this.worldOf(this.neck), '#f0805a', perfect ? 10 : 5);
    if (perfect) {
      // hit-stop: el instante del corte se congela, luego separa en cámara lenta
      this.eng.shake(0.45);
      this.haptic(25);
      this.fx.sparkle(this.worldOf(this.neck), '#ffffff', 14);
      this.trailFade = 1.4;
      await this.hitStop(0.14);
    } else {
      this.eng.shake(0.2);
      this.haptic(10);
    }
    const c = this.cur!;
    const h0 = c.head.position.clone(), t0 = c.tail.position.clone();
    await tween(perfect ? 0.45 : 0.18, (k) => {
      c.head.position.x = h0.x - 0.025 * k;
      c.head.rotation.z = 0.25 * k;
      c.tail.position.x = t0.x + 0.025 * k;
    }, ease.outCubic);
    // cabezas a la izquierda (para el fondo), colas a la derecha
    const hw = new THREE.Vector3(), tw = new THREE.Vector3();
    c.head.getWorldPosition(hw);
    c.tail.getWorldPosition(tw);
    const hs = this.group.worldToLocal(hw), ts = this.group.worldToLocal(tw);
    const hd = this.headPan.position.clone().add(new THREE.Vector3(rand(-0.05, 0.05), 0.03 + this.nh * 0.003, rand(-0.03, 0.03)));
    const td = this.tailPan.position.clone().add(new THREE.Vector3(rand(-0.05, 0.05), 0.03 + this.nt * 0.003, rand(-0.03, 0.03)));
    this.group.attach(c.head);
    this.group.attach(c.tail);
    this.nh++;
    this.nt++;
    await tween(0.35, (k) => {
      c.head.position.lerpVectors(hs, hd, k);
      c.head.position.y += Math.sin(k * Math.PI) * 0.08;
      c.tail.position.lerpVectors(ts, td, k);
      c.tail.position.y += Math.sin(k * Math.PI) * 0.08;
    }, ease.inOutCubic);
    c.head.scale.multiplyScalar(0.7);
    c.tail.scale.multiplyScalar(0.7);
    this.group.remove(c.group);
    this.idx++;
    this.ui.setProgress(this.idx, this.count);
    if (this.idx >= this.count) this.finish();
    else this.spawn();
  }

  protected update(dt: number) {
    const m = this.trail.material as THREE.MeshBasicMaterial;
    // la estela se consume desde la cola cuando el cuchillo se detiene
    this.trailFade = Math.max(0, this.trailFade - dt * 2.5);
    if (!this.eng.pointerDown && this.pts.length > 0 && this.trailFade < 0.6) this.pts.splice(0, 2);
    m.opacity = Math.min(0.75, this.trailFade);
    this.buildTrail();
    // cuchillo: sigue al puntero, alineado con el movimiento
    const p = this.pointerLocal(0.06, this.tmpMid);
    const down = this.eng.pointerDown;
    this.blade.position.x += (p.x - this.blade.position.x) * Math.min(1, dt * 30);
    this.blade.position.z += (p.z - this.blade.position.z) * Math.min(1, dt * 30);
    this.blade.position.y += ((down ? 0.035 : 0.08) - this.blade.position.y) * Math.min(1, dt * 16);
    let dy = this.bladeYaw - this.blade.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.blade.rotation.y += dy * Math.min(1, dt * 14);
    this.blade.rotation.x = down ? -0.2 : -0.6;
    const s = 1 + Math.sin(this.elapsed * 8) * 0.15;
    this.dot.scale.setScalar(s);
  }

  protected cleanup() {
    this.ui.setInstruction('');
    this.ui.setProgress(0, 0);
  }
}
