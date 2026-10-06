import * as THREE from 'three/webgpu';
import { Minigame, type MGContext } from './base';
import { PM, caviarTinBig, smallJar, contactShadow } from '../world/props';
import { mats } from '../world/materials';
import { tween, ease, rand, clamp } from '../core/tween';
import { audio } from '../core/audio';
import type { Gauge } from '../ui/ui';

/**
 * Mantén presionado para servir; suelta dentro de la franja verde.
 * caviar: porcionar latas en frascos para el servicio. stock: embolsar fondos.
 */
export class FillGame extends Minigame {
  private kind: 'caviar' | 'stock';
  private count: number;
  private idx = 0;
  private level = 0;
  private holding = false;
  private holdT = 0;
  private zone: [number, number] = [0.7, 0.85];
  private fillMesh!: THREE.Mesh;
  private container!: THREE.Group;
  private gauge!: Gauge;
  private busy = false;
  private height: number;
  private spoon = new THREE.Group();
  private srcPos: THREE.Vector3;

  constructor(ctx: MGContext) {
    super(ctx);
    this.kind = this.param('kind', 'caviar');
    this.count = this.param('count', 4);
    this.par = this.count * 3.2 + 3;
    this.height = this.kind === 'caviar' ? 0.052 : 0.16;
    this.srcPos = new THREE.Vector3(-0.17, 0, -0.02);
    if (this.kind === 'caviar') {
      const tin = caviarTinBig();
      tin.position.copy(this.srcPos);
      this.group.add(tin);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.112, 0.112, 0.012, 32), PM.tinLid);
      lid.position.set(0.24, 0.006, -0.2);
      this.group.add(lid);
      // cuchara de nácar
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#f3efe6', roughness: 0.2, metalness: 0.3 }));
      const stick = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.003, 0.008), bowl.material);
      stick.position.x = -0.045;
      this.spoon.add(bowl, stick);
    } else {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.16, 0.22, 28, 1, true), mats().steelPan);
      pot.position.set(-0.2, 0.11, -0.05);
      const liquid = new THREE.Mesh(new THREE.CircleGeometry(0.165, 28), PM.stock);
      liquid.rotation.x = -Math.PI / 2;
      liquid.position.set(-0.2, 0.19, -0.05);
      this.group.add(pot, liquid);
      const ladle = new THREE.Mesh(new THREE.SphereGeometry(0.035, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mats().steelPan);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.3, 6), mats().steelPan);
      handle.rotation.z = Math.PI / 2.6;
      handle.position.set(-0.13, 0.06, 0);
      this.spoon.add(ladle, handle);
    }
    this.group.add(this.spoon);
    const sh = contactShadow(0.14, 0.14);
    sh.position.set(0.04, 0.001, 0.02);
    this.group.add(sh);
  }

  protected start() {
    this.ui.setInstruction(this.kind === 'caviar' ? 'Mantén presionado para porcionar caviar. Suelta en la franja.' : 'Mantén presionado para servir el fondo en la bolsa. Suelta en la franja.');
    this.gauge = this.ui.gauge(true);
    this.spawn();
  }

  private spawn() {
    if (this.container) this.group.remove(this.container);
    if (this.kind === 'caviar') {
      const j = smallJar();
      this.container = j.group;
      this.fillMesh = j.fill;
    } else {
      const g = new THREE.Group();
      const cam = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.17, 24, 1, true), mats().plastic);
      cam.position.y = 0.085;
      const bag = new THREE.Mesh(new THREE.CylinderGeometry(0.071, 0.066, 0.2, 18, 1, true), PM.bag);
      bag.position.y = 0.1;
      const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.064, 1, 20), PM.stock);
      fill.scale.y = 0.0001;
      g.add(cam, bag, fill);
      this.container = g;
      this.fillMesh = fill;
    }
    this.container.position.set(0.25, 0, 0.02);
    this.group.add(this.container);
    tween(0.3, (k) => (this.container.position.x = 0.25 - 0.21 * k), ease.outBack);
    this.level = 0;
    const c = rand(0.68, 0.86);
    const w = this.ctx.day >= 4 ? 0.11 : 0.14;
    this.zone = [c - w / 2, c + w / 2];
    this.gauge.set(0, this.zone[0], this.zone[1]);
    this.gauge.setLabel(`${this.idx + 1}/${this.count}`);
    this.ui.setProgress(this.idx, this.count);
    this.busy = false;
  }

  protected onDown() {
    if (this.busy) return;
    this.holding = true;
    this.holdT = 0;
  }

  protected onUp() {
    if (!this.holding) return;
    this.holding = false;
    if (this.level < 0.05) return;
    this.evaluate();
  }

  private evaluate() {
    this.busy = true;
    const [a, b] = this.zone;
    const c = (a + b) / 2, half = (b - a) / 2;
    let q: number;
    if (this.level > 1) q = 0;
    else if (this.level >= a && this.level <= b) q = 1 - (Math.abs(this.level - c) / half) * 0.25;
    else q = clamp(0.7 - (Math.min(Math.abs(this.level - a), Math.abs(this.level - b)) / 0.2) * 0.7, 0.05, 0.7);
    this.score(q, new THREE.Vector3(0.04, this.height + 0.04, 0.02));
    if (q >= 0.92) this.fx.sparkle(this.worldOf(new THREE.Vector3(0.04, this.height, 0.02)), '#fff6c8', 12);
    audio.setLoop('stream', 0);
    this.idx++;
    this.ui.setProgress(this.idx, this.count);
    const cont = this.container;
    // tapa y fuera
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(this.kind === 'caviar' ? 0.047 : 0.077, this.kind === 'caviar' ? 0.047 : 0.077, 0.008, 24), this.kind === 'caviar' ? PM.tinLid : mats().plastic);
    lid.position.y = this.height + 0.08;
    cont.add(lid);
    tween(0.2, (k) => (lid.position.y = this.height + 0.08 - 0.075 * k), ease.inCubic).then(() => {
      audio.play(this.kind === 'caviar' ? 'click' : 'seal');
      return tween(0.35, (k) => {
        cont.position.x = 0.04 + 0.3 * k;
        cont.position.z = 0.02 - 0.15 * k;
      }, ease.inCubic);
    }).then(() => {
      if (this.idx >= this.count) this.finish();
      else this.spawn();
    });
  }

  protected update(dt: number) {
    const ladlePos = new THREE.Vector3();
    if (this.holding && !this.busy) {
      this.holdT += dt;
      // el chorro acelera cuanto más mantienes: hay que anticipar
      const rate = (this.kind === 'caviar' ? 0.32 : 0.28) * (1 + this.holdT * 1.1);
      this.level += rate * dt;
      audio.setLoop('stream', this.kind === 'caviar' ? 0.05 : 0.2);
      if (this.kind === 'caviar') {
        if (Math.random() < 0.6) this.fx.emit({ pos: this.worldOf(new THREE.Vector3(0.04, this.height + 0.03, 0.02)), count: 1, spread: 0.015, vel: new THREE.Vector3(0, -0.3, 0), life: 0.15, size: 0.006, color: '#20271a' });
      } else if (Math.random() < 0.5) this.fx.splash(this.worldOf(new THREE.Vector3(0.04, this.height * this.level + 0.02, 0.02)), '#c86a30', 1);
      if (this.level > 1.0) {
        this.holding = false;
        this.level = 1.02;
        this.ui.toast(this.kind === 'caviar' ? 'Se desbordó: caviar en la mesa. Caro.' : 'Se desbordó la bolsa.', 'bad');
        this.fx.splash(this.worldOf(new THREE.Vector3(0.04, this.height, 0.02)), this.kind === 'caviar' ? '#20271a' : '#c86a30', 16);
        this.evaluate();
      }
      ladlePos.set(0.04, this.height + 0.035, 0.02);
    } else {
      ladlePos.copy(this.srcPos).add(new THREE.Vector3(0, this.kind === 'caviar' ? 0.08 : 0.22, 0));
      if (!this.holding) audio.setLoop('stream', 0);
    }
    this.spoon.position.lerp(ladlePos, Math.min(1, dt * 14));
    this.spoon.rotation.z = this.holding ? -0.6 : 0;
    const lv = Math.min(1, this.level);
    this.fillMesh.scale.y = Math.max(0.0001, this.height * lv);
    this.fillMesh.position.y = 0.003 + (this.height * lv) / 2;
    this.gauge.set(Math.min(1, this.level));
    // posicionar el gauge junto al recipiente
    const sp = this.eng.toScreen(this.worldOf(new THREE.Vector3(0.12, this.height / 2, 0.02)));
    this.gauge.el.style.transform = `translate(${sp.x}px, ${sp.y}px)`;
  }

  protected cleanup() {
    audio.setLoop('stream', 0);
    this.gauge?.remove();
    this.ui.setInstruction('');
    this.ui.setProgress(0, 0);
  }
}
