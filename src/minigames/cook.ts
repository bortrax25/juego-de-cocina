import * as THREE from 'three/webgpu';
import { Minigame, type MGContext } from './base';
import { fryBasket, lobster, stockPot, hotelPan, PM } from '../world/props';
import { tween, ease, clamp, rand } from '../core/tween';
import { audio } from '../core/audio';
import type { Ring } from '../ui/ui';

type Kind = 'fries' | 'lobster' | 'smoke';

interface Slot {
  pos: THREE.Vector3;
  obj: THREE.Group;
  mats: THREE.MeshStandardMaterial[];
  state: 'idle' | 'cook' | 'out';
  d: number; // cocción: 1 = punto perfecto
  rate: number;
  ring: Ring;
  basket?: THREE.Group;
}

const COLORS: Record<Kind, [string, string, string]> = {
  fries: ['#f3e3a8', '#e0a43a', '#5a3112'],
  lobster: ['#2d4a55', '#e0391f', '#8a2a14'],
  smoke: ['#f2c2b8', '#c47a3c', '#3b2416'],
};

/**
 * Cocción por tiempo con varias "hornallas" a la vez: toca para meter, toca para sacar en el punto.
 * Papas fritas para el personal, langostas blanqueadas, pez espada ahumado.
 */
export class CookGame extends Minigame {
  private kind: Kind;
  private slots: Slot[] = [];
  private total: number;
  private started = 0;
  private finished = 0;
  private col = new THREE.Color();
  private c0: THREE.Color;
  private c1: THREE.Color;
  private c2: THREE.Color;
  private flareT = rand(5, 9);

