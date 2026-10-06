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

interface Piece {
  m: THREE.Mesh;
  vx: number;
  th: number; // vuelco (rodajas redondas): 0 parada .. PI/2 acostada
  thV: number;
  yawV: number;
  half: number; // medio espesor de la rodaja
  round: boolean;
  landed: boolean;
}

/**
 * Corte con cuchillo: el cuchillo sigue al puntero en x; presiona y arrastra hacia abajo para
 * bajar la hoja (corte "meciendo" con la punta apoyada), sube para rearmar. Cortes precisos
 * seguidos encadenan combo. Si cortas sobre la mano... te cortas.
 */
export class SliceGame extends Minigame {
  private spec: Spec;
  private count: number;
  private itemIdx = 0;
  private segs: THREE.Mesh[] = [];
  private bounds: number[] = []; // posiciones x de cortes (de derecha a izquierda)
  private next = 0;
  private rig = new THREE.Group(); // pivote en la punta del cuchillo
  private knife = knife();
  private hand = glovedHand();
  private guide: THREE.Mesh;
  private band: THREE.Mesh;
  private busy = false;
  private pan = hotelPan(0.3, 0.2, 0.06);
  private kx = 0;
  private kh = 1; // altura de la hoja 0 (tabla) .. 1 (arriba)
  private khT = 1;
  private pressing = false;
  private refY = 0;
  private armed = true;
  private taps = 0;
  private moved = false;
  private combo = 0;
  private lastGood = -10;
  private pieces: Piece[] = [];
  private pv = new THREE.Vector3(); // puntero local (reutilizado)
  private tgt = new THREE.Vector3();
  private cv = new THREE.Vector3();
  private crumbV = new THREE.Vector3(0, 0.35, 0);
  private crumbColor: string;

