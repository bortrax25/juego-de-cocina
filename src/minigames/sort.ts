import * as THREE from 'three/webgpu';
import { Minigame, type MGContext } from './base';
import { PM, filletGeo, can, deli, caviarTinBig, deliveryBox, scallop, langoustine } from '../world/props';
import { labelTex } from '../world/textures';
import { tween, ease, clamp, pick } from '../core/tween';
import { audio } from '../core/audio';

type Kind = 'fish' | 'caviar' | 'label';
type Dir = 'left' | 'up' | 'right';

interface ItemDef {
  name: string;
  dest: Dir;
  make: () => THREE.Object3D;
}

const DESTS: Record<Kind, Record<Dir, string>> = {
  fish: { left: '❄️ Cámara fría', up: '🧊 Congelador', right: '🥫 Almacén seco' },
  caviar: { left: 'Osetra', up: '⚠️ Usar primero', right: 'Kaluga' },
  label: { left: 'FONDO', up: 'SALSA VERDE', right: 'PURÉ' },
};

function tinWith(text: string, color: string) {
  const g = caviarTinBig();
  g.scale.setScalar(0.7);
  const l = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.03), new THREE.MeshBasicMaterial({ map: labelTex(text, color, '#111') }));
  l.rotation.x = -Math.PI / 2;
  l.position.y = 0.07;
  g.add(l);
  return g;
}

const ITEMS: Record<Kind, ItemDef[]> = {
  fish: [
    { name: 'Trucha', dest: 'left', make: () => new THREE.Mesh(filletGeo(0.28, 0.1, 0.02), PM.trout()) },
    { name: 'Salmón', dest: 'left', make: () => new THREE.Mesh(filletGeo(0.32, 0.12, 0.03), PM.salmon()) },
    { name: 'Pez espada', dest: 'left', make: () => new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.1).translate(0, 0.04, 0), PM.sword()) },
    { name: 'Vieiras Hokkaido (congeladas)', dest: 'up', make: () => { const g = new THREE.Group(); for (let i = 0; i < 6; i++) { const s = scallop().group; s.position.set((i % 3) * 0.05 - 0.05, 0, Math.floor(i / 3) * 0.05 - 0.025); g.add(s); } return g; } },
    { name: 'Langostinos (congelados)', dest: 'up', make: () => { const g = new THREE.Group(); for (let i = 0; i < 3; i++) { const l = langoustine().group; l.position.z = i * 0.035 - 0.035; g.add(l); } return g; } },
    { name: 'Tomate en lata', dest: 'right', make: () => can('#c8372d', 'TOMATE') },
    { name: 'Aceite de oliva', dest: 'right', make: () => can('#3b8a4a', 'OLIVA') },
    { name: 'Anchoas', dest: 'right', make: () => can('#e9b23a', 'ANCHOA') },
  ],
  caviar: [
    { name: 'Lata Osetra', dest: 'left', make: () => tinWith('OSETRA', '#e8c25a') },
    { name: 'Lata Kaluga', dest: 'right', make: () => tinWith('KALUGA', '#8fc3ff') },
    { name: 'Lata abierta (vence hoy)', dest: 'up', make: () => tinWith('VENCE HOY', '#ff7a6a') },
  ],
  label: [
    { name: 'Fondo de langostino', dest: 'left', make: () => deli('#c4632a') },
    { name: 'Salsa verde', dest: 'up', make: () => deli('#5f9b3a') },
    { name: 'Puré de papa', dest: 'right', make: () => deli('#f1e6c4') },
  ],
};

/**
 * Guardar entregas y etiquetar: cada producto a su lugar. Agarra el producto y lánzalo hacia
 * su destino (izquierda, fondo o derecha), o usa las flechas del teclado / los botones.
 * Rápido y sin errores: así funciona una cocina Michelin.
 */