  constructor(ctx: MGContext) {
    super(ctx);
    this.kind = this.param<Kind>('kind', 'fries');
    const nSlots = this.param('slots', 2);
    this.total = this.param('count', 4);
    this.par = this.total * 4 + 6;
    const [a, b, c] = COLORS[this.kind];
    this.c0 = new THREE.Color(a);
    this.c1 = new THREE.Color(b);
    this.c2 = new THREE.Color(c);
    if (this.kind === 'lobster') {
      const pot = stockPot(0.22, 0.22);
      pot.position.set(0, 0, 0);
      this.group.add(pot);
      const water = new THREE.Mesh(new THREE.CircleGeometry(0.215, 32), new THREE.MeshStandardMaterial({ color: '#b9c9cc', roughness: 0.05, metalness: 0.2 }));
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.18;
      this.group.add(water);
      const ice = hotelPan(0.3, 0.22, 0.08);
      ice.position.set(0, 0, 0.36);
      const iceLayer = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.05, 0.21), PM.ice);
      iceLayer.position.y = 0.03;
      ice.add(iceLayer);
      this.group.add(ice);
    } else if (this.kind === 'smoke') {
      const pan = hotelPan(0.5, 0.3, 0.1);
      this.group.add(pan);
      const chips = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.015, 0.28), new THREE.MeshStandardMaterial({ color: '#5b3a22', roughness: 1 }));
      chips.position.y = 0.01;
      this.group.add(chips);
      const rack = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.004, 0.28, 12, 1, 8), new THREE.MeshStandardMaterial({ color: '#aaa', metalness: 1, roughness: 0.4, wireframe: true }));
      rack.position.y = 0.06;
      this.group.add(rack);
    }
    for (let i = 0; i < nSlots; i++) {
      const x = (i - (nSlots - 1) / 2) * (this.kind === 'fries' ? 0.17 : this.kind === 'lobster' ? 0.12 : 0.2);
      const pos = new THREE.Vector3(x, 0, 0);
      const slot: Slot = { pos, obj: new THREE.Group(), mats: [], state: 'idle', d: 0, rate: 0, ring: this.ui.ring() };
      if (this.kind === 'fries') {
        const bk = fryBasket();
        bk.scale.set(0.75, 1, 0.9);
        bk.position.set(x, 0.12, 0.05);
        this.group.add(bk);
        slot.basket = bk;
        const m = new THREE.MeshStandardMaterial({ color: this.c0, roughness: 0.6 });
        slot.mats.push(m);
        const fries = new THREE.InstancedMesh(new THREE.BoxGeometry(0.009, 0.009, 0.08), m, 26);
        const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
        for (let k = 0; k < 26; k++) {
          e.set(rand(-0.3, 0.3), rand(0, Math.PI), rand(-0.2, 0.2));
          mt.compose(new THREE.Vector3(rand(-0.06, 0.06), rand(0.01, 0.05), rand(-0.07, 0.07)), q.setFromEuler(e), new THREE.Vector3(1, 1, 1));
          fries.setMatrixAt(k, mt);
        }
        slot.obj.add(fries);
        bk.add(slot.obj);
        slot.obj.visible = false;
      } else if (this.kind === 'lobster') {
        const l = lobster();
        l.group.scale.setScalar(0.7);
        l.group.rotation.y = Math.PI / 2;
        slot.obj.add(l.group);
        slot.mats.push(l.mat);
        slot.obj.position.set(x, 0.07, 0.36);
        this.group.add(slot.obj);
      } else {
        const loaf = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.09), new THREE.MeshStandardMaterial({ color: this.c0, roughness: 0.7, map: (PM.sword() as THREE.MeshStandardMaterial).map }));
        loaf.position.y = 0.095;
        slot.mats.push(loaf.material as THREE.MeshStandardMaterial);
        slot.obj.add(loaf);
        slot.obj.position.copy(pos);
        this.group.add(slot.obj);
      }
      this.slots.push(slot);
    }
  }

  protected start() {
    const t = { fries: 'Toca una canasta para bajarla al aceite. Sácala cuando el aro esté verde.', lobster: 'Toca una langosta para meterla al agua hirviendo. Sácala en su punto al hielo.', smoke: 'Toca para encender las virutas. Retira cuando el aro esté verde.' }[this.kind];
    this.ui.setInstruction(t);
    this.ui.setProgress(0, this.total);
    this.slots.forEach((s) => this.resetSlot(s));
  }

  private resetSlot(s: Slot) {
    s.state = 'idle';
    s.d = 0;
    s.mats.forEach((m) => m.color.copy(this.c0));
    if (this.started >= this.total) {
      s.ring.set(0, 'done');
      s.ring.el.style.opacity = '0.3';
      return;
    }
    s.ring.set(0, 'idle');
    if (this.kind === 'fries') s.obj.visible = true;
    if (this.kind === 'lobster') {
      s.obj.position.set(s.pos.x, 0.07, 0.36);
      s.obj.visible = true;
    }
    if (this.kind === 'smoke') {
      s.obj.position.copy(s.pos);
      s.obj.visible = true;
    }
  }

  private slotAtPointer(): Slot | null {
    // seleccionamos por cercanía en pantalla (cómodo en móvil)
    let best: Slot | null = null, bd = 1e9;
    for (const s of this.slots) {
      const sp = this.eng.toScreen(this.worldOf(this.anchor(s)));
      const d = sp.distanceTo(this.eng.pointerPx);
      if (d < bd) { bd = d; best = s; }
    }
    return bd < Math.max(90, window.innerWidth * 0.12) ? best : null;
  }

  private anchor(s: Slot) {
    if (this.kind === 'lobster') return s.state === 'cook' ? new THREE.Vector3(s.pos.x, 0.28, 0) : new THREE.Vector3(s.pos.x, 0.14, 0.36);
    if (this.kind === 'fries') return new THREE.Vector3(s.pos.x, 0.3, 0.05);
    return new THREE.Vector3(s.pos.x, 0.22, 0);
  }

  protected onDown() {
    const s = this.slotAtPointer();
    if (!s) return;
    if (s.state === 'idle' && this.started < this.total) this.drop(s);
    else if (s.state === 'cook') this.pull(s);
  }

  private drop(s: Slot) {
    this.started++;
    s.state = 'cook';
    s.d = 0;
    // ritmo variable: hay que vigilar varias a la vez
    s.rate = (1 / rand(4.5, 6.5)) * (1 + (this.ctx.day - 1) * 0.06);
    if (this.kind === 'fries') {
      audio.play('sizzle', 1.2);
      const b = s.basket!;
      tween(0.25, (k) => (b.position.y = 0.12 - 0.2 * k), ease.inCubic);
      this.fx.bubbles(this.worldOf(new THREE.Vector3(s.pos.x, 0.02, 0.05)), 0.08, 14);
    } else if (this.kind === 'lobster') {
      const o = s.obj;
      const p0 = o.position.clone();
      audio.play('pour');
      tween(0.4, (k) => {
        o.position.set(p0.x, p0.y + Math.sin(k * Math.PI) * 0.25 + (0.17 - p0.y) * k, p0.z * (1 - k));
      }, ease.inOutCubic).then(() => this.fx.splash(this.worldOf(new THREE.Vector3(s.pos.x, 0.2, 0)), '#dfeef0', 10));
    } else {
      audio.play('flame');
      this.eng.shake(0.4);
    }
  }

  private pull(s: Slot) {
    const q = s.d > 1.25 ? 0 : clamp(1 - Math.abs(s.d - 1) * 3.2, 0, 1);
    this.score(q, this.anchor(s));
    s.state = 'out';
    this.finished++;
    this.ui.setProgress(this.finished, this.total);
    s.ring.set(1, 'done');
    if (this.kind === 'fries') {
      const b = s.basket!;
      audio.play('scrape');
      tween(0.25, (k) => (b.position.y = -0.08 + 0.2 * k), ease.outCubic).then(() =>
        tween(0.3, (k) => (s.obj.position.y = 0.2 * k), ease.inCubic)).then(() => {
        s.obj.position.y = 0;
        s.obj.visible = false;
        this.afterPull(s);
      });
    } else if (this.kind === 'lobster') {
      const o = s.obj;
      audio.play('pour');
      tween(0.45, (k) => o.position.set(s.pos.x, 0.17 + Math.sin(k * Math.PI) * 0.2 - 0.1 * k, 0.36 * k), ease.inOutCubic).then(() => {
        this.fx.splash(this.worldOf(new THREE.Vector3(s.pos.x, 0.05, 0.36)), '#ffffff', 6);
        return tween(0.25, (k) => (o.scale.setScalar(1 - k)));
      }).then(() => {
        o.visible = false;
        o.scale.setScalar(1);
        this.afterPull(s);
      });
    } else {
      audio.play('thud');
      tween(0.35, (k) => {
        s.obj.position.z = k * 0.3;
        s.obj.position.y = Math.sin(k * Math.PI) * 0.08;
      }, ease.inOutCubic).then(() => {
        s.obj.visible = false;
        this.afterPull(s);
      });
    }
  }

  private afterPull(s: Slot) {
    if (this.finished >= this.total) {
      this.finish();
      return;
    }
    this.resetSlot(s);
  }

  protected update(dt: number) {
    let anyCook = false;
    this.flareT -= dt;
    for (const s of this.slots) {
      const a = this.worldOf(this.anchor(s));
      const sp = this.eng.toScreen(a);
      s.ring.move(sp.x, sp.y);
      if (s.state !== 'cook') continue;
      anyCook = true;
      s.d += s.rate * dt;
      const d = s.d;
      if (d < 1) this.col.copy(this.c0).lerp(this.c1, d);
      else this.col.copy(this.c1).lerp(this.c2, clamp((d - 1) / 0.35));
      s.mats.forEach((m) => m.color.copy(this.col));
      const state = d > 1.25 ? 'burn' : d >= 0.88 ? 'ready' : 'cook';
      s.ring.set(Math.min(1, d), state);
      // efectos
      if (this.kind === 'fries') {
        if (Math.random() < 0.7) this.fx.bubbles(this.worldOf(new THREE.Vector3(s.pos.x, 0.02, 0.05)), 0.09, 2);
        if (d > 1.25 && Math.random() < 0.2) this.fx.emit({ pos: this.worldOf(new THREE.Vector3(s.pos.x, 0.05, 0.05)), vel: new THREE.Vector3(0, 0.3, 0), life: 1.2, size: 0.05, grow: 0.15, color: '#444', drag: 0.4 });
      } else if (this.kind === 'lobster') {
        if (Math.random() < 0.25) this.fx.steam(this.worldOf(new THREE.Vector3(s.pos.x, 0.25, 0)));
        if (Math.random() < 0.5) this.fx.bubbles(this.worldOf(new THREE.Vector3(s.pos.x, 0.2, 0)), 0.1, 1, '#ffffff');
        s.obj.position.y = 0.17 + Math.sin(this.elapsed * 6 + s.pos.x * 30) * 0.005;
      } else {
        this.fx.fire(this.worldOf(new THREE.Vector3(s.pos.x, 0.03, 0)), 2, 0.9);
        if (Math.random() < 0.3) this.fx.emit({ pos: this.worldOf(new THREE.Vector3(s.pos.x, 0.15, 0)), vel: new THREE.Vector3(0, 0.25, 0), velSpread: 0.05, life: 1.4, size: 0.04, grow: 0.15, color: '#b9b4ad', drag: 0.4 });
      }
      if (d > 1.6) {
        // se quemó: se saca solo con calidad 0
        this.ui.toast(this.kind === 'fries' ? 'Se quemaron las papas.' : this.kind === 'lobster' ? 'Langosta pasada: gomosa.' : 'El pescado se quemó.', 'bad');
        this.pull(s);
      }
    }
    // Problema: el aceite/fuego se dispara de vez en cuando (más calor)
    if (this.flareT <= 0 && anyCook) {
      this.flareT = rand(6, 11);
      const s = this.slots.find((x) => x.state === 'cook');
      if (s) {
        s.rate *= 1.35;
        this.ui.toast(this.kind === 'fries' ? '¡El aceite subió de temperatura!' : this.kind === 'lobster' ? '¡Hervor fuerte!' : '¡Llamarada!', 'urgent');
        if (this.kind === 'smoke') {
          audio.play('flame', 1.3);
          this.fx.fire(this.worldOf(new THREE.Vector3(s.pos.x, 0.05, 0)), 30, 1.6);
          this.eng.shake(0.8);
        }
      }
    }
    if (this.kind === 'fries') audio.setLoop('fry', anyCook ? 0.14 : 0);
    if (this.kind === 'lobster') audio.setLoop('boil', 0.25);
    if (this.kind === 'smoke') {
      audio.setLoop('torch', anyCook ? 0.35 : 0);
      this.ctx.kitchen.setFlame(anyCook ? 2 + Math.random() * 1.5 : 0, this.worldOf(new THREE.Vector3(0, 0.25, 0.1)));
    }
    if (this.kind === 'lobster' && Math.random() < 0.2) this.fx.steam(this.worldOf(new THREE.Vector3(rand(-0.15, 0.15), 0.24, 0)));
  }

  protected cleanup() {
    audio.setLoop('fry', 0);
    audio.setLoop('boil', 0);
    audio.setLoop('torch', 0);
    this.ctx.kitchen.setFlame(0);
    this.slots.forEach((s) => s.ring.remove());
    this.ui.setInstruction('');
    this.ui.setProgress(0, 0);
  }
}
