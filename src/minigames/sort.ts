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
 * Guardar entregas y etiquetar: cada producto a su lugar. Desliza, usa las flechas
 * del teclado o toca el destino. Rápido y sin errores: así funciona una cocina Michelin.
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
  private keyH = (e: KeyboardEvent) => {
    const m: Record<string, Dir> = { ArrowLeft: 'left', ArrowUp: 'up', ArrowRight: 'right', a: 'left', w: 'up', d: 'right' };
    if (m[e.key]) this.send(m[e.key]);
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
    this.ui.setInstruction(`¿Dónde va? · ${def.name.toUpperCase()}`);
    this.ui.setProgress(this.idx, this.count);
  }

  protected onDown(e: PointerEvent) {
    this.downAt = { x: e.clientX, y: e.clientY };
  }

  protected onUp(e: PointerEvent) {
    if (!this.downAt) return;
    const dx = e.clientX - this.downAt.x, dy = e.clientY - this.downAt.y;
    this.downAt = null;
    if (Math.hypot(dx, dy) < 30) return;
    if (-dy > Math.abs(dx)) this.send('up');
    else this.send(dx < 0 ? 'left' : 'right');
  }

  private async send(dir: Dir) {
    if (this.busy || !this.item || !this.obj) return;
    this.busy = true;
    const ok = this.item.dest === dir;
    const t = this.elapsed - this.t0;
    const q = ok ? clamp(1.1 - t * 0.18, 0.5, 1) : 0;
    this.score(q, new THREE.Vector3(0, 0.1, 0.02));
    if (!ok) {
      this.ui.toast(`✕ ${this.item.name} va en: ${DESTS[this.kind][this.item.dest]}`, 'bad');
      this.eng.shake(0.3);
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
    audio.play('whoosh', 0.5);
    await tween(0.28, (k) => {
      o.position.lerpVectors(p0, tgt, k);
      o.position.y += Math.sin(k * Math.PI) * 0.08;
      o.rotation.y = k * (dir === 'left' ? 0.6 : dir === 'right' ? -0.6 : 0);
    }, ease.inCubic);
    this.group.remove(o);
    this.idx++;
    this.ui.setProgress(this.idx, this.count);
    if (this.idx >= this.count) this.finish();
    else this.spawn();
  }

  protected update(dt: number) {
    if (this.obj && !this.busy) this.obj.rotation.y += dt * 0.3;
  }

  protected cleanup() {
    window.removeEventListener('keydown', this.keyH);
    this.buttons.remove();
    this.ui.setInstruction('');
    this.ui.setProgress(0, 0);
  }
}
