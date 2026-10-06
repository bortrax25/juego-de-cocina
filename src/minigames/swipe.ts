import * as THREE from 'three/webgpu';
import { Minigame, type MGContext } from './base';
import { langoustine, lobster, hotelPan } from '../world/props';
import { tween, ease, clamp, rand } from '../core/tween';
import { audio } from '../core/audio';

type Kind = 'langoustine' | 'lobstertail';

/**
 * Deslizar para separar: cabezas de langostino (van al fondo) y colas de langosta.
 * El trazo debe cruzar la línea punteada lo más cerca posible del punto marcado.
 */
export class SwipeGame extends Minigame {
  private kind: Kind;
  private count: number;
  private idx = 0;
  private cur: { group: THREE.Group; head: THREE.Object3D; tail: THREE.Object3D } | null = null;
  private line: THREE.Mesh;
  private dot: THREE.Mesh;
  private trail: THREE.Mesh;
  private start0: THREE.Vector3 | null = null;
  private last = new THREE.Vector3();
  private busy = true;
  private neck = new THREE.Vector3(0, 0.03, 0);
  private headPan = hotelPan(0.22, 0.16, 0.05);
  private tailPan = hotelPan(0.22, 0.16, 0.05);
  private nh = 0;
  private nt = 0;

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
    this.trail = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.004), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthTest: false }));
    this.trail.rotation.x = -Math.PI / 2;
    this.trail.renderOrder = 7;
    this.group.add(this.line, this.dot, this.trail);
    this.headPan.position.set(-0.2, 0, -0.24);
    this.tailPan.position.set(0.2, 0, -0.24);
    this.group.add(this.headPan, this.tailPan);
  }

  protected start() {
    this.ui.setInstruction(this.kind === 'langoustine' ? 'Desliza a lo largo de la línea para separar la cabeza del langostino.' : 'Desliza a lo largo de la línea para separar la cola de la langosta.');
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
    if (this.busy) return;
    this.start0 = this.pointerLocal(0.03);
    this.last.copy(this.start0);
  }

  protected onMove() {
    if (!this.start0 || this.busy) return;
    const p = this.pointerLocal(0.03);
    // ¿el trazo last->p atravesó el cuerpo (eje z = neck.z)? medimos dónde lo cruzó en x
    const a = this.last.z - this.neck.z, b = p.z - this.neck.z;
    if (a * b <= 0 && Math.abs(p.z - this.last.z) > 1e-5) {
      const t = a / (a - b);
      const x = this.last.x + (p.x - this.last.x) * t;
      if (Math.abs(x - this.neck.x) < 0.06) this.cut(x);
    }
    this.last.copy(p);
    // estela del cuchillo
    const mid = this.start0.clone().lerp(p, 0.5);
    const len = this.start0.distanceTo(p);
    this.trail.position.set(mid.x, 0.06, mid.z);
    this.trail.scale.x = len;
    this.trail.rotation.z = Math.atan2(-(p.z - this.start0.z), p.x - this.start0.x);
    (this.trail.material as THREE.MeshBasicMaterial).opacity = 0.6;
  }

  protected onUp() {
    this.start0 = null;
  }

  private async cut(x: number) {
    this.busy = true;
    this.start0 = null;
    const off = Math.abs(x - this.neck.x);
    const q = clamp(1 - off / 0.045, 0.1, 1);
    this.score(q, new THREE.Vector3(this.neck.x, 0.06, this.neck.z));
    audio.play(this.kind === 'langoustine' ? 'pluck' : 'chop');
    audio.play('scrape', 0.6);
    this.eng.shake(0.2);
    this.line.visible = this.dot.visible = false;
    this.fx.splash(this.worldOf(this.neck), '#f0805a', 5);
    const c = this.cur!;
    const h0 = c.head.position.clone(), t0 = c.tail.position.clone();
    await tween(0.18, (k) => {
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
    (this.trail.material as THREE.MeshBasicMaterial).opacity = 0;
    this.idx++;
    this.ui.setProgress(this.idx, this.count);
    if (this.idx >= this.count) this.finish();
    else this.spawn();
  }

  protected update(dt: number) {
    const m = this.trail.material as THREE.MeshBasicMaterial;
    if (!this.start0) m.opacity = Math.max(0, m.opacity - dt * 3);
    const s = 1 + Math.sin(this.elapsed * 8) * 0.15;
    this.dot.scale.setScalar(s);
  }

  protected cleanup() {
    this.ui.setInstruction('');
    this.ui.setProgress(0, 0);
  }
}
