import * as THREE from 'three/webgpu';
import { Minigame, type MGContext } from './base';
import { PM, knife, glovedHand, hotelPan } from '../world/props';
import { tween, ease } from '../core/tween';
import { audio } from '../core/audio';

type Item = 'carrot' | 'potato' | 'salmon' | 'whitefish' | 'swordfish';

interface Spec {
  len: number;
  round: boolean;
  radius: (u: number) => number; // u: 0 (izq) .. 1 (der)
  height: number;
  width: (u: number) => number;
  mat: () => THREE.Material;
  inner: () => THREE.Material;
  cuts: number;
  name: string;
}

const SPECS: Record<Item, Spec> = {
  carrot: { len: 0.24, round: true, radius: (u) => 0.016 + 0.01 * (1 - u), height: 0, width: () => 0, mat: () => PM.carrot, inner: () => PM.carrotCore, cuts: 9, name: 'zanahoria' },
  potato: { len: 0.15, round: true, radius: (u) => 0.03 * Math.sqrt(Math.max(0.05, 1 - Math.pow(u * 2 - 1, 2))) + 0.006, height: 0, width: () => 0, mat: () => PM.potato, inner: () => PM.potatoIn, cuts: 5, name: 'papa' },
  salmon: { len: 0.3, round: false, radius: () => 0, height: 0.03, width: (u) => 0.06 + 0.05 * Math.sin(Math.PI * (0.25 + u * 0.6)), mat: PM.salmon, inner: PM.salmon, cuts: 6, name: 'salmón' },
  whitefish: { len: 0.28, round: false, radius: () => 0, height: 0.018, width: (u) => 0.05 + 0.05 * Math.sin(Math.PI * (0.2 + u * 0.7)), mat: PM.whiteFish, inner: PM.whiteFish, cuts: 5, name: 'pescado' },
  swordfish: { len: 0.24, round: false, radius: () => 0, height: 0.07, width: () => 0.09, mat: PM.sword, inner: PM.sword, cuts: 5, name: 'pez espada' },
};

/**
 * Corte con cuchillo: el cuchillo sigue al puntero, la mano en garra protege el producto.
 * Toca/clic sobre la guía para cortar. Si cortas sobre la mano... te cortas.
 */
export class SliceGame extends Minigame {
  private spec: Spec;
  private count: number;
  private itemIdx = 0;
  private segs: THREE.Mesh[] = [];
  private bounds: number[] = []; // posiciones x de cortes (de derecha a izquierda)
  private next = 0;
  private knife = knife();
  private hand = glovedHand();
  private guide: THREE.Mesh;
  private band: THREE.Mesh;
  private chopping = false;
  private busy = false;
  private pan = hotelPan(0.3, 0.2, 0.06);
  private cutPieces: THREE.Object3D[] = [];
  private kx = 0;

