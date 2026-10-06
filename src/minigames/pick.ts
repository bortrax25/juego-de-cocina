import * as THREE from 'three/webgpu';
import { Minigame, type MGContext } from './base';
import { PM, filletGeo, tweezers, scallop, clam, hotelPan, contactShadow } from '../world/props';
import { tween, ease, rand } from '../core/tween';
import { audio } from '../core/audio';

type Kind = 'pinbone' | 'scallop' | 'clams';

interface Target {
  obj: THREE.Object3D;
  pos: THREE.Vector3; // local
  good: boolean; // true = hay que sacarlo
  done: boolean;
  r: number;
  base?: THREE.Vector3; // posición de reposo del objeto (local a su padre)
  y0?: number;
}

/**
 * Precisión con pinzas: presiona sobre la espina y tira hacia atrás (arriba en pantalla) hasta que
 * salte; arranca el músculo lateral de las vieiras arrastrándolo hacia afuera; lanza (arrastra y
 * suelta rápido) las almejas abiertas o rotas. Tocar donde no corresponde daña el producto.
 */
export class PickGame extends Minigame {
  private kind: Kind;
  private targets: Target[] = [];
  private base: THREE.Object3D[] = [];
  private tool = tweezers();
  private needed = 0;
  private got = 0;
  private rounds: number;
  private round = 0;
  private busy = false;
  private tp = new THREE.Vector3();
  private tpl = new THREE.Vector3();
  private wv = new THREE.Vector3();
  private grip: Target | null = null;
  private gripQ = 1;
  private pull = 0;
  private d0 = 0;
  private fillet: THREE.Object3D | null = null;

  constructor(ctx: MGContext) {
    super(ctx);
    this.kind = this.param<Kind>('kind', 'pinbone');
    this.rounds = this.param('rounds', 2);
    this.group.add(this.tool);
    this.tool.rotation.z = 0.5;
  }

  protected start() {
    const t = {
      pinbone: 'Presiona una espina con las pinzas y tira hacia atrás (arriba) hasta que salte. Tirar de lado rompe la carne.',
      scallop: 'Pellizca el músculo lateral (la pestaña blanca) y arrástralo hacia afuera hasta arrancarlo.',
      clams: 'Agarra las almejas abiertas o rotas (oscuras) y lánzalas fuera con un movimiento rápido.',
    }[this.kind];
    this.ui.setInstruction(t);
    this.setup();
  }

