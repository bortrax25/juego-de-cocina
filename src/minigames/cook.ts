import * as THREE from 'three/webgpu';
import { Minigame, type MGContext } from './base';
import { fryBasket, lobster, stockPot, hotelPan, PM } from '../world/props';
import { tween, ease, clamp, rand } from '../core/tween';
import { audio } from '../core/audio';
import type { Ring } from '../ui/ui';

type Kind = 'fries' | 'lobster' | 'smoke';

interface Slot {
  pos: THREE.Vector3;
  home: THREE.Vector3; // dónde espera (canasta colgada, langosta en la tabla, pescado en la bandeja)
  cookPos: THREE.Vector3; // dónde se cocina
  obj: THREE.Group;
  mats: THREE.MeshStandardMaterial[];
  state: 'idle' | 'held' | 'cook' | 'out';
  anim: boolean; // una animación controla la posición (el update no la toca)
  stuck: boolean;
  unstick: number;
  shakes: number;
  bonus: number;
  jiggle: number;
  tag: { el: HTMLElement; move(x: number, y: number): void; remove(): void } | null;
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
 * Cocción por tiempo con varias "hornallas" a la vez: arrastra cada pieza al aceite/olla/rejilla,
 * agita la canasta si se pegan las papas y sácala arrastrando hacia arriba en el punto.
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
  // temporales reutilizados en el bucle
  private av = new THREE.Vector3();
  private lv = new THREE.Vector3();
  private wv = new THREE.Vector3();
  private sv = new THREE.Vector2();
  private up = new THREE.Vector3(0, 0.3, 0);
  private hv = new THREE.Vector3();
  private grabbed: Slot | null = null;
  private lastX = 0;
  private shakeDir = 0;
  private shakeTravel = 0;

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
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 0.13), new THREE.MeshStandardMaterial({ color: '#d9c7a4', roughness: 0.9 }));
      board.position.set(0, 0.006, 0.27);
      this.group.add(board);
    }
    for (let i = 0; i < nSlots; i++) {
      const x = (i - (nSlots - 1) / 2) * (this.kind === 'fries' ? 0.17 : this.kind === 'lobster' ? 0.12 : 0.2);
      const pos = new THREE.Vector3(x, 0, 0);
      const home = this.kind === 'fries' ? new THREE.Vector3(x, 0.16, 0.26) : this.kind === 'lobster' ? new THREE.Vector3(x, 0.07, 0.36) : new THREE.Vector3(x, -0.055, 0.27);
      const cookPos = this.kind === 'fries' ? new THREE.Vector3(x, -0.08, 0.05) : this.kind === 'lobster' ? new THREE.Vector3(x, 0.17, 0) : new THREE.Vector3(x, 0, 0);
      const slot: Slot = { pos, home, cookPos, obj: new THREE.Group(), mats: [], state: 'idle', anim: false, stuck: false, unstick: 0, shakes: 0, bonus: 0, jiggle: 0, tag: null, d: 0, rate: 0, ring: this.ui.ring() };
      if (this.kind === 'fries') {
        const bk = fryBasket();
        bk.scale.set(0.75, 1, 0.9);
        bk.position.copy(home);
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
        slot.obj.position.copy(home);
        this.group.add(slot.obj);
      } else {
        const loaf = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.09), new THREE.MeshStandardMaterial({ color: this.c0, roughness: 0.7, map: (PM.sword() as THREE.MeshStandardMaterial).map }));
        loaf.position.y = 0.095;
        slot.mats.push(loaf.material as THREE.MeshStandardMaterial);
        slot.obj.add(loaf);
        slot.obj.position.copy(home);
        this.group.add(slot.obj);
      }
      this.slots.push(slot);
    }
  }

  protected start() {
    const t = {
      fries: 'Arrastra cada canasta al aceite. Si se pegan, agítala (arrastra de lado a lado). Sácala arrastrando hacia arriba con el aro verde.',
      lobster: 'Arrastra cada langosta a la olla hirviendo. Sácala arrastrando hacia arriba en su punto: va directo al hielo.',
      smoke: 'Arrastra el pez espada a la rejilla del ahumador. Retíralo arrastrando hacia arriba con el aro verde.',
    }[this.kind];
    this.ui.setInstruction(t);
    this.ui.setProgress(0, this.total);
    this.slots.forEach((s) => this.resetSlot(s));
  }

  private ent(s: Slot) {
    return s.basket ?? s.obj;
  }

  private resetSlot(s: Slot) {
    s.state = 'idle';
    s.d = 0;
    s.stuck = false;
    s.unstick = 0;
    s.shakes = 0;
    s.bonus = 0;
    s.jiggle = 0;
    s.tag?.remove();
    s.tag = null;
    s.mats.forEach((m) => m.color.copy(this.c0));
    if (this.started >= this.total) {
      s.ring.set(0, 'done');
      s.ring.el.style.opacity = '0.3';
      s.obj.visible = this.kind === 'fries' ? false : s.obj.visible;
      return;
    }
    s.ring.set(0, 'idle');
    s.obj.visible = true;
    s.obj.scale.setScalar(1);
    const e = this.ent(s);
    const p0 = e.position.clone();
    s.anim = true;
    tween(0.25, (k) => e.position.lerpVectors(p0, s.home, k), ease.outCubic).then(() => {
      s.anim = false;
      if (this.kind === 'fries') this.squash(e, 0.1, 0.25);
    });
  }

  private slotAtPointer(): Slot | null {
    // seleccionamos por cercanía en pantalla (cómodo en móvil)
    let best: Slot | null = null, bd = 1e9;
    for (const s of this.slots) {
      // sólo slots accionables: libres (si quedan tandas) o cocinándose
      if (s.anim || !(s.state === 'cook' || (s.state === 'idle' && this.started < this.total))) continue;
      const sp = this.eng.toScreen(this.worldOf(this.anchor(s), this.wv), this.sv);
      const d = sp.distanceTo(this.eng.pointerPx);
      if (d < bd) { bd = d; best = s; }
    }
    return bd < Math.max(90, window.innerWidth * 0.12) ? best : null;
  }

  private anchor(s: Slot) {
    const a = this.av.copy(this.ent(s).position);
    a.y += this.kind === 'fries' ? 0.13 : this.kind === 'lobster' ? 0.07 : 0.14;
    return a;
  }

  protected onDown() {
    if (this.grabbed) return;
    const s = this.slotAtPointer();
    if (!s) return;
    this.grabbed = s;
    this.lastX = this.eng.pointerPx.x;
    this.shakeDir = 0;
    this.shakeTravel = 0;
    if (s.state === 'idle') {
      s.state = 'held';
      audio.play('click', 0.6);
      this.haptic(8);
      this.squash(this.ent(s), 0.15, 0.25);
    }
  }

  protected onMove() {
    const s = this.grabbed;
    if (!s || s.state !== 'cook' || s.anim) return;
    // sacar: arrastre claramente hacia arriba
    const up = -this.dragPx.y;
    if (up > this.unitPx * 9 && up > Math.abs(this.dragPx.x) * 1.1) {
      this.grabbed = null;
      this.pull(s);
      return;
    }
    if (this.kind !== 'fries') return;
    // agitar: cambios de sentido horizontales con recorrido suficiente
    const dx = this.eng.pointerPx.x - this.lastX;
    this.lastX = this.eng.pointerPx.x;
    const dir = Math.sign(dx);
    if (dir === 0) return;
    if (dir === this.shakeDir) this.shakeTravel += Math.abs(dx);
    else {
      if (this.shakeTravel > this.unitPx * 3) this.shake(s, this.shakeDir);
      this.shakeDir = dir;
      this.shakeTravel = Math.abs(dx);
    }
  }

  private shake(s: Slot, dir: number) {
    s.shakes++;
    s.jiggle = 0.014 * dir;
    audio.play('scrape', 0.35);
    this.haptic(6);
    this.fx.bubbles(this.worldOf(this.lv.set(s.pos.x, 0.03, 0.05), this.wv), 0.09, 6);
    if (Math.random() < 0.5) this.fx.splash(this.worldOf(this.lv.set(s.pos.x, 0.03, 0.05), this.wv), '#ffe7a8', 2);
    if (s.stuck) {
      s.unstick++;
      if (s.unstick >= 4) {
        s.stuck = false;
        s.bonus += 0.08;
        s.tag?.remove();
        s.tag = null;
        this.popAt(this.anchor(s), '¡Sueltas!', 'good');
        audio.play('good', 0.5);
      }
    } else if (s.shakes === 3) {
      s.bonus += 0.04;
      this.popAt(this.anchor(s), 'bien agitadas', 'ok');
    }
  }

  protected onUp() {
    const s = this.grabbed;
    this.grabbed = null;
    if (!s || s.state !== 'held') return;
    const p = this.pointerLocal(s.cookPos.y + 0.05, this.hv);
    let ok: boolean;
    if (this.kind === 'lobster') ok = Math.hypot(p.x, p.z) < 0.26;
    else if (this.kind === 'fries') ok = Math.abs(p.x - s.pos.x) < 0.14 && p.z > -0.16 && p.z < 0.18;
    else ok = Math.abs(p.x - s.pos.x) < 0.2 && Math.abs(p.z) < 0.17;
    if (ok && this.started < this.total) this.drop(s);
    else {
      s.state = 'idle';
      this.popAt(this.anchor(s), this.kind === 'fries' ? '↑ al aceite' : this.kind === 'lobster' ? '↑ a la olla' : '↑ a la rejilla', 'ok');
      this.resetSlot(s);
    }
  }

  private drop(s: Slot) {
    this.started++;
    s.state = 'cook';
    s.d = 0;
    // ritmo variable: hay que vigilar varias a la vez
    s.rate = (1 / rand(4.5, 6.5)) * (1 + (this.ctx.day - 1) * 0.06);
    const e = this.ent(s);
    const p0 = e.position.clone();
    s.anim = true;
    this.haptic(14);
    if (this.kind === 'fries') {
      tween(0.22, (k) => {
        e.position.lerpVectors(p0, s.cookPos, k);
        e.rotation.z *= 0.8;
      }, ease.inCubic).then(() => {
        s.anim = false;
        audio.play('sizzle', 1.2);
        this.eng.shake(0.25);
        this.fx.bubbles(this.worldOf(new THREE.Vector3(s.pos.x, 0.02, 0.05)), 0.08, 18);
        this.fx.splash(this.worldOf(new THREE.Vector3(s.pos.x, 0.03, 0.05)), '#ffe7a8', 6);
      });
    } else if (this.kind === 'lobster') {
      audio.play('pour');
      tween(0.3, (k) => {
        e.position.lerpVectors(p0, s.cookPos, k);
        e.position.y += Math.sin(k * Math.PI) * 0.08;
        e.rotation.z = -k * 0.4;
      }, ease.inCubic).then(() => {
        s.anim = false;
        e.rotation.z = 0;
        this.squash(e, 0.2, 0.3);
        this.eng.shake(0.3);
        this.fx.splash(this.worldOf(new THREE.Vector3(s.pos.x, 0.2, 0)), '#dfeef0', 14);
      });
    } else {
      tween(0.25, (k) => {
        e.position.lerpVectors(p0, s.cookPos, k);
        e.rotation.z = 0;
      }, ease.outCubic).then(() => {
        s.anim = false;
        this.squash(e, 0.15, 0.25);
        audio.play('flame');
        this.eng.shake(0.4);
      });
    }
  }

  private pull(s: Slot) {
    let q = s.d > 1.25 ? 0 : clamp(1 - Math.abs(s.d - 1) * 3.2, 0, 1);
    if (q > 0) q = clamp(q + s.bonus - (s.stuck ? 0.2 : 0));
    if (s.stuck) this.ui.toast('Las papas se pegaron a la canasta: agítala la próxima vez.', 'bad');
    this.score(q, this.anchor(s));
    if (q >= 0.92) {
      this.hitStop(0.06);
      this.haptic(18);
    }
    s.state = 'out';
    s.stuck = false;
    s.tag?.remove();
    s.tag = null;
    s.anim = true;
    this.finished++;
    this.ui.setProgress(this.finished, this.total);
    s.ring.set(1, 'done');
    const e = this.ent(s);
    const p0 = e.position.clone();
    if (this.kind === 'fries') {
      audio.play('scrape');
      tween(0.22, (k) => e.position.set(p0.x + (s.pos.x - p0.x) * k, p0.y + (0.2 - p0.y) * k, p0.z), ease.outCubic).then(() => {
        // escurrir: dos sacudidas cortas
        this.fx.splash(this.worldOf(new THREE.Vector3(s.pos.x, 0.05, 0.05)), '#ffe7a8', 6);
        return tween(0.25, (k) => (e.position.y = 0.2 + Math.sin(k * Math.PI * 4) * 0.012 * (1 - k)), ease.linear);
      }).then(() =>
        tween(0.3, (k) => (s.obj.position.y = 0.2 * k), ease.inCubic)).then(() => {
        s.obj.position.y = 0;
        s.obj.visible = false;
        this.afterPull(s);
      });
    } else if (this.kind === 'lobster') {
      const o = s.obj;
      audio.play('pour');
      this.fx.splash(this.worldOf(new THREE.Vector3(s.pos.x, 0.2, 0)), '#dfeef0', 8);
      tween(0.45, (k) => o.position.set(s.pos.x, 0.17 + Math.sin(k * Math.PI) * 0.2 - 0.1 * k, 0.36 * k), ease.inOutCubic).then(() => {
        this.fx.splash(this.worldOf(new THREE.Vector3(s.pos.x, 0.05, 0.36)), '#ffffff', 6);
        return tween(0.25, (k) => (o.scale.setScalar(1 - k)));
      }).then(() => {
        o.visible = false;
        o.scale.setScalar(1);
        o.position.copy(s.home);
        this.afterPull(s);
      });
    } else {
      audio.play('thud');
      tween(0.35, (k) => {
        s.obj.position.z = p0.z + k * 0.3;
        s.obj.position.y = Math.sin(k * Math.PI) * 0.08;
      }, ease.inOutCubic).then(() => {
        s.obj.visible = false;
        s.obj.position.copy(s.home);
        this.afterPull(s);
      });
    }
  }

  private afterPull(s: Slot) {
    s.anim = false;
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
      const e = this.ent(s);
      if (s.state === 'held') {
        // la pieza cuelga del dedo, con balanceo según la velocidad
        const hy = Math.max(s.home.y, s.cookPos.y) + 0.07;
        const p = this.pointerLocal(hy, this.hv);
        p.z -= 0.03;
        e.position.lerp(p, Math.min(1, dt * 18));
        const sway = clamp(-this.pVel.x * 0.0003, -0.35, 0.35);
        e.rotation.z += (sway - e.rotation.z) * Math.min(1, dt * 10);
      }
      // sólo slots accionables: libres (si quedan tandas), en la mano o cocinándose
      if (!(s.state === 'cook' || s.state === 'held' || (s.state === 'idle' && this.started < this.total))) continue;
      const sp = this.eng.toScreen(this.worldOf(this.anchor(s), this.wv), this.sv);
      // `translate` (no `transform`): la animación de "¡YA!" del CSS usa transform y lo pisaría
      s.ring.el.style.translate = `${sp.x}px ${sp.y}px`;
      if (s.tag) s.tag.move(sp.x, sp.y - 46);
      if (s.state !== 'cook') continue;
      if (!s.anim && this.kind === 'fries') {
        // sacudida amortiguada de la canasta
        s.jiggle *= Math.exp(-10 * dt);
        e.position.set(s.cookPos.x + s.jiggle, s.cookPos.y + Math.abs(s.jiggle) * 0.6, s.cookPos.z);
        e.rotation.z = s.jiggle * 6;
        if (!s.stuck && s.unstick === 0 && s.d > 0.4 && s.d < 0.42 + s.rate * dt && s.shakes < 3 && Math.random() < 0.6) {
          s.stuck = true;
          s.tag = this.ui.tag('¡Se pegan! ↔ agita', 'hint');
          audio.play('bad', 0.3);
        }
      }
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
        if (Math.random() < 0.7) this.fx.bubbles(this.worldOf(this.lv.set(s.pos.x, 0.02, 0.05), this.wv), 0.09, 2);
        if (d > 1.25 && Math.random() < 0.2) this.fx.emit({ pos: this.worldOf(this.lv.set(s.pos.x, 0.05, 0.05), this.wv), vel: this.up, life: 1.2, size: 0.05, grow: 0.15, color: '#444', drag: 0.4 });
      } else if (this.kind === 'lobster') {
        if (Math.random() < 0.25) this.fx.steam(this.worldOf(this.lv.set(s.pos.x, 0.25, 0), this.wv));
        if (Math.random() < 0.5) this.fx.bubbles(this.worldOf(this.lv.set(s.pos.x, 0.2, 0), this.wv), 0.1, 1, '#ffffff');
        // no pisar el arco de entrada (z llega a 0 al terminar la caída)
        if (!s.anim) s.obj.position.y = 0.17 + Math.sin(this.elapsed * 6 + s.pos.x * 30) * 0.005;
      } else {
        this.fx.fire(this.worldOf(this.lv.set(s.pos.x, 0.03, 0), this.wv), 2, 0.9);
        if (Math.random() < 0.3) this.fx.emit({ pos: this.worldOf(this.lv.set(s.pos.x, 0.15, 0), this.wv), vel: this.up, velSpread: 0.05, life: 1.4, size: 0.04, grow: 0.15, color: '#b9b4ad', drag: 0.4 });
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
      this.ctx.kitchen.setFlame(anyCook ? 2 + Math.random() * 1.5 : 0, this.worldOf(this.lv.set(0, 0.25, 0.1), this.wv));
    }
    if (this.kind === 'lobster' && Math.random() < 0.2) this.fx.steam(this.worldOf(this.lv.set(rand(-0.15, 0.15), 0.24, 0), this.wv));
  }

  protected cleanup() {
    audio.setLoop('fry', 0);
    audio.setLoop('boil', 0);
    audio.setLoop('torch', 0);
    this.ctx.kitchen.setFlame(0);
    this.slots.forEach((s) => {
      s.ring.remove();
      s.tag?.remove();
    });
    this.ui.setInstruction('');
    this.ui.setProgress(0, 0);
  }
}
