import * as THREE from 'three/webgpu';
import { Minigame, type MGContext } from './base';
import { PM, filletGeo, hotelPan, towel, contactShadow, glovedHand } from '../world/props';
import { mats } from '../world/materials';
import { paintCanvas, swordfish, whiteFish } from '../world/textures';
import { tween, ease, clamp, rand } from '../core/tween';
import { audio } from '../core/audio';

type Kind = 'cure' | 'flour' | 'season' | 'clean';

const GRID = 20;

/**
 * Arrastrar para cubrir: curar pez espada con costra de especias, enharinar pescado,
 * sazonar papas, y la limpieza final de la estación (breakdown). El trazo cambia con la
 * velocidad (lento = ancho y cargado, rápido = fino), la mano/trapo se inclina con el movimiento
 * y la limpieza termina con una pasada de secador que deja el acero brillando.
 */
export class CoatGame extends Minigame {
  private kind: Kind;
  private count: number;
  private idx = 0;
  private mesh!: THREE.Mesh;
  private paint!: ReturnType<typeof paintCanvas>;
  private cells = new Uint8Array(GRID * GRID);
  private valid = new Uint8Array(GRID * GRID);
  private validCount = 0;
  private covered = 0;
  private lastUV: THREE.Vector2 | null = null;
  private brushUV = 0.08;
  private tool: THREE.Object3D | null = null;
  private busy = false;
  private holder = new THREE.Group();
  private soundT = 0;
  private itemStart = 0;
  private tp = new THREE.Vector3();
  private uvA = new THREE.Vector2();
  private lastPct = -1;
  private brushK = 1; // multiplicador del pincel según la velocidad
  private milestone = 0;
  private ev = new THREE.Vector3();
  private fallV = new THREE.Vector3(0, -0.5, 0);
  private sudV = new THREE.Vector3(0, 0.08, 0);
  private squeegee: THREE.Group | null = null;
  private glint: THREE.Mesh | null = null;