  private setup() {
    this.base.forEach((o) => this.group.remove(o));
    this.targets.forEach((t) => t.obj.parent?.remove(t.obj));
    this.base = [];
    this.targets = [];
    this.got = 0;
    this.grip = null;
    this.fillet = null;
    if (this.kind === 'pinbone') {
      const fillet = new THREE.Mesh(filletGeo(0.32, 0.12, 0.022), PM.trout());
      fillet.rotation.y = Math.PI;
      const skin = new THREE.Mesh(filletGeo(0.32, 0.12, 0.004), PM.skin);
      skin.rotation.y = Math.PI;
      skin.position.y = -0.004;
      this.base.push(fillet, skin);
      const n = 6 + Math.min(4, this.ctx.day);
      for (let i = 0; i < n; i++) {
        const x = -0.09 + i * (0.16 / n) + rand(-0.004, 0.004);
        const z = -0.012 + Math.sin(i * 0.7) * 0.006;
        const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.0024, 0.0012, 0.03, 5), PM.bone);
        bone.position.set(x, 0.036, z);
        bone.rotation.set(rand(-0.4, 0.4), 0, rand(-0.3, 0.3));
        this.targets.push({ obj: bone, pos: new THREE.Vector3(x, 0.036, z), good: true, done: false, r: 0.014, base: bone.position.clone() });
      }
      this.fillet = fillet;
    } else if (this.kind === 'scallop') {
      const tray = hotelPan(0.4, 0.26, 0.03);
      this.base.push(tray);
      for (let i = 0; i < 8; i++) {
        const x = -0.135 + (i % 4) * 0.09, z = -0.05 + Math.floor(i / 4) * 0.1;
        const s = scallop();
        s.group.position.set(x, 0.004, z);
        s.group.rotation.y = rand(0, Math.PI * 2);
        this.base.push(s.group);
        s.group.updateMatrix();
        s.muscle.updateMatrix();
        const mp = new THREE.Vector3().setFromMatrixPosition(s.muscle.matrix).applyMatrix4(s.group.matrix);
        this.targets.push({ obj: s.muscle, pos: mp, good: true, done: false, r: 0.014, base: s.muscle.position.clone() });
        this.targets.push({ obj: s.group, pos: new THREE.Vector3(x, 0.02, z), good: false, done: false, r: 0.018 });
      }
    } else {
      const pan = hotelPan(0.42, 0.3, 0.07);
      this.base.push(pan);
      const n = 18;
      const bad = new Set<number>();
      while (bad.size < 4 + Math.min(3, this.ctx.day)) bad.add(Math.floor(Math.random() * n));
      for (let i = 0; i < n; i++) {
        const isBad = bad.has(i);
        const c = clam(isBad);
        const x = -0.16 + (i % 6) * 0.064 + rand(-0.01, 0.01), z = -0.09 + Math.floor(i / 6) * 0.09 + rand(-0.01, 0.01);
        c.position.set(x, 0.015, z);
        c.rotation.set(rand(-0.2, 0.2), rand(0, 6), 0);
        this.targets.push({ obj: c, pos: new THREE.Vector3(x, 0.02, z), good: isBad, done: false, r: 0.03, base: c.position.clone() });
      }
    }
    this.base.forEach((o) => this.group.add(o));
    for (const t of this.targets) if (!t.obj.parent) this.group.add(t.obj);
    const sh = contactShadow(0.45, 0.3);
    this.group.add(sh);
    this.base.push(sh);
    this.needed = this.targets.filter((t) => t.good).length;
    this.ui.setProgress(0, this.needed);
    this.busy = false;
  }

  private setJaw(closed: number) {
    // las dos patas de la pinza se cierran sobre la espina
    const arms = this.tool.children;
    for (let i = 0; i < arms.length; i++) {
      const sgn = i === 0 ? -1 : 1;
      arms[i].rotation.z = sgn * 0.06 * (1 - closed);
      arms[i].position.x = sgn * (0.006 - 0.003 * closed);
    }
  }

  protected update(dt: number) {
    const p = this.pointerLocal(0.03, this.tp);
    const g = this.grip;
    if (this.kind === 'clams') {
      this.tool.visible = false;
      if (g) {
        // la almeja agarrada sigue al dedo, levantada y tambaleándose
        const o = g.obj;
        o.position.x += (p.x - o.position.x) * Math.min(1, dt * 16);
        o.position.z += (p.z - 0.02 - o.position.z) * Math.min(1, dt * 16);
        o.position.y += (0.06 - o.position.y) * Math.min(1, dt * 14);
        o.rotation.z = Math.sin(this.elapsed * 14) * 0.08 - this.pVel.x * 0.0002;
      }
      return;
    }
    if (g && this.kind === 'pinbone') {
      // la pinza queda prendida en la punta de la espina estirada
      const o = g.obj;
      this.tpl.set(o.position.x, o.position.y + 0.015 * o.scale.y, o.position.z);
      this.tool.position.lerp(this.tpl, Math.min(1, dt * 30));
      this.tool.rotation.z = 0.5 - this.pull * 0.35;
      this.tool.rotation.x = -this.pull * 0.3;
    } else if (g && this.kind === 'scallop') {
      g.obj.getWorldPosition(this.wv);
      this.group.worldToLocal(this.wv);
      this.tool.position.lerp(this.tpl.set(this.wv.x, this.wv.y + 0.008, this.wv.z), Math.min(1, dt * 30));
    } else {
      this.tool.position.lerp(this.tpl.set(p.x + 0.004, 0.03, p.z), Math.min(1, dt * 25));
      this.tool.rotation.z += (0.5 - this.tool.rotation.z) * Math.min(1, dt * 10);
      this.tool.rotation.x *= 1 - Math.min(1, dt * 10);
    }
    this.setJaw(g ? 1 : this.eng.pointerDown ? 0.6 : 0);
  }

  private nearest(p: THREE.Vector3, slack: number) {
    let best: Target | null = null, bd = 1e9;
    for (const t of this.targets) {
      if (t.done) continue;
      const d = Math.hypot(t.pos.x - p.x, t.pos.z - p.z);
      // los objetivos "buenos" ganan prioridad cuando se solapan
      const w = d - (t.good ? 0.006 : 0);
      if (d < t.r * slack && w < bd) { bd = w; best = t; }
    }
    return best;
  }

  protected onDown() {
    if (this.busy || this.grip) return;
    // plano a la altura de la punta de los objetivos: sin paralaje al apuntar
    const p = this.pointerLocal(this.kind === 'pinbone' ? 0.036 : 0.02);
    // objetivo más cercano dentro de su radio (con tolerancia extra para dedos)
    const slack = this.coarse ? 1.6 : 1.15;
    const best = this.nearest(p, slack);
    if (this.kind === 'clams') {
      if (!best) return;
      this.grip = best;
      audio.play('click', 0.5);
      this.haptic(8);
      return;
    }
    if (!best) {
      if (this.kind === 'pinbone' && Math.abs(p.x) < 0.15 && Math.abs(p.z) < 0.05) this.damage(p);
      return;
    }
    if (!best.good) {
      this.damage(p);
      return;
    }
    const dist = Math.hypot(best.pos.x - p.x, best.pos.z - p.z);
    this.gripQ = 1 - Math.min(1, dist / (best.r * slack)) * 0.35;
    this.grip = best;
    this.pull = 0;
    this.d0 = 0;
    audio.play('click', 0.4);
    this.haptic(6);
  }

  protected onMove() {
    const g = this.grip;
    if (!g || this.busy || this.kind === 'clams') return;
    const o = g.obj;
    const base = g.base!;
    if (this.kind === 'pinbone') {
      const back = -this.dragPx.y; // hacia atrás = arriba en pantalla (sentido de la espina)
      const side = Math.abs(this.dragPx.x);
      if (side > this.unitPx * 7 && side > back * 1.2) {
        // tirón de costado: rompe la carne y la espina se escapa
        this.ui.popup(this.eng.pointerPx.x, this.eng.pointerPx.y - 30, '¡De costado no!', 'bad');
        this.release(true);
        this.damage(g.pos);
        return;
      }
      this.pull = Math.max(0, Math.min(1, back / (this.unitPx * 10)));
      // estira y levanta: la resistencia se siente al final
      const k = this.pull * this.pull;
      o.scale.set(1 - k * 0.3, 1 + k * 0.9, 1 - k * 0.3);
      o.position.y = base.y + this.pull * 0.008;
      if (this.fillet) this.fillet.position.y = k * 0.002; // la carne tira un poco
      if (this.pull >= 1) this.snap(g, side / Math.max(1, back));
    } else {
      // vieira: arrastrar el músculo lejos del centro de la vieira
      const parent = o.parent!;
      const p = this.pointerLocal(0.02, this.tp);
      this.worldOf(p, this.wv);
      parent.worldToLocal(this.wv);
      this.wv.y = base.y;
      const d = Math.hypot(this.wv.x, this.wv.z);
      if (this.d0 === 0) this.d0 = Math.max(0.01, d);
      this.pull = Math.max(0, Math.min(1, (d - this.d0) / 0.03));
      o.position.lerpVectors(base, this.wv, this.pull * 0.45);
      o.scale.set(1 + this.pull * 0.8, 1 - this.pull * 0.25, 1 - this.pull * 0.25);
      if (this.pull >= 1) this.snap(g, 0);
    }
  }

  protected onUp() {
    const g = this.grip;
    if (!g) return;
    if (this.kind === 'clams') {
      this.grip = null;
      const v = this.pVel.length();
      if (v > this.unitPx * 55) this.flick(g);
      else {
        // suelta suave: la almeja vuelve a su lugar
        const o = g.obj, p0 = o.position.clone(), b = g.base!;
        tween(0.2, (k) => o.position.lerpVectors(p0, b, k), ease.outCubic).then(() => audio.play('board', 0.3));
      }
      return;
    }
    this.release(false);
  }

  /** La espina/músculo vuelve a su sitio con rebote si se suelta antes de tiempo. */
  private release(torn: boolean) {
    const g = this.grip;
    this.grip = null;
    this.pull = 0;
    if (!g) return;
    const o = g.obj, b = g.base!;
    const p0 = o.position.clone(), s0 = o.scale.clone();
    if (this.fillet) this.fillet.position.y = 0;
    if (!torn) audio.play('pluck', 0.3);
    tween(0.25, (k) => {
      o.position.lerpVectors(p0, b, k);
      o.scale.lerpVectors(s0, this.tpl.set(1, 1, 1), k);
    }, ease.outBack);
  }

  private snap(g: Target, sideRatio: number) {
    this.grip = null;
    this.pull = 0;
    if (this.fillet) {
      this.fillet.position.y = 0;
      this.squash(this.fillet, 0.12, 0.25);
    }
    g.done = true;
    this.got++;
    const q = Math.max(0.3, this.gripQ - sideRatio * 0.25);
    this.score(q, g.pos);
    this.haptic(14);
    this.eng.shake(0.15);
    this.hitStop(0.05);
    this.extract(g);
    this.ui.setProgress(this.got, this.needed);
    if (this.got >= this.needed) this.roundDone();
  }

  private flick(g: Target) {
    g.done = true;
    const o = g.obj;
    // dirección del lanzamiento: pantalla → mesa (derecha = +x, arriba = -z)
    const v = this.pVel;
    const n = Math.max(1, v.length());
    const dx = (v.x / n) * 0.5, dz = (v.y / n) * 0.5;
    const p0 = o.position.clone();
    audio.play('whoosh', 0.5);
    this.haptic(10);
    if (g.good) {
      this.got++;
      this.score(1, g.pos);
      this.ui.setProgress(this.got, this.needed);
    } else {
      this.score(0.1, g.pos);
      this.ui.toast('Esa almeja estaba buena: desperdicio.', 'bad');
      this.eng.shake(0.2);
    }
    const spin = (Math.random() < 0.5 ? -1 : 1) * 14;
    tween(0.45, (k) => {
      o.position.set(p0.x + dx * k, p0.y + Math.sin(k * Math.PI) * 0.1, p0.z + dz * k);
      o.rotation.x = spin * k;
      o.rotation.z = spin * 0.5 * k;
    }, ease.outCubic).then(() => o.removeFromParent());
    if (this.got >= this.needed) this.roundDone();
  }

  private damage(p: THREE.Vector3) {
    this.score(0.1, p);
    audio.play('bad', 0.6);
    const mark = new THREE.Mesh(new THREE.CircleGeometry(0.006, 8), new THREE.MeshBasicMaterial({ color: '#a8352a', transparent: true, opacity: 0.6 }));
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(p.x, this.kind === 'pinbone' ? 0.031 : 0.025, p.z);
    if (this.kind !== 'clams') {
      this.group.add(mark);
      this.base.push(mark); // se limpia al cambiar de ronda
    }
    this.eng.shake(0.2);
  }

  private extract(t: Target) {
    const o = t.obj;
    if (this.kind === 'pinbone') {
      // ¡snap! la espina salta hacia atrás girando, la pinza sale con ella
      audio.play('pluck', 1.2);
      const p0 = o.position.clone(), s0 = o.scale.clone();
      this.fx.splash(this.worldOf(t.pos), '#ffd9c8', 4);
      tween(0.35, (k) => {
        o.position.set(p0.x + k * 0.02, p0.y + Math.sin(k * Math.PI * 0.6) * 0.09, p0.z - k * 0.08);
        o.rotation.x = -k * 2.5;
        o.scale.lerpVectors(s0, this.tpl.set(1, 1, 1), Math.min(1, k * 3));
      }, ease.outCubic).then(() => o.removeFromParent());
    } else if (this.kind === 'scallop') {
      audio.play('pluck', 1.2);
      const wp = new THREE.Vector3();
      o.getWorldPosition(wp);
      const p0 = o.position.clone();
      const dir = p0.clone().setY(0).normalize().multiplyScalar(0.05);
      tween(0.3, (k) => {
        o.position.set(p0.x + dir.x * k, p0.y + Math.sin(k * Math.PI) * 0.03, p0.z + dir.z * k);
        o.scale.setScalar(1 - k);
      }).then(() => o.removeFromParent());
      this.fx.sparkle(wp, '#ffffff', 6);
      if (o.parent) this.squash(o.parent, 0.15, 0.25);
    } else {
      audio.play('pop');
      const p0 = o.position.clone();
      tween(0.4, (k) => {
        o.position.set(p0.x + k * 0.3, p0.y + Math.sin(k * Math.PI) * 0.12, p0.z - k * 0.15);
        o.rotation.x += 0.2;
      }, ease.inOutCubic).then(() => o.removeFromParent());
    }
  }

  private async roundDone() {
    this.busy = true;
    this.round++;
    audio.play('ding', 0.6);
    const objs = [...this.base, ...this.targets.map((t) => t.obj).filter((o) => o.parent === this.group)];
    await tween(0.4, (k) => objs.forEach((o) => (o.position.z = (o.userData.z0 ??= o.position.z) - k * 0.6)), ease.inCubic);
    if (this.round >= this.rounds) this.finish();
    else this.setup();
  }

  protected cleanup() {
    this.ui.setInstruction('');
    this.ui.setProgress(0, 0);
  }
}
