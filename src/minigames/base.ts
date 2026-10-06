import * as THREE from 'three/webgpu';
import type { Engine } from '../core/engine';
import type { Kitchen, Station } from '../world/kitchen';
import type { FX } from '../world/fx';
import type { UI } from '../ui/ui';
import { audio } from '../core/audio';
import { tween, wait, ease } from '../core/tween';

export interface MGContext {
  eng: Engine;
  kitchen: Kitchen;
  fx: FX;
  ui: UI;
  station: Station;
  day: number;
  params: Record<string, unknown>;
}

export interface MGResult {
  quality: number; // 0..1
  injured?: boolean;
}

/**
 * Minijuego: monta su propia escena en la estación, escucha la entrada y devuelve la calidad.
 * Toda la lógica corre en el bucle del motor; nada de setInterval.
 */
export abstract class Minigame {
  group = new THREE.Group();
  protected scores: number[] = [];
  protected injured = false;
  protected elapsed = 0;
  protected par = 30; // segundos "ideales" para bonificación de velocidad
  protected done = false;
  private resolve!: (r: MGResult) => void;
  private offs: (() => void)[] = [];
  private tmp = new THREE.Vector3();
  private tmpS = new THREE.Vector2();
  // "Juice": congelado breve (hit-stop) y velocidad del puntero para gestos físicos
  private stopT = 0;
  private stopScale = 0;
  private lastMoveT = 0;
  private lastPx = new THREE.Vector2();
  private velInst = new THREE.Vector2();
  /** Velocidad del puntero en px/s (suavizada). Útil para lanzar, sacudir, presión del trazo. */
  protected pVel = new THREE.Vector2();
  /** Arrastre acumulado desde el último pointerdown, en px de pantalla. */
  protected dragPx = new THREE.Vector2();
  private downPx = new THREE.Vector2();

  constructor(protected ctx: MGContext) {
    const s = ctx.station;
    this.group.position.copy(s.work);
    this.group.rotation.y = Math.atan2(s.eye.x, s.eye.z);
    ctx.eng.scene.add(this.group);
  }

  get eng() { return this.ctx.eng; }
  get ui() { return this.ctx.ui; }
  get fx() { return this.ctx.fx; }
  param<T>(k: string, d: T): T { return (this.ctx.params[k] as T) ?? d; }

  run(): Promise<MGResult> {
    return new Promise((res) => {
      this.resolve = res;
      this.offs.push(this.eng.onDown((e) => {
        if (this.done) return;
        this.lastPx.copy(this.eng.pointerPx);
        this.downPx.copy(this.eng.pointerPx);
        this.dragPx.set(0, 0);
        this.pVel.set(0, 0);
        this.lastMoveT = performance.now();
        this.onDown(e);
      }));
      this.offs.push(this.eng.onMove((e) => {
        if (this.done) return;
        this.trackVel(e);
        this.onMove(e);
      }));
      this.offs.push(this.eng.onUp((e) => {
        if (this.done) return;
        // sólo muestreamos si el up trae desplazamiento (si no, anularía la velocidad del gesto)
        if (this.eng.pointerPx.distanceToSquared(this.lastPx) > 1) this.trackVel(e);
        // si el dedo se quedó quieto antes de soltar, no hay lanzamiento
        else if (performance.now() - this.lastMoveT > 120) this.pVel.set(0, 0);
        this.onUp(e);
      }));
      this.offs.push(this.eng.addUpdate((dt) => {
        if (this.done) return;
        let d = dt;
        if (this.stopT > 0) {
          this.stopT -= dt;
          d = dt * this.stopScale;
        }
        this.elapsed += d;
        this.update(d);
      }));
      this.start();
    });
  }

  private trackVel(_e: PointerEvent) {
    const px = this.eng.pointerPx;
    const now = performance.now();
    const dts = (now - this.lastMoveT) / 1000;
    if (this.eng.pointerDown) this.dragPx.subVectors(px, this.downPx);
    if (dts > 0.004) {
      this.velInst.subVectors(px, this.lastPx).divideScalar(dts);
      // tras una pausa larga empezamos de cero; si no, suavizamos
      if (dts > 0.15) this.pVel.copy(this.velInst);
      else this.pVel.lerp(this.velInst, 0.55);
      this.lastPx.copy(px);
      this.lastMoveT = now;
    }
  }

  // ---------- helpers de "juice" ----------

  /** Vibración corta en móviles compatibles. */
  protected haptic(ms: number | number[] = 12) {
    try {
      navigator.vibrate?.(ms);
    } catch { /* sin soporte */ }
  }