  constructor(ctx: MGContext) {
    super(ctx);
    this.kind = this.param<Kind>('kind', 'cure');
    this.count = this.param('count', this.kind === 'clean' ? 1 : 2);
    this.par = this.count * (this.kind === 'clean' ? 12 : 7) + 3;
    this.group.add(this.holder);
    if (this.kind === 'flour') {
      const bowl = hotelPan(0.3, 0.22, 0.07);
      bowl.position.set(-0.24, 0, -0.12);
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.04, 0.21), PM.flour);
      f.position.y = 0.025;
      bowl.add(f);
      this.group.add(bowl);
    }
    if (this.kind === 'clean') {
      const t = towel(0.12, 0.1);
      t.position.y = 0.004;
      this.tool = t;
      this.group.add(t);
      // secador de goma para la pasada final
      const sq = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.46), mats().black);
      blade.position.y = 0.01;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.015, 0.44), mats().steelPan);
      bar.position.y = 0.027;
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 6), mats().black);
      handle.rotation.z = -1.0;
      handle.position.set(-0.09, 0.09, 0);
      sq.add(blade, bar, handle);
      sq.visible = false;
      this.squeegee = sq;
      this.group.add(sq);
      // destello: banda blanca aditiva que barre el acero
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 8;
      const g = c.getContext('2d')!;
      const grd = g.createLinearGradient(0, 0, 128, 0);
      grd.addColorStop(0, 'rgba(255,255,255,0)');
      grd.addColorStop(0.5, 'rgba(255,255,255,0.9)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 8);
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.44), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      gl.rotation.x = -Math.PI / 2;
      gl.position.y = 0.004;
      gl.visible = false;
      gl.renderOrder = 6;
      this.glint = gl;
      this.group.add(gl);
    } else {
      // mano que espolvorea (sal, especias, harina)
      const h = glovedHand();
      h.scale.setScalar(0.8);
      h.position.y = 0.12;
      this.tool = h;
      this.group.add(h);
    }
    if (this.kind === 'cure') {
      const tray = hotelPan(0.22, 0.16, 0.05);
      tray.position.set(-0.24, 0, -0.14);
      const spice = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.03, 0.15), new THREE.MeshStandardMaterial({ color: '#a8823a', roughness: 1 }));
      spice.position.y = 0.02;
      tray.add(spice);
      this.group.add(tray);
    }
  }

  protected start() {
    const t = {
      cure: 'Arrastra sobre el pez espada para cubrirlo con la cura. Lento = capa gruesa, rápido = fina.',
      flour: 'Arrastra sobre el pescado para enharinarlo entero. Lento carga más harina.',
      season: 'Arrastra sobre las papas para sazonarlas todas. Barre de lado a lado.',
      clean: 'Frota con el trapo (arrastra) hasta quitar toda la suciedad: luego pasa el secador.',
    }[this.kind];
    this.ui.setInstruction(t);
    this.spawn();
  }

  private spawn() {
    this.holder.clear();
    if (this.mesh) {
      // liberar el lienzo anterior
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.paint.texture.dispose();
    }
    this.lastPct = -1;
    this.milestone = 0;
    if (this.tool) this.tool.visible = true;
    this.cells.fill(0);
    this.valid.fill(0);
    this.covered = 0;
    this.lastUV = null;
    this.itemStart = this.elapsed;
    const size = this.kind === 'clean' ? 512 : 256;
    this.paint = paintCanvas(size);
    const g = this.paint.g;
    let geo: THREE.BufferGeometry;
    let mat: THREE.Material;
    const validFn = (u: number, v: number) => {
      if (this.kind === 'flour') return Math.pow((u - 0.5) / 0.46, 2) + Math.pow((v - 0.5) / 0.32, 2) < 1;
      return true;
    };
    if (this.kind === 'cure') {
      g.drawImage(swordfish().image as HTMLCanvasElement, 0, 0, size, size);
      geo = new THREE.BoxGeometry(0.2, 0.075, 0.11);
      geo.translate(0, 0.0375, 0);
      mat = new THREE.MeshStandardMaterial({ map: this.paint.texture, roughness: 0.7 });
      this.brushUV = 0.11;
    } else if (this.kind === 'flour') {
      g.drawImage(whiteFish().image as HTMLCanvasElement, 0, 0, size, size);
      geo = filletGeo(0.24, 0.1, 0.016);
      mat = new THREE.MeshStandardMaterial({ map: this.paint.texture, roughness: 0.75 });
      this.brushUV = 0.1;
    } else if (this.kind === 'season') {
      // bandeja de papas en gajos dibujada en el canvas (barato y nítido desde arriba)
      g.fillStyle = '#d9d0b4';
      g.fillRect(0, 0, size, size);
      for (let i = 0; i < 46; i++) {
        g.save();
        g.translate(rand(10, size - 10), rand(10, size - 10));
        g.rotate(rand(0, Math.PI));
        g.fillStyle = '#8a5f2c';
        g.beginPath();
        g.ellipse(0, 0, 34, 11, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#f1dc98';
        g.beginPath();
        g.ellipse(0, -2, 31, 8, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      geo = new THREE.PlaneGeometry(0.38, 0.27);
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, 0.04, 0);
      mat = new THREE.MeshStandardMaterial({ map: this.paint.texture, roughness: 0.6 });
      const pan = hotelPan(0.4, 0.29, 0.06);
      this.holder.add(pan);
      this.brushUV = 0.12;
    } else {
      // suciedad sobre el acero: manchas, restos y salpicaduras
      g.clearRect(0, 0, size, size);
      for (let i = 0; i < 60; i++) {
        const x = rand(0, size), y = rand(0, size), r = rand(10, 45);
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        const c = Math.random() < 0.5 ? '120,80,40' : Math.random() < 0.5 ? '200,120,60' : '90,90,80';
        grd.addColorStop(0, `rgba(${c},0.75)`);
        grd.addColorStop(1, `rgba(${c},0)`);
        g.fillStyle = grd;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      for (let i = 0; i < 120; i++) {
        g.fillStyle = Math.random() < 0.5 ? 'rgba(240,140,40,0.9)' : 'rgba(80,140,50,0.9)';
        g.fillRect(rand(0, size), rand(0, size), rand(2, 7), rand(2, 7));
      }
      g.fillStyle = 'rgba(160,150,130,0.22)';
      g.fillRect(0, 0, size, size);
      geo = new THREE.PlaneGeometry(0.62, 0.42);
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, 0.002, 0);
      mat = new THREE.MeshBasicMaterial({ map: this.paint.texture, transparent: true, depthWrite: false });
      this.brushUV = 0.1;
    }
    this.paint.texture.needsUpdate = true;
    this.mesh = new THREE.Mesh(geo, mat);
    this.holder.add(this.mesh);
    if (this.kind !== 'clean') {
      const sh = contactShadow(0.3, 0.2);
      this.holder.add(sh);
    }
    this.validCount = 0;
    for (let y = 0; y < GRID; y++)
      for (let x = 0; x < GRID; x++) {
        const ok = validFn((x + 0.5) / GRID, (y + 0.5) / GRID);
        this.valid[y * GRID + x] = ok ? 1 : 0;
        if (ok) this.validCount++;
      }
    this.holder.position.z = 0.3;
    tween(0.3, (k) => (this.holder.position.z = 0.3 * (1 - k)), ease.outCubic);
    this.ui.setProgress(this.idx, this.count);
    this.busy = false;
  }

  protected onDown() {
    this.lastUV = null;
    this.stroke();
  }

  protected onMove() {
    if (this.eng.pointerDown) this.stroke();
  }

  protected onUp() {
    this.lastUV = null;
  }

  private stroke() {
    if (this.busy) return;
    const hit = this.eng.hit([this.mesh], false)[0];
    if (!hit || !hit.uv) {
      this.lastUV = null;
      return;
    }
    const uv = hit.uv.clone();
    // presión/velocidad: trazo lento = ancho y cargado; rápido = fino
    const sf = clamp(this.pVel.length() / (this.unitPx * 160));
    this.brushK += (1.3 - sf * 0.6 - this.brushK) * 0.5;
    // estampamos a lo largo del trazo para que no haya huecos al mover rápido
    const from = this.lastUV ?? uv;
    const dist = from.distanceTo(uv);
    const steps = Math.max(1, Math.ceil(dist / (this.brushUV * 0.35)));
    for (let i = 1; i <= steps; i++) this.stamp(this.uvA.copy(from).lerp(uv, i / steps));
    this.lastUV = uv;
    this.paint.texture.needsUpdate = true;
    this.soundT -= 1;
    if (this.soundT <= 0) {
      this.soundT = 4;
      audio.play(this.kind === 'clean' ? 'scrape' : 'pour', 0.4);
    }
    this.particles(hit.point, sf);
    const frac = this.covered / this.validCount;
    const ms = Math.floor(Math.min(frac / 0.88, 0.999) * 4);
    if (ms > this.milestone) {
      this.milestone = ms;
      this.fx.sparkle(hit.point, '#fff6c8', 6);
      audio.play('pop', 0.3);
      this.haptic(6);
    }
    const pct = Math.round(clamp(frac / 0.88) * 100);
    if (pct !== this.lastPct) {
      this.lastPct = pct;
      this.ui.setProgress(this.idx + (frac >= 0.88 ? 1 : 0), this.count);
      this.ui.setInstruction(`${this.instrBase()} ${pct}%`);
    }
    if (frac >= 0.88) this.itemDone();
  }

  /** Partículas del trazo: especias que caen de la mano, nubes de harina, espuma y brillo. */
  private particles(at: THREE.Vector3, sf: number) {
    if (this.kind === 'clean') {
      if (Math.random() < 0.4) this.fx.emit({ pos: at, count: 1, spread: 0.04, vel: this.sudV, velSpread: 0.05, life: 0.7, size: 0.012, grow: 0.01, color: '#ffffff', drag: 2 });
      if (Math.random() < 0.2 + sf * 0.3) this.fx.sparkle(at, '#ffffff', 2);
      return;
    }
    const hand = this.tool!;
    this.worldOf(this.ev.set(hand.position.x, hand.position.y - 0.03, hand.position.z), this.ev);
    if (this.kind === 'flour') {
      this.fx.flour(at, 1 + Math.round(sf * 3));
      if (Math.random() < 0.5) this.fx.emit({ pos: this.ev, count: 2, spread: 0.02, vel: this.fallV, velSpread: 0.1, life: 0.3, size: 0.006, color: '#ffffff' });
    } else {
      const col = this.kind === 'cure' ? (Math.random() < 0.5 ? '#8a6a2a' : '#4e5a26') : Math.random() < 0.5 ? '#c4421c' : '#f0c060';
      this.fx.emit({ pos: this.ev, count: 2 + Math.round((1 - sf) * 2), spread: 0.02, vel: this.fallV, velSpread: 0.12, life: 0.28, size: 0.005, gravity: 2, color: col });
    }
  }

  private instrBase() {
    return { cure: 'Costra de cura:', flour: 'Enharinado:', season: 'Sazón:', clean: 'Limpieza:' }[this.kind];
  }

  private stamp(uv: THREE.Vector2) {
    const g = this.paint.g, S = this.paint.canvas.width;
    const bk = this.brushK;
    const x = uv.x * S, y = (1 - uv.y) * S, r = this.brushUV * S * bk;
    if (this.kind === 'clean') {
      g.globalCompositeOperation = 'destination-out';
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(0,0,0,1)');
      grd.addColorStop(0.7, 'rgba(0,0,0,0.9)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
      g.globalCompositeOperation = 'source-over';
    } else if (this.kind === 'flour') {
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,253,248,0.85)');
      grd.addColorStop(1, 'rgba(255,253,248,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    } else {
      // especias: puntitos de colores
      const palette = this.kind === 'cure' ? ['#7a5a22', '#a07c34', '#4e5a26', '#c9a24c', '#3a2a12'] : ['#c4421c', '#e26a2c', '#7a3a12', '#f0c060', '#4e7a2a'];
      const n = Math.round(26 * bk * bk);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
        g.fillStyle = palette[i % palette.length];
        g.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, 2 + Math.random() * 2.5, 2 + Math.random() * 2.5);
      }
      if (this.kind === 'cure') {
        g.fillStyle = 'rgba(150,115,50,0.18)';
        g.beginPath();
        g.arc(x, y, r * 0.8, 0, Math.PI * 2);
        g.fill();
      }
    }
    // cobertura
    const cr = this.brushUV * bk * GRID * 0.75;
    const cx = uv.x * GRID, cy = uv.y * GRID;
    for (let j = Math.max(0, Math.floor(cy - cr)); j <= Math.min(GRID - 1, Math.ceil(cy + cr)); j++)
      for (let i = Math.max(0, Math.floor(cx - cr)); i <= Math.min(GRID - 1, Math.ceil(cx + cr)); i++) {
        const k = j * GRID + i;
        if (this.cells[k] || !this.valid[k]) continue;
        if (Math.hypot(i + 0.5 - cx, j + 0.5 - cy) <= cr) {
          this.cells[k] = 1;
          this.covered++;
        }
      }
  }

  private async itemDone() {
    this.busy = true;
    const t = this.elapsed - this.itemStart;
    const parItem = this.kind === 'clean' ? 11 : 6;
    const q = clamp(1.12 - (t / parItem) * 0.3, 0.35, 1);
    this.score(q, new THREE.Vector3(0, 0.08, 0));
    audio.play('ding', 0.6);
    if (this.kind === 'clean') await this.squeegeePass();
    else {
      this.haptic(12);
      this.squash(this.holder, 0.1, 0.3);
      await tween(0.35, (k) => (this.holder.position.z = -0.5 * k), ease.inCubic);
    }
    this.idx++;
    this.ui.setProgress(this.idx, this.count);
    if (this.idx >= this.count) this.finish();
    else this.spawn();
  }

  /** Pasada del secador: barre de izquierda a derecha, se lleva la suciedad restante y deja un destello. */
  private async squeegeePass() {
    const sq = this.squeegee!, gl = this.glint!;
    const mat = this.mesh.material as THREE.MeshBasicMaterial;
    const gm = gl.material as THREE.MeshBasicMaterial;
    if (this.tool) this.tool.visible = false;
    sq.visible = gl.visible = true;
    audio.play('scrape', 0.9);
    let lastX = -1;
    await tween(0.65, (k) => {
      const x = -0.34 + k * 0.68;
      sq.position.set(x, 0.003, 0);
      gl.position.x = x - 0.06;
      gm.opacity = Math.sin(Math.min(1, k * 1.2) * Math.PI) * 0.9;
      mat.opacity = 1 - k;
      if (x - lastX > 0.08) {
        lastX = x;
        this.fx.sparkle(this.worldOf(this.ev.set(x - 0.03, 0.01, rand(-0.18, 0.18))), '#ffffff', 5);
      }
    }, ease.inOutCubic);
    this.haptic([10, 30, 10]);
    this.eng.shake(0.15);
    audio.play('good', 0.5);
    sq.visible = gl.visible = false;
  }

  protected update(dt: number) {
    const t = this.tool;
    if (!t || !t.visible) return;
    const clean = this.kind === 'clean';
    const p = this.pointerLocal(clean ? 0.004 : 0.08, this.tp);
    const kk = Math.min(1, dt * 20);
    t.position.x += (p.x - t.position.x) * kk;
    t.position.z += (p.z - (clean ? 0 : 0.02) - t.position.z) * kk;
    const down = this.eng.pointerDown;
    // se inclina con el movimiento (y se "aplasta" el trapo al frotar)
    const vx = clamp(this.pVel.x * 0.0005, -0.5, 0.5), vz = clamp(this.pVel.y * 0.0005, -0.5, 0.5);
    const decay = down ? 1 : 0;
    if (clean) {
      t.position.y = down ? 0.004 : 0.02;
      t.rotation.z += (-vx * 0.4 * decay - t.rotation.z) * kk;
      t.rotation.x += (vz * 0.4 * decay - t.rotation.x) * kk;
      const sp = clamp(this.pVel.length() / (this.unitPx * 160)) * decay;
      t.scale.set(1 + sp * 0.15, 1, 1 - sp * 0.1);
    } else {
      t.position.y += ((down ? 0.1 : 0.14) + Math.sin(this.elapsed * 5) * 0.004 - t.position.y) * kk;
      t.rotation.z += (0.25 - vx * decay - t.rotation.z) * kk;
      t.rotation.x += (vz * decay - t.rotation.x) * kk;
      // "sacudida" de muñeca al espolvorear
      if (down) t.rotation.y = Math.sin(this.elapsed * 22) * 0.12;
    }
    if (!down) {
      this.pVel.multiplyScalar(Math.max(0, 1 - dt * 8));
      this.brushK += (1 - this.brushK) * Math.min(1, dt * 4);
    }
  }

  protected cleanup() {
    this.ui.setInstruction('');
    this.ui.setProgress(0, 0);
  }
}
