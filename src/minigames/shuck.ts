import * as THREE from 'three/webgpu';
import { Minigame, type MGContext } from './base';
import { oyster, oysterKnife, towel, hotelPan, PM } from '../world/props';
import { tween, ease, clamp, rand } from '../core/tween';
import { audio } from '../core/audio';
import type { Gauge } from '../ui/ui';

/**
 * Abrir ostras: 1) presiona el cuchillo en la bisagra y menéalo de lado a lado (arrastres
 * alternados) para hacer palanca; con fuerza dentro de la franja avanza, demasiado rápido = el
 * cuchillo resbala. 2) desliza para cortar el músculo y abrirla.
 */
export class ShuckGame extends Minigame {
  private count: number;
  private idx = 0;
  private phase: 'pry' | 'cut' | 'busy' = 'busy';
  private force = 0; // intensidad del meneo 0..1
  private progress = 0;
  private zoneA = 0.25;
  private zoneB = 0.82;
  private slips = 0;
  private pressing = false;
  private lastX = 0;
  private wDir = 0;
  private wTravel = 0;
  private wiggle = 0; // giro visual del cuchillo
  private slipCool = 0;
  private inZone = 0;
  private total = 0;
  private oy!: ReturnType<typeof oyster>;
  private knife = oysterKnife();
  private gauge!: Gauge;
  private swipeStart: THREE.Vector3 | null = null;
  private tray = hotelPan(0.3, 0.22, 0.04);
  private iceBed: THREE.Mesh;
  private opened: THREE.Object3D[] = [];
  private tmpV = new THREE.Vector3();