export class SortGame extends Minigame {
  private kind: Kind;
  private count: number;
  private idx = 0;
  private item: ItemDef | null = null;
  private obj: THREE.Object3D | null = null;
  private t0 = 0;
  private busy = true;
  private buttons: HTMLElement;
  private downAt: { x: number; y: number } | null = null;
  private held = false;
  private hot: Dir | null = null;
  private hp = new THREE.Vector3();
  private sp = new THREE.Vector2();
  private home = new THREE.Vector3(0, 0.03, 0.02);
  private keyH = (e: KeyboardEvent) => {
    const m: Record<string, Dir> = { ArrowLeft: 'left', ArrowUp: 'up', ArrowRight: 'right', a: 'left', w: 'up', d: 'right' };
    const d = m[e.key] ?? m[e.key.toLowerCase()];
    if (!d) return;
    e.preventDefault();
    if (!e.repeat) this.send(d);
  };

  constructor(ctx: MGContext) {
    super(ctx);
    this.kind = this.param<Kind>('kind', 'fish');
    this.count = this.param('count', 6);
    this.par = this.count * 1.8 + 2;
    const box = deliveryBox();
    box.position.set(0, -0.02, -0.12);
    box.scale.setScalar(0.8);
    if (this.kind === 'fish') this.group.add(box);
    this.buttons = document.createElement('div');
    this.buttons.className = 'sort-btns';
    const d = DESTS[this.kind];
    this.buttons.innerHTML = (['left', 'up', 'right'] as Dir[]).map((k) => `<button data-d="${k}" class="sb ${k}"><i>${k === 'left' ? '←' : k === 'up' ? '↑' : '→'}</i>${d[k]}</button>`).join('');
    this.buttons.querySelectorAll('button').forEach((b) => (b.onclick = () => this.send(b.dataset.d as Dir)));
  }

  protected start() {
    this.ui.root.append(this.buttons);
    window.addEventListener('keydown', this.keyH);
    this.spawn();
  }

  private spawn() {
    const list = ITEMS[this.kind];
    let def = pick(list);
    if (this.item && def.name === this.item.name) def = pick(list);
    this.item = def;
    const o = def.make();
    o.position.set(0, 0.03, 0.25);
    this.group.add(o);
    this.obj = o;
    tween(0.25, (k) => (o.position.z = 0.25 * (1 - k) + 0.02 * k), ease.outBack).then(() => {
      this.busy = false;
      this.t0 = this.elapsed;
    });
    this.ui.setInstruction(`¿Dónde va? · ${def.name.toUpperCase()} · agárralo y lánzalo`);
    this.ui.setProgress(this.idx, this.count);
  }

  /** Dirección de pantalla → destino (abajo no es destino). */
  private dirOf(dx: number, dy: number): Dir | null {
    if (dy > Math.abs(dx)) return null;
    if (-dy > Math.abs(dx) * 0.7) return 'up';
    return dx < 0 ? 'left' : 'right';
  }

  private setHot(d: Dir | null) {
    if (d === this.hot) return;
    this.hot = d;
    this.buttons.querySelectorAll<HTMLElement>('button').forEach((b) => {
      const on = b.dataset.d === d;
      b.style.borderColor = on ? '#7fd36e' : '';
      b.style.transform = on ? 'scale(1.06)' : '';
      b.style.background = on ? 'rgba(127,211,110,0.22)' : '';
    });
  }

  protected onDown(e: PointerEvent) {
    this.downAt = { x: e.clientX, y: e.clientY };
    if (this.busy || !this.obj) return;
    // agarrar el producto si el dedo cae cerca (zona generosa para móviles)
    const s = this.screenOf(this.obj.position, this.sp);
    const r = Math.max(110, Math.min(window.innerWidth, window.innerHeight) * 0.2);
    if (s.distanceTo(this.eng.pointerPx) < r) {
      this.held = true;
      audio.play('click', 0.5);
      this.haptic(8);
      this.squash(this.obj, 0.15, 0.25);
    }
  }

  protected onMove() {
    if (!this.held || !this.downAt) return;
    const d = Math.hypot(this.dragPx.x, this.dragPx.y) > this.unitPx * 6 ? this.dirOf(this.dragPx.x, this.dragPx.y) : null;
    this.setHot(d);
  }