  constructor(ctx: MGContext) {
    super(ctx);
    const item = this.param<Item>('item', 'carrot');
    this.spec = SPECS[item];
    this.count = this.param('count', 2);
    this.par = this.count * this.spec.cuts * 0.75 + 4;
    this.crumbColor = item === 'carrot' ? '#ff9a3a' : item === 'potato' ? '#f3e2a8' : item === 'salmon' ? '#ff9d7a' : '#f3ece0';
    this.guide = new THREE.Mesh(new THREE.PlaneGeometry(0.004, 0.12), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthTest: false }));
    this.guide.rotation.x = -Math.PI / 2;
    this.guide.renderOrder = 5;
    this.band = new THREE.Mesh(new THREE.PlaneGeometry(0.016, 0.12), new THREE.MeshBasicMaterial({ color: '#66ff8a', transparent: true, opacity: 0.22, depthTest: false }));
    this.band.rotation.x = -Math.PI / 2;
    this.band.renderOrder = 4;
    this.group.add(this.guide, this.band, this.rig, this.hand);
    this.pan.position.set(0.0, -0.002, -0.33);
    this.group.add(this.pan);
    // hoja a lo largo de z: punta hacia el fondo (en el pivote), mango hacia la cámara
    this.knife.rotation.set(0, Math.PI / 2, 0, 'YXZ');
    this.knife.rotateX(-0.8); // inclinado hacia la cámara para ver la hoja, como en POV
    this.knife.scale.setScalar(0.9);
    this.knife.position.set(0, -0.016, 0.26 * 0.9);
    this.rig.add(this.knife);
    this.rig.position.set(0, 0, -0.1);
  }

  protected start() {
    this.ui.setInstruction(`Presiona y arrastra hacia abajo para bajar el cuchillo sobre la línea; sube y repite. Ritmo = combo. Cuida la mano.`);
    this.spawnItem();
  }

  private spawnItem() {
    const s = this.spec;
    this.segs.forEach((m) => this.group.remove(m));
    this.segs = [];
    this.pieces = [];
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
      mesh.userData.half = len / 2;
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
    this.combo = 0;
    // entrada deslizando hacia la tabla con un rebote
    const g = this.segs;
    g.forEach((m) => (m.position.z = 0.25));
    tween(0.4, (k) => g.forEach((m) => (m.position.z = 0.25 * (1 - k))), ease.outBack).then(() => audio.play('thud', 0.4));
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

  private get strokePx() {
    return this.unitPx * 7;
  }

  protected update(dt: number) {
    // El cuchillo sigue al puntero en x
    const p = this.pointerLocal(0, this.pv);
    const target = Math.max(-0.22, Math.min(0.25, p.x));
    this.kx += (target - this.kx) * Math.min(1, dt * 30);
    if (!this.pressing) this.khT = 1;
    this.kh += (this.khT - this.kh) * Math.min(1, dt * 28);
    // corte "meciendo": la punta queda apoyada atrás, el talón y el mango suben
    const lift = this.spec.round ? 0.045 : this.spec.height * 0.6 + 0.02;
    const bob = this.pressing ? 0 : Math.sin(this.elapsed * 3) * 0.003;
    this.rig.position.set(this.kx, this.kh * lift + bob, -0.1);
    this.rig.rotation.x = -this.kh * 0.75;
    this.rig.rotation.z = (target - this.kx) * 1.5; // leve inercia lateral
    // La mano descansa a la izquierda de la próxima guía (técnica de garra)
    const gx = this.bounds[this.next] ?? -this.spec.len / 2;
    const hx = gx - 0.055;
    this.hand.position.x += (hx - this.hand.position.x) * Math.min(1, dt * 12);
    this.hand.position.y = this.hy(hx) + 0.02;
    this.hand.position.z = -0.005;
    this.hand.rotation.set(0, 0, 0.15);
    // la guía late suave para marcar el ritmo
    const pulse = 0.18 + Math.sin(this.elapsed * 7) * 0.08;
    (this.band.material as THREE.MeshBasicMaterial).opacity = pulse;
    this.updatePieces(dt);
  }

  /** Física mínima de rodajas: se vuelcan, deslizan y se asientan. Sin asignaciones. */
  private updatePieces(dt: number) {
    for (const pc of this.pieces) {
      const m = pc.m;
      pc.vx *= Math.exp(-6 * dt);
      m.position.x += pc.vx * dt;
      if (pc.round) {
        if (!pc.landed) {
          pc.thV += 16 * dt;
          pc.th += pc.thV * dt;
          if (pc.th >= Math.PI / 2) {
            pc.th = Math.PI / 2;
            if (pc.thV > 1.2) {
              pc.thV = -pc.thV * 0.28; // rebote
              audio.play('board', 0.25);
            } else {
              pc.thV = 0;
              pc.landed = true;
              this.squash(m, 0.18, 0.25);
            }
          }
        }
        m.rotation.z = -pc.th;
        m.position.y = pc.half * Math.sin(pc.th);
      } else {
        pc.yawV *= Math.exp(-5 * dt);
        m.rotation.y += pc.yawV * dt;
        m.rotation.z += (-0.12 - m.rotation.z) * Math.min(1, dt * 10);
      }
    }
  }

  protected onDown() {
    if (this.busy) return;
    this.pressing = true;
    this.moved = false;
    this.refY = this.eng.pointerPx.y;
    this.armed = true;
    this.khT = 1;
    const p = this.pointerLocal(0, this.pv);
    this.kx = Math.max(-0.22, Math.min(0.25, p.x));
  }

  protected onMove() {
    if (!this.pressing || this.busy) return;
    let dy = this.eng.pointerPx.y - this.refY;
    if (dy < 0) {
      this.refY = this.eng.pointerPx.y; // la referencia sube con el dedo
      dy = 0;
    }
    if (dy > 4) this.moved = true;
    this.khT = 1 - Math.min(1, dy / this.strokePx);
    if (this.armed && this.khT <= 0.02) {
      this.armed = false;
      this.kh = 0;
      // cortamos donde está el dedo, no donde llegó el suavizado
      const p = this.pointerLocal(0, this.pv);
      this.kx = Math.max(-0.22, Math.min(0.25, p.x));
      this.resolveCut(this.kx);
    } else if (!this.armed && this.khT >= 0.55) this.armed = true;
  }

  protected onUp() {
    if (this.pressing && !this.moved && !this.busy) {
      // un toque seco no corta: enseñamos el gesto
      this.taps++;
      if (this.taps % 2 === 1) this.popAt(this.tgt.set(this.kx, 0.12, 0), '↓ ¡arrastra hacia abajo!', 'ok');
    }
    this.pressing = false;
    this.armed = true;
  }

  private crumbs(x: number, n: number) {
    this.fx.emit({ pos: this.worldOf(this.cv.set(x, 0.02, 0), this.cv), count: n, spread: 0.01, vel: this.crumbV, velSpread: 0.7, life: 0.45, size: 0.006, gravity: 3.2, drag: 1, color: this.crumbColor, colorJitter: 0.15 });
  }

  private resolveCut(x: number) {
    const gx = this.bounds[this.next];
    if (gx === undefined) return;
    const dx = x - gx;
    const handX = this.hand.position.x;
    if (x < handX + 0.022 && x > handX - 0.06) {
      // ¡Corte en el dedo!
      this.injured = true;
      this.scores.push(0);
      this.combo = 0;
      audio.play('bad');
      audio.play('chop');
      this.eng.shake(1);
      this.haptic([40, 30, 60]);
      this.hitStop(0.18);
      this.fx.splash(this.worldOf(new THREE.Vector3(x, 0.03, 0)), '#c0161b', 14);
      this.ui.popup(this.eng.pointerPx.x, this.eng.pointerPx.y, '¡AY!', 'bad');
      this.ui.toast('🩹 Te cortaste. Curita, guante nuevo y a seguir.', 'bad');
      return;
    }
    if (Math.abs(dx) > 0.03) {
      audio.play('board');
      this.haptic(6);
      this.combo = 0;
      this.score(0.15, new THREE.Vector3(x, 0.05, 0));
      return;
    }
    audio.play('chop');
    this.haptic(10);
    this.eng.shake(0.25);
    let q = 1 - Math.pow(Math.abs(dx) / 0.03, 1.2) * 0.85;
    // ritmo: cortes buenos seguidos dentro de la ventana suben el combo
    if (q >= 0.75) {
      this.combo = this.elapsed - this.lastGood < 1.1 ? this.combo + 1 : 1;
      this.lastGood = this.elapsed;
      q = Math.min(1, q + 0.03 * (this.combo - 1));
    } else this.combo = 0;
    this.score(q, new THREE.Vector3(gx, 0.08, 0));
    if (this.combo >= 2) {
      this.popAt(this.tgt.set(gx, 0.08, 0), `x${this.combo}`, 'perfect', -34);
      if (this.combo >= 4) audio.play('pop', 0.4 + Math.min(0.6, this.combo * 0.05));
    }
    if (q >= 0.92) this.hitStop(0.05);
    this.crumbs(gx, 4 + Math.min(6, this.combo));
    this.squash(this.segs[this.next + 1] ?? this.segs[this.next], 0.12, 0.2);
    // la rodaja recién cortada se vuelca/desliza
    const piece = this.segs[this.next];
    if (piece) {
      this.pieces.push({
        m: piece,
        vx: 0.12 + Math.random() * 0.08,
        th: 0,
        thV: 2 + Math.random() * 2,
        yawV: (Math.random() - 0.5) * 3,
        half: (piece.userData.half as number) ?? 0.01,
        round: this.spec.round,
        landed: false,
      });
    }
    this.next++;
    if (this.next >= this.bounds.length) {
      this.busy = true;
      this.pressing = false;
      this.itemDone();
    } else this.updateGuide();
  }

  private async itemDone() {
    this.guide.visible = this.band.visible = false;
    audio.play('ding', 0.6);
    // dejamos asentar un instante y barremos todo a la cubeta con el lomo del cuchillo
    await tween(0.25, () => {}, ease.linear);
    this.pieces = [];
    const all = [...this.segs];
    const starts = all.map((m) => m.position.clone());
    const dest = this.pan.position.clone().add(new THREE.Vector3(0, 0.02, 0));
    await tween(0.4, (k) => {
      all.forEach((m, i) => {
        const tgt = this.tgt.copy(dest);
        tgt.x += (i - all.length / 2) * 0.02;
        m.position.lerpVectors(starts[i], tgt, k);
        m.position.y = starts[i].y + Math.sin(k * Math.PI) * 0.06;
      });
    }, ease.inOutCubic);
    all.forEach((m) => {
      this.cancelSquash(m);
      m.removeFromParent();
      this.pan.add(m);
      m.position.sub(this.pan.position);
      m.scale.setScalar(0.7);
    });
    audio.play('thud', 0.5);
    this.squash(this.pan, 0.08, 0.3);
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