  constructor(ctx: MGContext) {
    super(ctx);
    const item = this.param<Item>('item', 'carrot');
    this.spec = SPECS[item];
    this.count = this.param('count', 2);
    this.par = this.count * this.spec.cuts * 0.75 + 4;
    this.guide = new THREE.Mesh(new THREE.PlaneGeometry(0.004, 0.12), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthTest: false }));
    this.guide.rotation.x = -Math.PI / 2;
    this.guide.renderOrder = 5;
    this.band = new THREE.Mesh(new THREE.PlaneGeometry(0.016, 0.12), new THREE.MeshBasicMaterial({ color: '#66ff8a', transparent: true, opacity: 0.22, depthTest: false }));
    this.band.rotation.x = -Math.PI / 2;
    this.band.renderOrder = 4;
    this.group.add(this.guide, this.band, this.knife, this.hand);
    this.pan.position.set(0.0, -0.002, -0.33);
    this.group.add(this.pan);
    this.knife.rotation.set(0, Math.PI / 2, 0, 'YXZ'); // filo abajo, punta hacia el fondo
    this.knife.rotateX(-0.8); // inclinado hacia la cámara para ver la hoja, como en POV
    this.knife.scale.setScalar(0.9);
  }

  protected start() {
    this.ui.setInstruction(`Toca sobre la línea para cortar la ${this.spec.name}. Cuida la mano.`);
    this.spawnItem();
  }

  private spawnItem() {
    const s = this.spec;
    this.segs.forEach((m) => this.group.remove(m));
    this.segs = [];
    // Cortes: primero un despunte en la derecha, luego rodajas parejas hacia la izquierda
    const L = s.len, x0 = -L / 2, x1 = L / 2;
    const n = s.cuts;
    const trim = 0.012;
    const usable = L * 0.78;
    const step = (usable - trim) / (n - 1);
    this.bounds = [];
    for (let i = 0; i < n; i++) this.bounds.push(x1 - trim - i * step);
    const edges = [x1, ...this.bounds, x0];
    for (let i = 0; i < edges.length - 1; i++) {
      const a = edges[i + 1], b = edges[i];
      const len = b - a, cx = (a + b) / 2;
      const u = (cx - x0) / L;
      let geo: THREE.BufferGeometry;
      if (s.round) {
        const ra = s.radius((a - x0) / L), rb = s.radius((b - x0) / L);
        geo = new THREE.CylinderGeometry(rb, ra, len, 20);
        geo.rotateZ(-Math.PI / 2);
        geo.translate(0, Math.max(ra, rb), 0);
      } else {
        geo = new THREE.BoxGeometry(len, s.height, s.width(u));
        geo.translate(0, s.height / 2, 0);
      }
      const mats = s.round ? [s.mat(), s.inner(), s.inner()] : s.mat();
      const mesh = new THREE.Mesh(geo, mats);
      mesh.position.x = cx;
      mesh.userData.r = s.round ? s.radius(u) : s.height / 2;
      this.segs.push(mesh);
      this.group.add(mesh);
    }
    // hojas de zanahoria en el extremo izquierdo
    if (this.spec.name === 'zanahoria') {
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.05, 6), PM.leaf);
      top.rotation.z = Math.PI / 2;
      top.position.set(-0.025, 0.026, 0);
      this.segs[this.segs.length - 1].add(top);
    }
    this.next = 0;
    // entrada deslizando desde la izquierda
    const g = this.segs;
    g.forEach((m) => (m.position.z = 0.25));
    tween(0.35, (k) => g.forEach((m) => (m.position.z = 0.25 * (1 - k))), ease.outCubic);
    this.ui.setProgress(this.itemIdx, this.count);
    this.updateGuide();
  }

  private updateGuide() {
    const gx = this.bounds[this.next];
    this.guide.position.set(gx, 0.075, 0);
    this.band.position.set(gx, 0.074, 0);
  }

  private hy(x: number) {
    // altura del producto bajo x (para apoyar la mano)
    const s = this.spec;
    if (s.round) return s.radius((x + s.len / 2) / s.len) * 2;
    return s.height;
  }

  protected update(dt: number) {
    // El cuchillo sigue al puntero en x; en touch se posiciona al tocar
    const p = this.pointerLocal(0);
    const target = Math.max(-0.22, Math.min(0.25, p.x));
    this.kx += (target - this.kx) * Math.min(1, dt * 30);
    if (!this.chopping) this.knife.position.set(this.kx, this.hy(this.kx) + 0.075, 0.1);
    else this.knife.position.x = this.kx;
    // La mano descansa a la izquierda de la próxima guía (técnica de garra)
    const gx = this.bounds[this.next] ?? -this.spec.len / 2;
    const hx = gx - 0.055;
    this.hand.position.x += (hx - this.hand.position.x) * Math.min(1, dt * 12);
    this.hand.position.y = this.hy(hx) + 0.02;
    this.hand.position.z = -0.005;
    this.hand.rotation.set(0, 0, 0.15);
  }

  protected onDown() {
    if (this.busy) return;
    const p = this.pointerLocal(0);
    this.kx = Math.max(-0.22, Math.min(0.25, p.x));
    this.chop(this.kx);
  }

  private async chop(x: number) {
    this.chopping = true;
    const y0 = this.hy(x) + 0.075;
    const kn = this.knife;
    await tween(0.055, (k) => (kn.position.y = y0 * (1 - k) + 0.002 * k), ease.inCubic);
    this.resolveCut(x);
    await tween(0.09, (k) => (kn.position.y = 0.002 + (y0 - 0.002) * k), ease.outCubic);
    this.chopping = false;
  }

  private resolveCut(x: number) {
    const gx = this.bounds[this.next];
    if (gx === undefined) return;
    const dx = x - gx;
    const handX = this.hand.position.x;
    if (x < handX + 0.03 && x > handX - 0.06) {
      // ¡Corte en el dedo!
      this.injured = true;
      this.scores.push(0);
      audio.play('bad');
      audio.play('chop');
      this.eng.shake(1);
      this.fx.splash(this.worldOf(new THREE.Vector3(x, 0.03, 0)), '#c0161b', 14);
      this.ui.popup(this.eng.pointerPx.x, this.eng.pointerPx.y, '¡AY!', 'bad');
      this.ui.toast('🩹 Te cortaste. Curita, guante nuevo y a seguir.', 'bad');
      return;
    }
    if (Math.abs(dx) > 0.03) {
      audio.play('board');
      this.score(0.15, new THREE.Vector3(x, 0.05, 0));
      return;
    }
    audio.play('chop');
    this.eng.shake(0.25);
    const q = 1 - Math.pow(Math.abs(dx) / 0.03, 1.2) * 0.85;
    this.score(q, new THREE.Vector3(gx, 0.08, 0));
    // separar la rodaja recién cortada
    const piece = this.segs[this.next];
    if (piece) {
      const tx = piece.position.x + 0.012 + Math.max(0, this.next) * 0.003;
      const r0 = piece.rotation.z;
      tween(0.18, (k) => {
        piece.position.x = piece.position.x + (tx - piece.position.x) * k;
        piece.rotation.z = r0 - 0.15 * k;
      });
      this.cutPieces.push(piece);
      if (Math.random() < 0.5) this.fx.splash(this.worldOf(new THREE.Vector3(gx, 0.02, 0)), this.spec.name === 'zanahoria' ? '#ff9a3a' : '#f3e2c8', 3);
    }
    this.next++;
    if (this.next >= this.bounds.length) {
      this.busy = true;
      this.itemDone();
    } else this.updateGuide();
  }

  private async itemDone() {
    this.guide.visible = this.band.visible = false;
    audio.play('ding', 0.6);
    // barrer las piezas a la cubeta con el lomo del cuchillo
    const all = [...this.segs];
    const starts = all.map((m) => m.position.clone());
    const dest = this.pan.position.clone().add(new THREE.Vector3(0, 0.02, 0));
    await tween(0.4, (k) => {
      all.forEach((m, i) => {
        const tgt = dest.clone();
        tgt.x += (i - all.length / 2) * 0.02;
        m.position.lerpVectors(starts[i], tgt, k);
        m.position.y = starts[i].y + Math.sin(k * Math.PI) * 0.06;
      });
    }, ease.inOutCubic);
    all.forEach((m) => {
      m.removeFromParent();
      this.pan.add(m);
      m.position.sub(this.pan.position);
      m.scale.setScalar(0.7);
    });
    this.segs = [];
    this.itemIdx++;
    this.ui.setProgress(this.itemIdx, this.count);
    if (this.itemIdx >= this.count) {
      this.finish();
      return;
    }
    this.guide.visible = this.band.visible = true;
    this.busy = false;
    this.spawnItem();
  }

  protected cleanup() {
    this.ui.setInstruction('');
    this.ui.setProgress(0, 0);
  }
}

