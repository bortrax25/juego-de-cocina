import * as THREE from 'three/webgpu';
import { Minigame, type MGContext } from './base';
import { oyster, oysterKnife, towel, hotelPan, PM } from '../world/props';
import { tween, ease, clamp, rand } from '../core/tween';
import { audio } from '../core/audio';
import type { Gauge } from '../ui/ui';

/**
 * Abrir ostras: 1) mantén la presión dentro de la franja para entrar por la bisagra,
 * 2) desliza para cortar el músculo y abrirla. Demasiada fuerza = el cuchillo resbala.
 */
export class ShuckGame extends Minigame {
  private count: number;
  private idx = 0;
  private phase: 'pry' | 'cut' | 'busy' = 'busy';
  private pressure = 0;
  private progress = 0;
  private zoneC = 0.55;
  private zoneW = 0.22;
  private zoneT = 0;
  private slips = 0;
  private inZone = 0;
  private total = 0;
  private oy!: ReturnType<typeof oyster>;
  private knife = oysterKnife();
  private gauge!: Gauge;
  private swipeStart: THREE.Vector3 | null = null;
  private tray = hotelPan(0.3, 0.22, 0.04);
  private iceBed: THREE.Mesh;
  private opened: THREE.Object3D[] = [];

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
    tween(0.3, (k) => (this.oy.group.position.z = 0.3 - 0.28 * k), ease.outCubic);
    this.pressure = 0;
    this.progress = 0;
    this.slips = 0;
    this.inZone = this.total = 0;
    this.zoneW = this.ctx.day >= 3 ? 0.18 : 0.24;
    this.phase = 'pry';
    this.gauge.el.style.display = '';
    this.ui.setInstruction('Mantén presionado para hacer palanca en la bisagra. ¡Mantente en la franja!');
    this.ui.setProgress(this.idx, this.count);
  }

  protected onDown() {
    if (this.phase === 'cut') this.swipeStart = this.pointerLocal(0.03);
  }

  protected onMove() {
    if (this.phase !== 'cut' || !this.swipeStart || !this.eng.pointerDown) return;
    const p = this.pointerLocal(0.03);
    const d = p.distanceTo(this.swipeStart);
    this.knife.position.set(p.x, 0.045, p.z);
    if (d > 0.07) this.open();
  }

  protected onUp() {
    this.swipeStart = null;
  }

  private slip() {
    this.slips++;
    this.pressure = 0.2;
    this.progress = Math.max(0, this.progress - 0.25);
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
    audio.play('pop', 1.2);
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
    await tween(0.3, (k) => (top.rotation.z = 0.12 + k * 1.9), ease.outBack);
    const ratio = this.total ? this.inZone / this.total : 0.5;
    const q = clamp(0.45 + ratio * 0.6 - this.slips * 0.15, 0.05, 1);
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
      // la franja deriva: la bisagra "se mueve" con la mano
      this.zoneT += dt;
      this.zoneC = 0.5 + Math.sin(this.zoneT * 1.3) * 0.18 + Math.sin(this.zoneT * 2.9) * 0.07;
      const a = this.zoneC - this.zoneW / 2, b = this.zoneC + this.zoneW / 2;
      if (this.eng.pointerDown) this.pressure += dt * 0.9;
      else this.pressure -= dt * 0.8;
      this.pressure = clamp(this.pressure, 0, 1.05);
      const inside = this.pressure >= a && this.pressure <= b;
      if (this.eng.pointerDown || this.pressure > 0.05) {
        this.total += dt;
        if (inside) {
          this.inZone += dt;
          this.progress += dt * 0.55;
          if (Math.random() < 0.15) audio.play('scrape', 0.3);
        }
      }
      if (this.pressure >= 1.0) this.slip();
      this.gauge.set(Math.min(1, this.pressure), a, b);
      this.gauge.setLabel(`palanca ${Math.round(clamp(this.progress) * 100)}%`);
      this.gauge.el.classList.toggle('hot', inside);
      if (this.progress >= 1) this.pop();
      // cuchillo en la bisagra, vibrando con la presión
      const j = this.pressure * 0.004;
      this.knife.position.set(-0.11 + this.pressure * 0.03 + rand(-j, j), 0.035, 0.0 + rand(-j, j));
      this.knife.rotation.set(0, 0, -0.1 - this.pressure * 0.2);
      const sp = this.eng.toScreen(this.worldOf(new THREE.Vector3(0, 0.0, 0.12)));
      this.gauge.el.style.transform = `translate(${sp.x}px, ${sp.y}px)`;
    }
  }

  protected cleanup() {
    this.gauge?.remove();
    this.ui.setInstruction('');
    this.ui.setProgress(0, 0);
  }
}