  protected onUp(e: PointerEvent) {
    if (!this.downAt) return;
    const dx = e.clientX - this.downAt.x, dy = e.clientY - this.downAt.y;
    this.downAt = null;
    this.setHot(null);
    if (this.held) {
      this.held = false;
      if (!this.obj || this.busy) return;
      // lanzamiento: manda la velocidad; si no, la posición a la que lo arrastraste
      const v = this.pVel;
      let dir: Dir | null = null;
      if (v.length() > this.unitPx * 60) dir = this.dirOf(v.x, v.y);
      else {
        const p = this.obj.position;
        if (p.x < -0.15) dir = 'left';
        else if (p.x > 0.15) dir = 'right';
        else if (p.z < -0.12) dir = 'up';
      }
      if (dir) this.send(dir, true);
      else {
        const o = this.obj, p0 = o.position.clone();
        tween(0.25, (k) => o.position.lerpVectors(p0, this.home, k), ease.outBack);
        this.popAt(this.home, '¡lánzalo a su lugar!', 'ok', -40);
      }
      return;
    }
    if (Math.hypot(dx, dy) < 30) return;
    const d = this.dirOf(dx, dy);
    if (d) this.send(d);
  }

  private async send(dir: Dir, thrown = false) {
    if (this.busy || !this.item || !this.obj) return;
    this.busy = true;
    this.held = false;
    const ok = this.item.dest === dir;
    const t = this.elapsed - this.t0;
    const q = ok ? clamp(1.1 - t * 0.18, 0.5, 1) : 0;
    this.score(q, new THREE.Vector3(0, 0.1, 0.02));
    if (!ok) {
      this.ui.toast(`✕ ${this.item.name} va en: ${DESTS[this.kind][this.item.dest]}`, 'bad');
      this.eng.shake(0.3);
      this.haptic([20, 40, 20]);
    } else if (this.kind === 'label') {
      // cinta de pintor con el nombre
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.018), new THREE.MeshBasicMaterial({ map: labelTex(DESTS.label[dir]) }));
      l.position.set(0, 0.072, 0.058);
      this.obj.add(l);
      audio.play('scrape', 0.6);
    }
    const o = this.obj;
    const p0 = o.position.clone();
    const tgt = dir === 'left' ? new THREE.Vector3(-0.6, 0.05, 0) : dir === 'right' ? new THREE.Vector3(0.6, 0.05, 0) : new THREE.Vector3(0, 0.12, -0.6);
    audio.play('whoosh', thrown ? 0.8 : 0.5);
    if (ok) this.haptic(10);
    const r0 = o.rotation.y, spin = thrown ? (dir === 'left' ? 2.5 : dir === 'right' ? -2.5 : 1.2) : dir === 'left' ? 0.6 : dir === 'right' ? -0.6 : 0;
    await tween(thrown ? 0.24 : 0.28, (k) => {
      o.position.lerpVectors(p0, tgt, k);
      o.position.y += Math.sin(k * Math.PI) * (thrown ? 0.14 : 0.08);
      o.rotation.y = r0 + k * spin;
      o.rotation.x = thrown ? k * 0.8 : 0;
    }, thrown ? ease.outCubic : ease.inCubic);
    audio.play('thud', 0.4);
    this.group.remove(o);
    this.idx++;
    this.ui.setProgress(this.idx, this.count);
    if (this.idx >= this.count) this.finish();
    else this.spawn();
  }

  protected update(dt: number) {
    const o = this.obj;
    if (!o || this.busy) return;
    if (this.held) {
      // el producto sigue al dedo, levantado e inclinado según la velocidad
      const p = this.pointerLocal(0.08, this.hp);
      p.z -= 0.02;
      o.position.lerp(p, Math.min(1, dt * 18));
      o.rotation.z += (clamp(-this.pVel.x * 0.0004, -0.5, 0.5) - o.rotation.z) * Math.min(1, dt * 10);
      o.rotation.x += (clamp(this.pVel.y * 0.0004, -0.5, 0.5) - o.rotation.x) * Math.min(1, dt * 10);
    } else {
      o.rotation.y += dt * 0.3;
      o.rotation.z *= 1 - Math.min(1, dt * 8);
      o.rotation.x *= 1 - Math.min(1, dt * 8);
    }
  }

  protected cleanup() {
    window.removeEventListener('keydown', this.keyH);
    this.buttons.remove();
    this.ui.setInstruction('');
    this.ui.setProgress(0, 0);
  }
}
