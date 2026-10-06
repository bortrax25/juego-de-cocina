import * as THREE from 'three/webgpu';
import type { Engine } from './engine';

const CSS = `
.joy-base { position: absolute; left: 0; top: 0; width: 124px; height: 124px; margin: -62px 0 0 -62px; border-radius: 50%;
  pointer-events: none !important; opacity: 0; transform: translate3d(var(--jx, 0px), var(--jy, 0px), 0) scale(0.7);
  transition: opacity 0.16s ease-out, transform 0.18s cubic-bezier(.2,1.3,.4,1); z-index: 3;
  background: radial-gradient(circle, rgba(255,255,255,0.10) 0 52%, rgba(255,255,255,0.18) 53% 100%);
  border: 2px solid rgba(255,255,255,0.55); box-shadow: 0 6px 22px rgba(0,0,0,0.22), inset 0 0 18px rgba(255,255,255,0.12);
  backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
.joy-base.joy-on { opacity: 1; transform: translate3d(var(--jx, 0px), var(--jy, 0px), 0) scale(1); }
.joy-base.joy-drag { transition: opacity 0.16s ease-out; }
.joy-knob { position: absolute; left: 50%; top: 50%; width: 54px; height: 54px; margin: -27px 0 0 -27px; border-radius: 50%;
  background: radial-gradient(circle at 38% 32%, #ffffff, #e9edf0 60%, #cfd6db); box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  transform: translate3d(var(--kx, 0px), var(--ky, 0px), 0); transition: background 0.2s; }
.joy-base:not(.joy-drag) .joy-knob { transition: transform 0.22s cubic-bezier(.2,1.4,.4,1), background 0.2s; }
.joy-run .joy-knob { background: radial-gradient(circle at 38% 32%, #fff6e8, #ffc77a 60%, #f29a3a); }
.joy-run { border-color: rgba(255,214,150,0.85); }
.joy-tap { position: absolute; left: 0; top: 0; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.85); pointer-events: none !important; z-index: 3;
  animation: joyTap 0.45s ease-out forwards; }
@keyframes joyTap { from { opacity: 0.9; transform: translate3d(var(--jx), var(--jy), 0) scale(0.3); } to { opacity: 0; transform: translate3d(var(--jx), var(--jy), 0) scale(1.2); } }
`;

let styled = false;

const KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1],
  KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

const RADIUS = 52; // recorrido del joystick (px)
const TAP_MS = 320;
const TAP_PX = 12;

/**
 * Entrada del personaje: teclado (WASD/flechas + Shift), joystick virtual dinámico (aparece bajo el
 * pulgar en el 45% izquierdo de la pantalla), tocar el piso para caminar ahí y "interactuar".
 * Sólo escucha eventos del canvas: los toques sobre la UI HTML no llegan acá.
 */
export class Input {
  /** x = derecha, y = adelante, largo ≤ 1. Relativo a la cámara (sin aplicar el giro). */
  move = new THREE.Vector2();
  running = false;
  private _enabled = true;
  private keys = new Set<string>();
  private shift = false;
  private interactH = new Set<() => void>();
  private tapH = new Set<(p: THREE.Vector3) => void>();
  private stick = new THREE.Vector2();
  private stickRun = false;
  private joyId = -1;
  private joyOrigin = new THREE.Vector2();
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private taps = new Map<number, { x: number; y: number; t: number; moved: boolean; multi: boolean }>();
  private ndc = new THREE.Vector2();
  private ray = new THREE.Raycaster();
  private floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(private eng: Engine, private uiRoot: HTMLElement) {
    if (!styled) {
      styled = true;
      const st = document.createElement('style');
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.base = document.createElement('div');
    this.base.className = 'joy-base';
    this.knob = document.createElement('div');
    this.knob.className = 'joy-knob';
    this.base.appendChild(this.knob);
    uiRoot.appendChild(this.base);

    window.addEventListener('keydown', (e) => {
      if (isTyping(e.target)) return;
      if (e.key === 'Shift') this.shift = true;
      if (KEYS[e.code]) {
        this.keys.add(e.code);
        e.preventDefault();
      } else if (!e.repeat && (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter')) {
        // Espacio/Enter sobre un botón enfocado ya lo "clickean": no duplicamos
        if (isButton(e.target)) return;
        e.preventDefault();
        if (this.live()) this.interactH.forEach((h) => h());
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') this.shift = false;
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.shift = false;
      this.endJoy();
    });

    const c = eng.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.moveP(e));
    c.addEventListener('pointerup', (e) => this.up(e, true));
    c.addEventListener('pointercancel', (e) => this.up(e, false));
  }

  get enabled() {
    return this._enabled;
  }
  set enabled(v: boolean) {
    this._enabled = v;
    if (!v) {
      this.endJoy();
      this.taps.clear();
      this.move.set(0, 0);
      this.running = false;
    }
  }

  onInteract(cb: () => void) {
    this.interactH.add(cb);
    return () => this.interactH.delete(cb);
  }

  onTapGround(cb: (p: THREE.Vector3) => void) {
    this.tapH.add(cb);
    return () => this.tapH.delete(cb);
  }

  /** ¿Puede emitir? Sólo con la cámara de seguimiento activa. */
  private live() {
    return this._enabled && this.eng.mode === 'follow';
  }

  private down(e: PointerEvent) {
    if (!this.live()) return;
    // segundo dedo enseguida y sin arrastrar: es un pellizco, no el joystick
    if (this.joyId >= 0 && e.pointerType !== 'mouse') {
      const j = this.taps.get(this.joyId);
      if (j && !j.moved && performance.now() - j.t < 300) this.endJoy();
    }
    for (const t of this.taps.values()) t.multi = true;
    this.taps.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: false, multi: this.taps.size > 0 });
    const r = this.eng.canvas.getBoundingClientRect();
    const touch = e.pointerType !== 'mouse';
    if (touch && this.joyId < 0 && e.clientX - r.left < r.width * 0.45) {
      this.joyId = e.pointerId;
      this.eng.reservedPointers.add(e.pointerId);
      this.joyOrigin.set(e.clientX, e.clientY);
      this.stick.set(0, 0);
      this.stickRun = false;
      this.placeBase();
      this.base.classList.add('joy-on');
      this.knob.style.setProperty('--kx', '0px');
      this.knob.style.setProperty('--ky', '0px');
    }
  }

