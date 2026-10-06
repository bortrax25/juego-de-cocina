import * as THREE from 'three/webgpu';
import type { Engine } from '../core/engine';
import type { Kitchen, Station } from '../world/kitchen';
import type { FX } from '../world/fx';
import type { UI } from '../ui/ui';
import { audio } from '../core/audio';

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
      this.offs.push(this.eng.onDown((e) => !this.done && this.onDown(e)));
      this.offs.push(this.eng.onMove((e) => !this.done && this.onMove(e)));
      this.offs.push(this.eng.onUp((e) => !this.done && this.onUp(e)));
      this.offs.push(this.eng.addUpdate((dt) => {
        if (this.done) return;
        this.elapsed += dt;
        this.update(dt);
      }));
      this.start();
    });
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