  /**
   * Hit-stop: congela (o ralentiza con `scale`) el update de este minijuego durante `sec`.
   * Devuelve una promesa que se resuelve al terminar, para encadenar la animación del impacto.
   */
  protected hitStop(sec = 0.08, scale = 0) {
    this.stopT = Math.max(this.stopT, sec);
    this.stopScale = scale;
    return wait(sec);
  }

  /** Squash & stretch elástico sobre la escala actual del objeto (se puede re-disparar). */
  protected squash(o: THREE.Object3D, amt = 0.25, dur = 0.38) {
    const ud = o.userData as { sqBase?: THREE.Vector3; sqTok?: number };
    if (!ud.sqBase) ud.sqBase = o.scale.clone();
    const base = ud.sqBase;
    const tok = (ud.sqTok = (ud.sqTok ?? 0) + 1);
    return tween(dur, (k) => {
      if (ud.sqTok !== tok) return;
      const w = Math.sin(k * Math.PI * 2.5) * (1 - k);
      o.scale.set(base.x * (1 + amt * 0.5 * w), base.y * (1 - amt * w), base.z * (1 + amt * 0.5 * w));
      if (k >= 1) {
        o.scale.copy(base);
        ud.sqBase = undefined;
      }
    }, ease.linear);
  }

  /** Cancela un squash en curso (antes de cambiar la escala del objeto a mano). */
  protected cancelSquash(o: THREE.Object3D) {
    const ud = o.userData as { sqBase?: THREE.Vector3; sqTok?: number };
    if (ud.sqBase) o.scale.copy(ud.sqBase);
    ud.sqBase = undefined;
    ud.sqTok = (ud.sqTok ?? 0) + 1;
  }

  /** Posición en pantalla (px) de un punto local. Reutiliza un vector interno. */
  protected screenOf(local: THREE.Vector3, out = this.tmpS) {
    return this.eng.toScreen(this.worldOf(local, this.tmp), out);
  }

  /** Texto flotante sobre un punto local. */
  protected popAt(local: THREE.Vector3, text: string, cls = 'perfect', dy = 0) {
    const p = this.screenOf(local);
    this.ui.popup(p.x, p.y + dy, text, cls);
  }

  /** Escala de gesto: px equivalentes en cualquier pantalla (móvil o escritorio). */
  protected get unitPx() {
    return Math.max(260, Math.min(window.innerWidth, window.innerHeight)) / 100;
  }

  protected get coarse() {
    return window.matchMedia('(pointer: coarse)').matches;
  }

  protected abstract start(): void;
  protected abstract update(dt: number): void;
  protected onDown(_e: PointerEvent) {}
  protected onMove(_e: PointerEvent) {}
  protected onUp(_e: PointerEvent) {}

  /** Puntero en coordenadas locales del minijuego sobre el plano y=h (local). */
  protected pointerLocal(h = 0, out = new THREE.Vector3()) {
    this.eng.pointOnPlaneY(this.group.position.y + h, this.tmp);
    return this.group.worldToLocal(out.copy(this.tmp));
  }

  protected worldOf(local: THREE.Vector3, out = new THREE.Vector3()) {
    return this.group.localToWorld(out.copy(local));
  }

  /** Califica una acción (0..1) y muestra el feedback flotante. */
  protected score(q: number, at?: THREE.Vector3, silent = false) {
    this.scores.push(q);
    const label = q >= 0.92 ? 'PERFECTO' : q >= 0.75 ? 'BIEN' : q >= 0.5 ? 'OK' : q > 0 ? 'FLOJO' : 'MAL';
    const cls = q >= 0.92 ? 'perfect' : q >= 0.75 ? 'good' : q >= 0.5 ? 'ok' : 'bad';
    if (!silent) {
      const p = at ? this.eng.toScreen(this.worldOf(at)) : this.eng.pointerPx.clone();
      this.ui.popup(p.x, p.y, label, cls);
      audio.play(q >= 0.75 ? 'good' : q >= 0.5 ? 'click' : 'bad', 0.7);
    }
  }

  protected finish() {
    if (this.done) return;
    this.done = true;
    const acc = this.scores.length ? this.scores.reduce((a, b) => a + b, 0) / this.scores.length : 0.5;
    const speed = Math.max(0, Math.min(1, 1.5 - this.elapsed / this.par));
    const quality = Math.max(0, Math.min(1, acc * 0.82 + speed * 0.18));
    this.offs.forEach((o) => o());
    this.cleanup();
    this.resolve({ quality, injured: this.injured });
  }

  protected cleanup() {}

  dispose() {
    this.ctx.eng.scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}