  private moveP(e: PointerEvent) {
    const t = this.taps.get(e.pointerId);
    if (t && Math.hypot(e.clientX - t.x, e.clientY - t.y) > TAP_PX) t.moved = true;
    if (e.pointerId !== this.joyId) return;
    let dx = e.clientX - this.joyOrigin.x, dy = e.clientY - this.joyOrigin.y;
    let d = Math.hypot(dx, dy);
    // base dinámica: si el pulgar se pasa mucho, el aro lo sigue
    const far = RADIUS * 1.55;
    if (d > far) {
      const k = (d - far) / d;
      this.joyOrigin.x += dx * k;
      this.joyOrigin.y += dy * k;
      dx = e.clientX - this.joyOrigin.x;
      dy = e.clientY - this.joyOrigin.y;
      d = far;
      this.placeBase();
    }
    this.base.classList.toggle('joy-drag', d > 2);
    const kd = Math.min(d, RADIUS);
    const kx = d > 0 ? (dx / d) * kd : 0, ky = d > 0 ? (dy / d) * kd : 0;
    this.knob.style.setProperty('--kx', `${kx.toFixed(1)}px`);
    this.knob.style.setProperty('--ky', `${ky.toFixed(1)}px`);
    // zona muerta + curva suave para el control fino
    const m = Math.max(0, (kd / RADIUS - 0.12) / 0.88);
    const mag = m * (0.35 + 0.65 * m);
    this.stick.set(d > 0 ? (dx / d) * mag : 0, d > 0 ? (-dy / d) * mag : 0);
    this.stickRun = d > RADIUS * 1.3;
    this.base.classList.toggle('joy-run', this.stickRun);
  }

  private up(e: PointerEvent, fire: boolean) {
    const t = this.taps.get(e.pointerId);
    this.taps.delete(e.pointerId);
    if (e.pointerId === this.joyId) this.endJoy();
    if (!t || !fire || !this.live() || t.moved || t.multi || this.eng.pinching) return;
    if (performance.now() - t.t > TAP_MS) return;
    // toque corto en el piso: caminar ahí
    const r = this.eng.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.eng.camera);
    const p = this.ray.ray.intersectPlane(this.floor, new THREE.Vector3());
    if (!p) return;
    this.ripple(e.clientX - this.uiRoot.getBoundingClientRect().left, e.clientY - this.uiRoot.getBoundingClientRect().top);
    this.tapH.forEach((h) => h(p));
  }

  private placeBase() {
    const ur = this.uiRoot.getBoundingClientRect();
    this.base.style.setProperty('--jx', `${(this.joyOrigin.x - ur.left).toFixed(1)}px`);
    this.base.style.setProperty('--jy', `${(this.joyOrigin.y - ur.top).toFixed(1)}px`);
  }

  private endJoy() {
    if (this.joyId >= 0) this.eng.reservedPointers.delete(this.joyId);
    this.joyId = -1;
    this.stick.set(0, 0);
    this.stickRun = false;
    this.base.classList.remove('joy-on', 'joy-drag', 'joy-run');
    this.knob.style.setProperty('--kx', '0px');
    this.knob.style.setProperty('--ky', '0px');
  }

  /** Onda breve donde se tocó el piso. */
  private ripple(x: number, y: number) {
    const el = document.createElement('div');
    el.className = 'joy-tap';
    el.style.setProperty('--jx', `${x.toFixed(1)}px`);
    el.style.setProperty('--jy', `${y.toFixed(1)}px`);
    this.uiRoot.appendChild(el);
    setTimeout(() => el.remove(), 500);
  }

  update(_dt: number) {
    if (!this.live()) {
      this.move.set(0, 0);
      this.running = false;
      if (this.joyId >= 0 && !this._enabled) this.endJoy();
      return;
    }
    let x = 0, y = 0;
    for (const k of this.keys) {
      x += KEYS[k][0];
      y += KEYS[k][1];
    }
    if (x || y) {
      this.move.set(x, y).normalize();
      this.running = this.shift;
    } else {
      this.move.copy(this.stick);
      if (this.move.lengthSq() > 1) this.move.normalize();
      this.running = this.stickRun;
    }
  }
}

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

function isButton(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'SUMMARY');
}
