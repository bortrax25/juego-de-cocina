import * as THREE from 'three/webgpu';
import { Minigame, type MGContext } from './base';
import { PM, knife, towel, stockPot, can, deli, hotelPan, langoustine } from '../world/props';
import { mats } from '../world/materials';
import { terminalScreen } from '../world/textures';
import { tween, ease, rand } from '../core/tween';
import { audio } from '../core/audio';
import { fmtTime } from '../game/clock';

type Kind = 'clockin' | 'clockout' | 'setup' | 'stock' | 'recipes' | 'goodbye' | 'fetch';

interface Step {
  text: string;
  targets: THREE.Object3D[];
  /** Orden obligatorio (si se define); si no, hay que tocar todos los de `need` en cualquier orden. */
  order?: THREE.Object3D[];
  need?: THREE.Object3D[];
  /** Tocar el mismo objetivo N veces (p. ej. la impresora). */
  repeat?: number;
  labels?: Map<THREE.Object3D, string>;
  hint?: boolean;
  onHit?: (o: THREE.Object3D) => Promise<void> | void;
}

/**
 * Tareas de secuencia: fichar, ponerse el uniforme, mise en place, armar el fondo en orden,
 * copiar recetas, despedidas del último día. Toques simples, mucha atmósfera.
 */
export class SequenceGame extends Minigame {
  private kind: Kind;
  private steps: Step[] = [];
  private si = 0;
  private hits = new Set<THREE.Object3D>();
  private oi = 0;
  private tags: { obj: THREE.Object3D; t: ReturnType<MGContext['ui']['tag']> }[] = [];
  private busy = false;
  private potLiquid?: THREE.Mesh;
  private now: number;
  private tmpP = new THREE.Vector3();
  private padMat = new THREE.MeshBasicMaterial({ visible: false });

  constructor(ctx: MGContext) {
    super(ctx);
    this.kind = this.param<Kind>('kind', 'clockin');
    this.now = this.param('now', 420);
    this.build();
    this.par = this.steps.reduce((a, s) => a + this.total(s), 0) * 1.6 + 2;
  }

