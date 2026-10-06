import * as THREE from 'three/webgpu';
import { Minigame, type MGContext } from './base';
import { PM, filletGeo, tweezers, scallop, clam, hotelPan, contactShadow } from '../world/props';
import { tween, ease, rand } from '../core/tween';
import { audio } from '../core/audio';

type Kind = 'pinbone' | 'scallop' | 'clams';

interface Target {
  obj: THREE.Object3D;
  pos: THREE.Vector3; // local
  good: boolean; // true = hay que tocarlo
  done: boolean;
  r: number;
}

/**
 * Precisión con pinzas: sacar espinas de la trucha, limpiar el músculo lateral de las vieiras,
 * descartar almejas abiertas o rotas. Tocar donde no corresponde daña el producto.
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

  constructor(ctx: MGContext) {
    super(ctx);
    this.kind = this.param<Kind>('kind', 'pinbone');
    this.rounds = this.param('rounds', 2);
    this.group.add(this.tool);
    this.tool.rotation.z = 0.5;
  }

  protected start() {
    const t = { pinbone: 'Toca cada espina para sacarla con las pinzas. No rompas la carne.', scallop: 'Toca el músculo lateral (la pestaña blanca) de cada vieira.', clams: 'Descarta sólo las almejas abiertas o rotas (oscuras).' }[this.kind];
    this.ui.setInstruction(t);
    this.setup();
  }

  private setup() {
    this.base.forEach((o) => this.group.remove(o));
    this.targets.forEach((t) => t.obj.parent?.remove(t.obj));
    this.base = [];
    this.targets = [];
    this.got = 0;
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
        this.targets.push({ obj: bone, pos: new THREE.Vector3(x, 0.036, z), good: true, done: false, r: 0.012 });
      }
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
        this.targets.push({ obj: s.muscle, pos: mp, good: true, done: false, r: 0.014 });
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
        this.targets.push({ obj: c, pos: new THREE.Vector3(x, 0.02, z), good: isBad, done: false, r: 0.03 });
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

  protected update(dt: number) {
    const p = this.pointerLocal(0.03, this.tp);
    this.tool.position.lerp(this.tpl.set(p.x + 0.004, 0.03, p.z), Math.min(1, dt * 25));
    if (this.kind === 'clams') this.tool.visible = false;
  }

  protected onDown() {
    if (this.busy) return;
    const p = this.pointerLocal(0.02);
    // objetivo más cercano dentro de su radio (con tolerancia extra para dedos)
    const slack = window.matchMedia('(pointer: coarse)').matches ? 1.6 : 1.15;
    let best: Target | null = null, bd = 1e9;
    for (const t of this.targets) {
      if (t.done) continue;
      const d = Math.hypot(t.pos.x - p.x, t.pos.z - p.z);
      // los objetivos "buenos" ganan prioridad cuando se solapan
      const w = d - (t.good ? 0.006 : 0);
      if (d < t.r * slack && w < bd) { bd = w; best = t; }
    }
    if (!best) {
      if (this.kind === 'pinbone' && Math.abs(p.x) < 0.15 && Math.abs(p.z) < 0.05) this.damage(p);
      return;
    }
    if (!best.good) {
      this.damage(p);
      if (this.kind === 'clams') this.wrongClam(best);
      return;
    }
    const dist = Math.hypot(best.pos.x - p.x, best.pos.z - p.z);
    const q = 1 - Math.min(1, dist / (best.r * slack)) * 0.4;
    best.done = true;
    this.got++;
    this.score(q, best.pos);
    this.extract(best);
    this.ui.setProgress(this.got, this.needed);
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

  private wrongClam(t: Target) {
    const o = t.obj;
    tween(0.15, (k) => (o.position.y = 0.015 + Math.sin(k * Math.PI) * 0.02));
  }

  private extract(t: Target) {
    const o = t.obj;
    if (this.kind === 'pinbone') {
      audio.play('pluck');
      const y0 = o.position.y;
      tween(0.3, (k) => {
        o.position.y = y0 + k * 0.06;
        o.position.z += 0.001;
        this.tool.rotation.z = 0.5 - Math.sin(k * Math.PI) * 0.3;
      }, ease.outCubic).then(() => o.removeFromParent());
    } else if (this.kind === 'scallop') {
      audio.play('pluck');
      const wp = new THREE.Vector3();
      o.getWorldPosition(wp);
      tween(0.25, (k) => o.scale.setScalar(1 - k)).then(() => o.removeFromParent());
      this.fx.sparkle(wp, '#ffffff', 5);
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