  constructor(ctx: MGContext) {
    super(ctx);
    this.count = this.param('count', 4);
    this.par = this.count * 4.5 + 3;
    const t = towel(0.26, 0.2);
    t.position.set(0, 0.004, 0.02);
    this.group.add(t, this.knife);
    this.tray.position.set(0.0, 0, -0.26);
    this.iceBed = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.03, 0.21), PM.ice);
    this.iceBed.position.y = 0.02;
    this.tray.add(this.iceBed);
    this.group.add(this.tray);
  }

  protected start() {
    this.gauge = this.ui.gauge(false);
    this.next();
  }

  private next() {
    if (this.oy) this.group.remove(this.oy.group);
    this.oy = oyster();
    this.oy.group.position.set(0, 0.03, 0.3);
    this.oy.group.rotation.y = rand(-0.2, 0.2);
    this.oy.group.scale.setScalar(1.35);
    this.group.add(this.oy.group);
    const og = this.oy.group;
    tween(0.3, (k) => (og.position.z = 0.3 - 0.28 * k), ease.outCubic);
    this.force = 0;
    this.progress = 0;
    this.slips = 0;
    this.inZone = this.total = 0;
    this.zoneB = this.ctx.day >= 3 ? 0.74 : 0.82;
    this.phase = 'pry';
    this.gauge.el.style.display = '';
    this.ui.setInstruction('Presiona en la bisagra y menea el cuchillo de lado a lado (arrastra ↔). Firme pero sin pasarte de la franja.');
    this.ui.setProgress(this.idx, this.count);
  }

  protected onDown() {
    if (this.phase === 'cut') this.swipeStart = this.pointerLocal(0.03);
    if (this.phase === 'pry') {
      this.pressing = true;
      this.lastX = this.eng.pointerPx.x;
      this.wDir = 0;
      this.wTravel = 0;
      audio.play('scrape', 0.4);
      this.haptic(8);
    }
  }

  protected onMove() {
    if (this.phase === 'pry' && this.pressing) {
      this.pryMove();
      return;
    }
    if (this.phase !== 'cut' || !this.eng.pointerDown) return;
    const p = this.pointerLocal(0.03);
    // si el dedo ya estaba apoyado al abrirse la bisagra, el gesto empieza aquí
    if (!this.swipeStart) {
      this.swipeStart = p.clone();
      return;
    }
    const d = p.distanceTo(this.swipeStart);
    this.knife.position.set(p.x, 0.045, p.z);
    if (d > 0.07) this.open();
  }

  protected onUp() {
    this.swipeStart = null;
    this.pressing = false;
  }

  /** Meneo: cada cambio de sentido con recorrido suficiente es un "pry". */
  private pryMove() {
    const x = this.eng.pointerPx.x;
    const dx = x - this.lastX;
    this.lastX = x;
    // la fuerza sigue a la velocidad horizontal del meneo
    const f = clamp(Math.abs(this.pVel.x) / (this.unitPx * 130));
    if (f > this.force) this.force += (f - this.force) * 0.6;
    this.wiggle = clamp(this.wiggle + dx / (this.unitPx * 30), -0.3, 0.3);
    const dir = Math.sign(dx);
    if (dir === 0) return;
    if (dir === this.wDir) this.wTravel += Math.abs(dx);
    else {
      if (this.wTravel > this.unitPx * 2.5) this.pry();
      this.wDir = dir;
      this.wTravel = Math.abs(dx);
    }
  }

  private pry() {
    if (this.slipCool > 0) return;
    this.total++;
    if (this.force > this.zoneB) {
      this.slip();
      return;
    }
    const inside = this.force >= this.zoneA;
    if (inside) this.inZone++;
    this.progress += inside ? 0.15 : 0.05;
    audio.play('scrape', inside ? 0.5 : 0.25);
    this.haptic(inside ? 10 : 4);
    this.fx.splash(this.worldOf(this.tmpV.set(-0.08, 0.035, 0)), '#cfc8b8', inside ? 3 : 1);
    this.squash(this.oy.group, inside ? 0.06 : 0.03, 0.18);
    if (this.progress >= 1) this.pop();
  }

  private slip() {
    this.slips++;
    this.slipCool = 0.4;
    this.force = 0.2;
    this.progress = Math.max(0, this.progress - 0.25);
    this.haptic([30, 30, 50]);
    this.hitStop(0.1);
    audio.play('scrape', 1.5);
    audio.play('bad', 0.5);
    this.eng.shake(0.7);
    this.ui.popup(this.eng.pointerPx.x, this.eng.pointerPx.y - 40, '¡RESBALÓ!', 'bad');
    // en días avanzados un resbalón puede lastimarte
    if (this.slips >= 3 && Math.random() < 0.35) {
      this.injured = true;
      this.ui.toast('🩹 El cuchillo resbaló a tu mano. Con cuidado.', 'bad');
    }
  }

  private pop() {
    this.phase = 'cut';
    this.pressing = false;
    audio.play('pop', 1.2);
    this.haptic(20);
    this.hitStop(0.08);
    this.eng.shake(0.3);
    this.fx.splash(this.worldOf(new THREE.Vector3(-0.06, 0.04, 0)), '#dfe6e0', 6);
    this.oy.top.rotation.z = 0.12;
    this.gauge.el.style.display = 'none';
    this.ui.setInstruction('¡Entró! Ahora desliza el cuchillo para cortar el músculo.');
  }

  private async open() {
    this.phase = 'busy';
    this.swipeStart = null;
    audio.play('scrape');
    const top = this.oy.top;
    this.haptic(12);
    this.fx.sparkle(this.worldOf(this.tmpV.set(0, 0.05, 0)), '#ffffff', 10);
    await tween(0.3, (k) => (top.rotation.z = 0.12 + k * 1.9), ease.outBack);
    const ratio = this.total ? this.inZone / this.total : 0.5;
    const q = clamp(0.45 + ratio * 0.6 - this.slips * 0.15, 0.05, 1);
    if (q >= 0.92) this.squash(this.oy.group, 0.15, 0.3);
    this.score(q, new THREE.Vector3(0, 0.07, 0));
    this.idx++;
    this.ui.setProgress(this.idx, this.count);
    // quitamos la tapa y la ostra va al hielo
    await tween(0.2, (k) => top.scale.setScalar(1 - k));
    top.visible = false;
    const g = this.oy.group;
    const slot = this.opened.length;
    const tgt = new THREE.Vector3(-0.1 + (slot % 3) * 0.1, 0.04, -0.3 + Math.floor(slot / 3) * 0.08);
    const p0 = g.position.clone();
    await tween(0.35, (k) => {
      g.position.lerpVectors(p0, tgt, k);
      g.position.y += Math.sin(k * Math.PI) * 0.06;
    }, ease.inOutCubic);
    g.scale.setScalar(0.8);
    this.opened.push(g);
    this.oy = undefined as unknown as ReturnType<typeof oyster>;
    if (this.idx >= this.count) this.finish();
    else this.next();
  }

  protected update(dt: number) {
    if (this.phase === 'pry') {
      this.slipCool = Math.max(0, this.slipCool - dt);
      // sin meneo la fuerza cae: hay que mantener el ritmo
      this.force = Math.max(0, this.force - dt * (this.pressing ? 1.1 : 2.5));
      this.wiggle *= Math.exp(-(this.pressing ? 3 : 8) * dt);
      const inside = this.force >= this.zoneA && this.force <= this.zoneB;
      this.gauge.set(Math.min(1, this.force), this.zoneA, this.zoneB);
      this.gauge.setLabel(`palanca ${Math.round(clamp(this.progress) * 100)}%`);
      this.gauge.el.classList.toggle('hot', inside && this.pressing);
      // cuchillo clavado en la bisagra: entra al presionar, gira con el meneo
      const seat = this.pressing ? 1 : 0;
      const j = this.force * 0.002;
      this.knife.position.set(-0.12 + seat * 0.02 + this.progress * 0.012 + rand(-j, j), 0.035 + (1 - seat) * 0.02, rand(-j, j));
      this.knife.rotation.set(0, this.wiggle, -0.1 - seat * 0.15 - this.progress * 0.1);
      // la valva superior cede poco a poco
      this.oy.top.rotation.z = this.progress * 0.08 + Math.abs(this.wiggle) * 0.05;
      const sp = this.eng.toScreen(this.worldOf(this.tmpV.set(0, 0.0, 0.12)));
      this.gauge.el.style.transform = `translate(${sp.x}px, ${sp.y}px)`;
    }
  }

  protected cleanup() {
    this.gauge?.remove();
    this.ui.setInstruction('');
    this.ui.setProgress(0, 0);
  }
}