  private add<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
    o.position.set(x, y, z);
    this.group.add(o);
    return o;
  }

  private build() {
    const k = this.ctx.kitchen;
    switch (this.kind) {
      case 'clockin': {
        const jacket = this.add(this.jacketProp(), -0.42, 0.05, -0.1);
        const apron = this.add(this.apronProp(), 0.42, 0.05, -0.1);
        this.steps.push({ text: 'Ponte la chaqueta blanca.', targets: [jacket], hint: true, onHit: (o) => this.vanish(o, 'whoosh') });
        this.steps.push({ text: 'Átate el delantal.', targets: [apron], hint: true, onHit: (o) => this.vanish(o, 'whoosh') });
        this.steps.push({ text: 'Ficha tu entrada en el reloj.', targets: [k.terminal], hint: true, onHit: () => this.punch('Entrada registrada') });
        break;
      }
      case 'clockout': {
        const hook = this.add(this.apronProp(), 0.42, 0.05, -0.1);
        hook.visible = false;
        this.steps.push({ text: 'Ficha tu salida.', targets: [k.terminal], hint: true, onHit: async () => {
          this.punch('Salida registrada');
          // el delantal aparece para colgarlo (si no, el objetivo del paso siguiente sería invisible)
          hook.visible = true;
          const s0 = hook.scale.clone();
          await tween(0.25, (kk) => hook.scale.copy(s0).multiplyScalar(0.2 + 0.8 * kk), ease.outBack);
        } });
        this.steps.push({ text: 'Cuelga el delantal. Mañana otra vez.', targets: [hook], hint: true, onHit: async (o) => {
          audio.play('thud', 0.4);
          await tween(0.3, (kk) => (o.rotation.z = Math.sin(kk * Math.PI * 2) * 0.12 * (1 - kk)), ease.linear);
          o.rotation.z = 0;
        } });
        break;
      }
      case 'setup': {
        const roll = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.01, 0.22), new THREE.MeshStandardMaterial({ color: '#202634', roughness: 1 }));
        this.add(roll, -0.05, 0.005, 0.06);
        const knives: THREE.Object3D[] = [];
        for (let i = 0; i < 3; i++) {
          const kn = knife();
          kn.scale.setScalar(0.8 - i * 0.12);
          kn.rotation.set(-Math.PI / 2, 0, 0);
          // zona de toque generosa (la hoja mide 2 mm de grosor)
          const pad = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.03), this.padMat);
          pad.position.set(0.1, -0.02, 0.01);
          kn.add(pad);
          this.add(kn, -0.17 + i * 0.01, 0.012, 0.0 + i * 0.05);
          knives.push(kn);
        }
        const t = towel(0.2, 0.14);
        this.add(t, 0.22, 0.01, 0.12);
        const all = [...knives, t];
        this.steps.push({ text: 'Mise en place: saca tus cuchillos y el trapo húmedo.', targets: all, need: all, hint: true, onHit: (o) => this.slideTo(o, new THREE.Vector3(0.2, 0.012, -0.28 + all.indexOf(o) * 0.1)) });
        break;
      }
      case 'stock': {
        const pot = stockPot(0.17, 0.26);
        this.add(pot, 0, 0, -0.02);
        this.potLiquid = new THREE.Mesh(new THREE.CircleGeometry(0.165, 28), new THREE.MeshStandardMaterial({ color: '#7b7f82', roughness: 0.2, metalness: 0.6 }));
        this.potLiquid.rotation.x = -Math.PI / 2;
        this.potLiquid.position.set(0, 0.03, -0.02);
        this.group.add(this.potLiquid);
        const heads = new THREE.Group();
        const hp = hotelPan(0.16, 0.12, 0.04);
        heads.add(hp);
        for (let i = 0; i < 4; i++) {
          const l = langoustine().head;
          l.position.set(rand(-0.04, 0.04), 0.03, rand(-0.03, 0.03));
          heads.add(l);
        }
        const mire = deli('#f0731c');
        const tom = can('#c8372d', 'TOMATE');
        const water = deli('#cfe3ea');
        const herbs = new THREE.Group();
        for (let i = 0; i < 6; i++) {
          const s = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.14, 4), PM.leaf);
          s.rotation.set(Math.PI / 2, 0, rand(-0.3, 0.3));
          s.position.set(rand(-0.02, 0.02), 0.01, 0);
          herbs.add(s);
        }
        this.add(heads, -0.28, 0, 0.1);
        this.add(mire, -0.24, 0, -0.2);
        this.add(tom, 0.24, 0, -0.2);
        this.add(water, 0.28, 0, 0.1);
        this.add(herbs, 0.0, 0, 0.24);
        const labels = new Map<THREE.Object3D, string>([[heads, 'Cabezas'], [mire, 'Mirepoix'], [tom, 'Tomate'], [water, 'Agua'], [herbs, 'Estragón']]);
        const order: THREE.Object3D[] = [heads, mire, tom, water, herbs];
        const colors = ['#9a4a2a', '#b8582a', '#c0402a', '#c4632a', '#c4632a'];
        this.steps.push({
          text: 'Fondo de langostino: Cabezas → Mirepoix → Tomate → Agua → Estragón',
          targets: order, order, labels,
          onHit: (o) => {
            const i = order.indexOf(o);
            (this.potLiquid!.material as THREE.MeshStandardMaterial).color.set(colors[i]);
            (this.potLiquid!.material as THREE.MeshStandardMaterial).metalness = 0;
            this.potLiquid!.position.y = 0.05 + i * 0.035;
            audio.play(i === 0 ? 'sizzle' : 'pour');
            this.fx.splash(this.worldOf(new THREE.Vector3(0, 0.2, -0.02)), colors[i], 8);
            return this.dunk(o);
          },
        });
        break;
      }
      case 'recipes': {
        const printer = k.printer;
        const pages: THREE.Mesh[] = [];
        for (let i = 0; i < 3; i++) {
          const pg = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.28), mats().white);
          pg.rotation.x = -Math.PI / 2;
          pg.visible = false;
          this.add(pg, -0.25 + i * 0.25, -0.085, 0.36); // sobre la mesa, delante de la impresora
          pages.push(pg);
        }
        let printed = 0;
        this.steps.push({ text: 'Imprime las recetas de la estación (3).', targets: [printer], repeat: 3, hint: true, onHit: async () => {
          audio.play('ticket');
          const pg = pages[printed++];
          if (!pg) return;
          pg.visible = true;
          const z0 = 0.1;
          await tween(0.3, (kk) => (pg.position.z = z0 + 0.26 * kk));
        } });
        this.steps.push({ text: 'Revisa y copia cada receta en tu libreta.', targets: pages, need: pages, hint: true, onHit: (o) => this.vanish(o, 'scrape') });
        break;
      }
      case 'goodbye': {
        const crew = k.cooks.filter((c) => c !== k.chef).slice(0, 3);
        const spots = [[-0.55, -0.8], [0.05, -0.85], [0.6, -0.8]];
        crew.forEach((c, i) => c.walkTo(spots[i][0], spots[i][1], 0));
        k.chef.walkTo(1.3, -0.6, -0.5);
        const bread = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshStandardMaterial({ color: '#9a5a26', roughness: 0.8 }));
        bread.scale.set(1.4, 0.7, 1);
        bread.visible = false;
        this.add(bread, 0, 0.04, 0.02);
        const roots = crew.map((c) => c.root);
        this.steps.push({ text: 'Último día. Despídete de cada compañero.', targets: roots, need: roots, hint: true, onHit: (o) => {
          const c = crew.find((x) => x.root === o)!;
          c.work = 'talk';
          audio.play('good', 0.5);
          this.ui.chefSay(pick3(['Te vamos a extrañar.', '¡Fue un honor, chef!', 'Vuelve cuando quieras.']), 'happy', 'Equipo');
        } });
        this.steps.push({ text: 'Un regalo del equipo: pan de masa madre.', targets: [bread], hint: true, onHit: (o) => this.vanish(o, 'good') });
        // el pan aparece cuando ya saludaste a todos
        const greet = this.steps[0].onHit!;
        this.steps[0].onHit = async (o) => {
          await greet(o);
          if (this.hits.size >= roots.length) bread.visible = true;
        };
        break;
      }
      case 'fetch': {
        const names: [string, string][] = [['TOMATE', '#c8372d'], ['OLIVA', '#3b8a4a'], ['ANCHOA', '#e9b23a'], ['ARROZ', '#f0e9d8'], ['TOMATE', '#c8372d'], ['SAL', '#2f6db0']];
        const cans = names.map(([n, c], i) => this.add(can(c, n), -0.2 + (i % 3) * 0.2, 0, -0.08 + Math.floor(i / 3) * 0.17));
        const need = cans.filter((_, i) => names[i][0] === 'TOMATE');
        const labels = new Map<THREE.Object3D, string>(cans.map((c, i) => [c, names[i][0]]));
        this.steps.push({ text: 'Se acabó el tomate en la línea: trae las 2 latas de TOMATE.', targets: cans, need, labels, onHit: (o) => this.vanish(o, 'thud') });
        break;
      }
    }
  }

  private jacketProp() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.3, 4, 10), mats().jacket);
    body.scale.z = 0.3;
    body.position.y = -0.2;
    g.add(body);
    for (const s of [-1, 1]) {
      const sl = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.3, 3, 8), mats().jacket);
      sl.position.set(s * 0.15, -0.2, 0);
      sl.rotation.z = s * 0.15;
      g.add(sl);
    }
    const hanger = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.004, 4, 12, Math.PI), mats().steelDark);
    hanger.position.y = 0.02;
    g.add(hanger);
    return g;
  }

  private apronProp() {
    const g = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.5, 0.01), mats().apron);
    a.position.y = -0.25;
    g.add(a);
    const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 6), mats().steelDark);
    hook.rotation.x = Math.PI / 2;
    g.add(hook);
    return g;
  }

  private async vanish(o: THREE.Object3D, sfx: 'whoosh' | 'scrape' | 'good' | 'thud') {
    audio.play(sfx);
    const s0 = o.scale.clone(), p0 = o.position.clone();
    await tween(0.3, (k) => {
      o.scale.copy(s0).multiplyScalar(1 - k);
      o.position.set(p0.x, p0.y + k * 0.06, p0.z + k * 0.2);
    }, ease.inCubic);
    o.visible = false;
  }

  private async slideTo(o: THREE.Object3D, p: THREE.Vector3) {
    audio.play('scrape', 0.6);
    const p0 = o.position.clone();
    await tween(0.3, (k) => {
      o.position.lerpVectors(p0, p, k);
      o.position.y += Math.sin(k * Math.PI) * 0.05;
    }, ease.inOutCubic);
  }

  private async dunk(o: THREE.Object3D) {
    const p0 = o.position.clone();
    const tgt = new THREE.Vector3(0, 0.34, -0.02);
    await tween(0.3, (k) => {
      o.position.lerpVectors(p0, tgt, k);
      o.rotation.z = (p0.x < 0 ? -1 : 1) * k * 1.6;
    }, ease.inOutCubic);
    await tween(0.25, (k) => {
      o.position.lerpVectors(tgt, p0, k);
      o.rotation.z = (p0.x < 0 ? -1 : 1) * (1 - k) * 1.6;
    });
  }

  private punch(msg: string) {
    audio.play('beep');
    const t = this.ctx.kitchen.terminal;
    const mm = t.material as THREE.Material[];
    mm[4] = new THREE.MeshBasicMaterial({ map: terminalScreen([fmtTime(this.now).toUpperCase(), msg, '¡Buen turno!']) });
    this.fx.sparkle(t.getWorldPosition(new THREE.Vector3()), '#9fd0ff', 8);
  }

  protected start() {
    this.showStep();
  }

  private showStep() {
    const s = this.steps[this.si];
    this.hits.clear();
    this.oi = 0;
    this.ui.setInstruction(s.text);
    this.tags.forEach((t) => t.t.remove());
    this.tags = [];
    const show = new Set<THREE.Object3D>();
    if (s.labels) s.labels.forEach((_, o) => show.add(o));
    if (s.hint) (s.need ?? s.targets).forEach((o) => show.add(o));
    for (const o of show) this.tags.push({ obj: o, t: this.ui.tag(s.labels?.get(o) ?? '●', s.labels ? 'label' : 'hint') });
    this.ui.setProgress(0, this.total(s));
  }

  private total(s: Step) {
    return s.order?.length ?? s.repeat ?? (s.need ?? s.targets).length;
  }

  protected async onDown() {
    if (this.busy) return;
    const s = this.steps[this.si];
    // ignoramos los objetos ocultos (el rayo no mira `visible`)
    let hit: THREE.Intersection | undefined;
    let o: THREE.Object3D | null = null;
    for (const h of this.eng.hit(s.targets, true)) {
      let c: THREE.Object3D | null = h.object;
      while (c && !s.targets.includes(c)) c = c.parent;
      if (c && c.visible) { hit = h; o = c; break; }
    }
    if (!hit || !o) return;
    const at = this.group.worldToLocal(hit.point.clone());
    const need = s.need ?? s.targets;
    let complete = true; // ¿este objeto ya no necesita más toques?
    if (s.order) {
      if (s.order[this.oi] !== o) {
        this.score(0.1, at);
        this.ui.toast(`Orden incorrecto. Sigue: ${s.labels?.get(s.order[this.oi]) ?? ''}`, 'bad');
        return;
      }
      this.oi++;
    } else if (!need.includes(o)) {
      this.score(0.1, at);
      this.ui.toast('Ese no es.', 'bad');
      return;
    } else if (s.repeat) {
      this.oi++;
      complete = this.oi >= s.repeat;
    } else {
      if (this.hits.has(o)) return;
      this.hits.add(o);
      this.oi = this.hits.size;
    }
    this.score(1, at, true);
    audio.play('click');
    this.busy = true;
    if (complete) {
      const tag = this.tags.find((t) => t.obj === o);
      tag?.t.remove();
      this.tags = this.tags.filter((t) => t !== tag);
    }
    try {
      await s.onHit?.(o);
    } finally {
      this.busy = false;
    }
    this.ui.setProgress(this.oi, this.total(s));
    if (this.oi >= this.total(s)) {
      this.si++;
      if (this.si >= this.steps.length) {
        this.finish();
        return;
      }
      this.showStep();
    }
  }

  protected update(dt: number) {
    for (const { obj, t } of this.tags) {
      if (!obj.visible && obj !== this.ctx.kitchen.terminal) {
        t.el.style.opacity = '0';
        continue;
      }
      t.el.style.opacity = '';
      const p = obj.getWorldPosition(this.tmpP);
      p.y += this.kind === 'goodbye' ? 1.9 : 0.09;
      const sp = this.eng.toScreen(p);
      t.move(sp.x, sp.y);
    }
    if (this.kind === 'stock' && Math.random() < 0.15) this.fx.steam(this.worldOf(new THREE.Vector3(0, 0.3, -0.02)));
    void dt;
  }

  protected cleanup() {
    this.tags.forEach((t) => t.t.remove());
    this.ui.setInstruction('');
    this.ui.setProgress(0, 0);
  }
}

function pick3(a: string[]) {
  return a[Math.floor(Math.random() * a.length)];
}
