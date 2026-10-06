import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mats, metalMats, type Mats } from './materials';
import { labelTex, terminalScreen, hotPlateTex } from './textures';
import { Cook } from './cook';

export type StationId = 'entrada' | 'prep' | 'frio' | 'estufa' | 'freidora' | 'ahumador' | 'camara' | 'oficina';

export interface Station {
  id: StationId;
  name: string;
  /** Punto de trabajo (centro de la escena del minijuego). */
  work: THREE.Vector3;
  /** Desde dónde mira la cámara, relativo a work. */
  eye: THREE.Vector3;
  fov: number;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export const TOP = 0.9; // altura de mesada

export const STATIONS: Record<StationId, Station> = {
  entrada: { id: 'entrada', name: 'Vestidor', work: V(-2.8, 1.3, 4.85), eye: V(0, 0.25, -1.05), fov: 60 },
  prep: { id: 'prep', name: 'Mesa de prep', work: V(0, TOP + 0.02, 0.05), eye: V(0, 0.6, 0.5), fov: 58 },
  frio: { id: 'frio', name: 'Garde manger', work: V(-3, TOP + 0.02, -4.55), eye: V(0, 0.6, 0.5), fov: 58 },
  estufa: { id: 'estufa', name: 'Estufa', work: V(-6.3, TOP + 0.05, -0.75), eye: V(0.62, 0.7, 0), fov: 58 },
  freidora: { id: 'freidora', name: 'Freidora', work: V(-6.3, TOP, 1.0), eye: V(0.62, 0.66, 0), fov: 58 },
  ahumador: { id: 'ahumador', name: 'Ahumado', work: V(4.6, TOP + 0.02, -4.55), eye: V(0, 0.6, 0.5), fov: 58 },
  camara: { id: 'camara', name: 'Cámara fría', work: V(5.7, TOP + 0.05, -0.6), eye: V(-0.75, 0.6, 0), fov: 60 },
  oficina: { id: 'oficina', name: 'Oficina', work: V(3.8, TOP + 0.1, 4.6), eye: V(0, 0.55, -0.6), fov: 58 },
};

/** Plano general elevado (fin del día / menú): la cocina entera vista desde la pared de entrada. */
export const OVERVIEW = { pos: V(0.6, 2.85, 4.7), look: V(-0.3, 0.5, -0.9), fov: 62 };

function uvScale(g: THREE.BufferGeometry, sx: number, sy: number) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  return g;
}

/** Huella en planta de un obstáculo (para colisiones y navegación del jugador). */
export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();

/** Junta geometrías estáticas por material y las fusiona: ~1 draw call por material. */
class Batch {
  private groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  /** Materiales que no proyectan sombra (piso, paredes, techo, luces, campanas). */
  noCast = new Set<THREE.Material>();
  meshes: THREE.Mesh[] = [];
  add(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
    const g = geo.clone();
    if (g.index === null) return;
    const m = new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s);
    g.applyMatrix4(m);
    let arr = this.groups.get(mat);
    if (!arr) this.groups.set(mat, (arr = []));
    arr.push(g);
  }
  box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, ry = 0) {
    this.add(G.box(w, h, d), mat, x, y, z, ry);
  }
  cyl(rt: number, rb: number, h: number, mat: THREE.Material, x: number, y: number, z: number, seg = 16, rx = 0, rz = 0) {
    this.add(G.cyl(rt, rb, h, seg), mat, x, y, z, 0, rx, rz);
  }
  build(parent: THREE.Object3D) {
    for (const [mat, geos] of this.groups) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = !this.noCast.has(mat);
      mesh.receiveShadow = !(mat instanceof THREE.MeshBasicMaterial);
      parent.add(mesh);
      this.meshes.push(mesh);
    }
    this.groups.clear();
  }
}

/** Caché de geometrías primitivas (las clonamos al fusionar; así no creamos cientos iguales). */
const G = {
  cache: new Map<string, THREE.BufferGeometry>(),
  get(key: string, make: () => THREE.BufferGeometry) {
    let g = this.cache.get(key);
    if (!g) this.cache.set(key, (g = make()));
    return g;
  },
  box(w: number, h: number, d: number) {
    return this.get(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
  },
  cyl(rt: number, rb: number, h: number, seg = 16) {
    return this.get(`c${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
  },
};

/** Pseudoaleatorio determinista (la cocina se ve igual en cada carga). */
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

export class Kitchen {
  root = new THREE.Group();
  cooks: Cook[] = [];
  chef!: Cook;
  terminal!: THREE.Mesh;
  lockers!: THREE.Mesh;
  printer!: THREE.Mesh;
  frenchTop = V(-6.3, TOP + 0.04, -0.75);
  m: Mats;
  /** Luz principal (la configura render.ts: sombras y seguimiento de la cámara). */
  key: THREE.DirectionalLight;
  /** Huellas en planta de todo lo que bloquea el paso (más las 4 paredes). */
  colliders: Collider[] = [];
  private flameLight: THREE.PointLight;
  private home: { x: number; z: number; ry: number; work: Cook['work'] }[] = [];

  constructor(private scene: THREE.Scene, renderer: THREE.WebGPURenderer) {
    this.m = mats();
    seed = 7;
    scene.background = new THREE.Color('#dfe3e6');
    scene.fog = new THREE.Fog('#dfe3e6', 12, 30);
    this.buildEnvironment(renderer);
    const b = new Batch();
    const m = this.m;
    for (const mt of [m.floor, m.tile, m.ceiling, m.light, m.steelHood, m.rubberMat, m.drain, m.lampGlow, m.heatLamp, m.ticket]) b.noCast.add(mt);
    this.buildRoom(b);
    this.buildPrep(b);
    this.buildColdLine(b);
    this.buildRange(b);
    this.buildRight(b);
    this.buildFront(b);
    this.buildPass(b);
    b.build(this.root);
    this.buildDynamic();
    this.buildCooks();
    this.buildColliders();

    // Luz fría de fluorescentes: cielo blanco azulado, rebote cálido del piso de gres.
    const hemi = new THREE.HemisphereLight('#f3f6ff', '#b9ab9b', 0.22);
    scene.add(hemi);
    this.key = new THREE.DirectionalLight('#fbfaf6', 1.9);
    this.key.name = 'key';
    this.key.position.set(-3.2, 6.5, 4.6);
    this.key.target.position.set(0, 0, 0);
    scene.add(this.key, this.key.target);
    this.flameLight = new THREE.PointLight('#ff8a3a', 0, 3, 2);
    scene.add(this.flameLight);
    scene.add(this.root);
  }

  /** Mapa de entorno "cocina con fluorescentes" para que el acero refleje brillante y limpio. */
  private buildEnvironment(renderer: THREE.WebGPURenderer) {
    const env = new THREE.Scene();
    const room = new THREE.Mesh(new THREE.BoxGeometry(14, 3.2, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.52, 1.56), side: THREE.BackSide }));
    room.position.y = 0.1; // la cámara del PMREM está en el origen: sala centrada en y≈0
    env.add(room);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.5, 0.46) }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.45;
    env.add(floor);
    const lm = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 9.2, 9.6) });
    for (let x = -5; x <= 5; x += 2.5)
      for (let z = -3.5; z <= 3.5; z += 2.3) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.5), lm);
        p.rotation.x = Math.PI / 2;
        p.position.set(x, 1.65, z);
        env.add(p);
      }
    // Paredes de azulejo blanco con una franja de equipos más oscura abajo (da "lectura" al metal)
    const wall = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.6, 2.65) });
    const band = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.37, 0.4) });
    for (const [x, z, ry] of [[0, -4.95, 0], [0, 4.95, Math.PI], [-6.95, 0, Math.PI / 2], [6.95, 0, -Math.PI / 2]] as const) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.4), wall);
      w.position.set(x, 0.55, z);
      w.rotation.y = ry;
      env.add(w);
      const bd = new THREE.Mesh(new THREE.PlaneGeometry(12, 0.5), band);
      bd.position.set(x, -0.6, z);
      bd.rotation.y = ry;
      env.add(bd);
    }
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(env, 0.02).texture;
    this.scene.environment = envTex;
    this.scene.environmentIntensity = 0.32;
    // El acero usa el mismo entorno pero más intenso: reflejos limpios de fluorescentes y azulejo
    for (const mt of metalMats(this.m)) {
      mt.envMap = envTex;
      mt.envMapIntensity = 0.62;
    }
  }

  private buildRoom(b: Batch) {
    const m = this.m;
    const floor = new THREE.PlaneGeometry(14, 10);
    floor.rotateX(-Math.PI / 2);
    b.add(floor, m.floor, 0, 0, 0);
    const ceil = new THREE.PlaneGeometry(14, 10);
    ceil.rotateX(Math.PI / 2);
    b.add(ceil, m.ceiling, 0, 3, 0);
    // Paredes de azulejo
    const wallZ = uvScale(new THREE.PlaneGeometry(14, 3), 14 / 0.6, 3 / 0.6);
    b.add(wallZ, m.tile, 0, 1.5, -5);
    b.add(wallZ, m.tile, 0, 1.5, 5, Math.PI);
    const wallX = uvScale(new THREE.PlaneGeometry(10, 3), 10 / 0.6, 3 / 0.6);
    b.add(wallX, m.tile, -7, 1.5, 0, Math.PI / 2);
    b.add(wallX, m.tile, 7, 1.5, 0, -Math.PI / 2);
    // Zócalo sanitario de acero en las 4 paredes
    b.box(14, 0.12, 0.02, m.steelDark, 0, 0.06, -4.99);
    b.box(14, 0.12, 0.02, m.steelDark, 0, 0.06, 4.99);
    b.box(0.02, 0.12, 10, m.steelDark, -6.99, 0.06, 0);
    b.box(0.02, 0.12, 10, m.steelDark, 6.99, 0.06, 0);
    // Luminarias fluorescentes empotradas y rejillas: planos que miran hacia abajo, así desde una
    // cámara por encima del techo (vista "casa de muñecas") no tapan nada.
    const down = (w: number, d: number) => G.get(`down${w}|${d}`, () => new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2));
    for (let x = -5; x <= 5; x += 2.5)
      for (let z = -3.5; z <= 3.5; z += 2.3) {
        b.add(down(1.2, 0.6), m.steelHood, x, 2.996, z);
        b.add(down(1.1, 0.5), m.light, x, 2.99, z);
      }
    for (const [x, z] of [[-2.5, 1], [2.5, -1.2], [0, 3.6]]) b.add(down(0.6, 0.6), m.steelHood, x, 2.995, z);
    // Alfombras antifatiga frente a cada estación
    const mat = (w: number, d: number, x: number, z: number) => b.add(uvScale(new THREE.BoxGeometry(w, 0.014, d), w / 2.4, d / 0.8), m.rubberMat, x, 0.007, z);
    mat(2.2, 0.62, 0, 0.92);
    mat(2.6, 0.62, -2.6, -3.82);
    mat(0.62, 3.0, -5.6, -0.2);
    mat(1.8, 0.62, 4.6, -3.82);
    mat(1.6, 0.6, -1.8, 2.25);
    // Desagües de piso
    for (const [x, z] of [[-4.9, 1.9], [-1.0, -2.3], [3.1, -2.4], [1.2, 3.75]]) {
      b.box(0.34, 0.006, 0.34, m.drain, x, 0.003, z);
    }
  }

  /** Mesa: tablero de acero con estante inferior y patas. */
  private table(b: Batch, cx: number, cz: number, w: number, d: number, ry = 0, shelf = true) {
    const m = this.m;
    const c = Math.cos(ry), s = Math.sin(ry);
    const P = (lx: number, lz: number) => [cx + lx * c + lz * s, cz - lx * s + lz * c] as const;
    let [x, z] = P(0, 0);
    b.box(w, 0.04, d, m.steel, x, TOP - 0.02, z, ry);
    // borde frontal (marine edge)
    [x, z] = P(0, d / 2 - 0.01);
    b.box(w, 0.06, 0.02, m.steel, x, TOP - 0.04, z, ry);
    if (shelf) {
      [x, z] = P(0, 0);
      b.box(w - 0.08, 0.02, d - 0.08, m.steelDark, x, 0.25, z, ry);
    }
    for (const lx of [-w / 2 + 0.05, w / 2 - 0.05])
      for (const lz of [-d / 2 + 0.05, d / 2 - 0.05]) {
        [x, z] = P(lx, lz);
        b.cyl(0.02, 0.02, TOP - 0.04, m.steelDark, x, (TOP - 0.04) / 2, z, 8);
        b.cyl(0.03, 0.025, 0.04, m.steelDark, x, 0.02, z, 8);
      }
  }

  /** Cubeta (inserto) de acero con comida a ras. */
  private insert(b: Batch, w: number, d: number, h: number, food: THREE.Material | null, x: number, y: number, z: number) {
    const m = this.m;
    b.box(w, h, d, m.steelPan, x, y + h / 2, z);
    if (food) {
      const mound = G.get(`mound${w}|${d}`, () => {
        const g = new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
        g.scale(w - 0.01, 0.045, d - 0.01);
        return g;
      });
      b.add(mound, food, x, y + h - 0.006, z);
    } else b.box(w - 0.02, 0.002, d - 0.02, m.steelDark, x, y + h + 0.001, z);
  }

  /** Bandeja (sheet tray) de aluminio con borde. */
  private sheetTray(b: Batch, w: number, d: number, x: number, y: number, z: number, ry = 0) {
    const m = this.m;
    b.box(w, 0.006, d, m.aluminum, x, y + 0.003, z, ry);
    const c = Math.cos(ry), s = Math.sin(ry);
    b.box(w, 0.022, 0.008, m.aluminum, x + (d / 2) * s, y + 0.011, z + (d / 2) * c, ry);
    b.box(w, 0.022, 0.008, m.aluminum, x - (d / 2) * s, y + 0.011, z - (d / 2) * c, ry);
    b.box(0.008, 0.022, d, m.aluminum, x + (w / 2) * c, y + 0.011, z - (w / 2) * s, ry);
    b.box(0.008, 0.022, d, m.aluminum, x - (w / 2) * c, y + 0.011, z + (w / 2) * s, ry);
  }

  /** Deli de un cuarto (pinta) con relleno y cinta de etiqueta. */
  private deli(b: Batch, fill: THREE.Material, x: number, y: number, z: number, level = 0.75) {
    const m = this.m;
    const h = 0.11;
    b.cyl(0.054, 0.048, h * level, fill, x, y + (h * level) / 2, z, 12);
    b.cyl(0.06, 0.054, h, m.plastic, x, y + h / 2, z, 14);
    b.box(0.05, 0.02, 0.004, m.greenTape, x, y + h * 0.6, z + 0.058);
  }

  /** Pila de platos. */
  private plates(b: Batch, n: number, x: number, y: number, z: number, r = 0.13) {
    for (let i = 0; i < n; i++) b.cyl(r, r * 0.8, 0.016, this.m.ceramic, x, y + 0.008 + i * 0.017, z, 20);
  }

  /** Comandas colgadas de un riel (mirando hacia +z, girado ry). */
  private tickets(b: Batch, x0: number, x1: number, y: number, z: number, n: number) {
    const m = this.m;
    b.box(x1 - x0, 0.02, 0.025, m.steel, (x0 + x1) / 2, y, z);
    for (let i = 0; i < n; i++) {
      const x = x0 + 0.1 + ((x1 - x0 - 0.2) * (i + rnd() * 0.4)) / n;
      const g = new THREE.PlaneGeometry(0.075, 0.13);
      // cada comanda usa una de las dos del atlas
      uvAtlas(g, rnd() < 0.5 ? 0 : 0.5);
      b.add(g, m.ticket, x, y - 0.072, z + 0.015, 0, -0.08 + rnd() * 0.05, (rnd() - 0.5) * 0.08);
    }
  }

  private buildPrep(b: Batch) {
    const m = this.m;
    this.table(b, 0, 0, 3.2, 1.0);
    // Contenedores bajo la mesa (racks azules/marrones)
    b.box(0.5, 0.18, 0.4, m.blueRack, -1, 0.36, 0);
    b.box(0.5, 0.18, 0.4, m.brownRack, -0.4, 0.36, 0);
    b.box(0.5, 0.18, 0.4, m.blueRack, 0.6, 0.36, 0.1);
    b.cyl(0.18, 0.16, 0.2, m.cambro, 1.15, 0.36, -0.05, 16);
    // Tabla de picar fija + toalla húmeda debajo
    b.box(0.62, 0.02, 0.42, m.board, 0, TOP + 0.01, 0.05);
    b.box(0.3, 0.006, 0.3, m.towel, 0.55, TOP + 0.003, 0.15);
    // Media bandeja con 6 cubetas de mise en place (lado lejano izquierdo)
    this.sheetTray(b, 0.48, 0.34, -1.05, TOP, -0.22);
    const fills = [m.fCarrot, m.fShallot, m.fChive, m.fLemon, m.fPepper, m.fCream];
    for (let i = 0; i < 6; i++) this.insert(b, 0.14, 0.15, 0.065, fills[i], -1.21 + (i % 3) * 0.16, TOP + 0.006, -0.3 + Math.floor(i / 3) * 0.16);
    // Bandeja con porciones de pescado sobre papel (lado lejano derecho)
    this.sheetTray(b, 0.48, 0.34, 0.95, TOP, -0.22);
    b.box(0.44, 0.002, 0.3, m.white, 0.95, TOP + 0.008, -0.22);
    for (let i = 0; i < 6; i++) b.box(0.11, 0.025, 0.07, m.fFish, 0.8 + (i % 3) * 0.15, TOP + 0.02, -0.29 + Math.floor(i / 3) * 0.14);
    // Delis de hierbas
    this.deli(b, m.fHerb, 1.32, TOP, 0.25);
    this.deli(b, m.fChive, 1.18, TOP, 0.32);
    this.deli(b, m.fShallot, 1.46, TOP, 0.33, 0.55);
    // Platos y bowl de acero
    this.plates(b, 6, -1.38, TOP, 0.24, 0.12);
    const bowl = G.get('bowl', () => new THREE.SphereGeometry(0.13, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2));
    b.add(bowl, m.steelPan, -0.85, TOP + 0.13, 0.22);
    // Estante superior (sobre la isla) con cubetas y riel de comandas
    for (const x of [-1.3, 1.3]) b.cyl(0.012, 0.012, 1.3, m.steelDark, x, TOP + 0.65, -0.45, 6);
    b.box(2.8, 0.02, 0.32, m.steel, 0, TOP + 0.7, -0.45);
    const top = [m.fBeet, m.fMush, m.fCarrot, m.fHerb, m.fLemon, m.fCream];
    for (let i = 0; i < 6; i++) this.insert(b, 0.3, 0.25, 0.1, top[i], -1.1 + i * 0.44, TOP + 0.71, -0.45);
    this.tickets(b, -1.25, 1.25, TOP + 0.68, -0.3, 6);
  }

  private buildColdLine(b: Batch) {
    const m = this.m;
    // Refrigeradores bajo mostrador (garde manger)
    b.box(4.4, TOP - 0.04, 0.7, m.steel, -2.8, (TOP - 0.04) / 2, -4.6);
    b.box(4.4, 0.04, 0.72, m.steel, -2.8, TOP - 0.02, -4.6);
    for (let i = 0; i < 4; i++) {
      const x = -4.5 + i * 1.12;
      b.box(1.05, 0.62, 0.02, m.steelPan, x, 0.48, -4.24);
      b.box(0.5, 0.025, 0.04, m.steelDark, x, 0.74, -4.21);
      b.box(0.9, 0.04, 0.01, m.black, x, 0.14, -4.245);
    }
    // Riel de cubetas refrigeradas con mise en place de colores
    b.box(4.2, 0.03, 0.22, m.steelDark, -2.8, TOP + 0.01, -4.85);
    const rail = [m.fPepper, m.fHerb, m.fCream, m.fCarrot, m.fBeet, m.fLemon, m.fChive, m.fShallot, m.fMush];
    for (let i = 0; i < 9; i++) this.insert(b, 0.32, 0.17, 0.05, rail[i], -4.7 + i * 0.47, TOP + 0.015, -4.85);
    // Tabla en garde manger + toalla
    b.box(0.6, 0.02, 0.4, m.board, -3, TOP + 0.01, -4.5);
    b.box(0.28, 0.006, 0.26, m.towel, -2.45, TOP + 0.003, -4.42);
    this.plates(b, 5, -4.4, TOP, -4.45, 0.12);
    this.deli(b, m.fHerb, -1.25, TOP, -4.42);
    this.deli(b, m.fCream, -1.1, TOP, -4.5, 0.5);
    // Estantes de pared con delis llenos y cubetas
    b.box(4.4, 0.02, 0.3, m.steel, -2.8, 1.75, -4.85);
    b.box(4.4, 0.02, 0.3, m.steel, -2.8, 2.15, -4.85);
    const shelfFill = [m.fHerb, m.fCream, m.fLemon, m.fChive, m.fPepper, m.fMush];
    for (let i = 0; i < 12; i++) {
      this.deli(b, shelfFill[i % 6], -4.8 + i * 0.36, 1.76, -4.85, 0.5 + rnd() * 0.4);
      if (i % 2) this.insert(b, 0.3, 0.22, 0.1, null, -4.7 + i * 0.36, 2.16, -4.85);
    }
    // Combis (hornos) contra la pared trasera derecha
    for (const x of [0.9, 2.1]) {
      b.box(1.0, 0.7, 0.85, m.steel, x, 0.35, -4.5);
      b.box(1.0, 0.95, 0.85, m.steel, x, 1.2, -4.5);
      b.box(0.62, 0.62, 0.02, m.blackGlass, x - 0.1, 1.2, -4.07);
      b.box(0.2, 0.5, 0.02, m.black, x + 0.36, 1.25, -4.07);
      b.box(0.04, 0.5, 0.05, m.steelDark, x + 0.23, 1.2, -4.03);
      b.box(0.14, 0.04, 0.01, m.heatLamp, x + 0.36, 1.42, -4.058);
    }
    // Campana sobre combis (no proyecta sombra)
    b.box(2.6, 0.4, 1.1, m.steelHood, 1.5, 2.5, -4.4);
    // Carro de bandejas (speed rack) entre combis y ahumador
    this.speedRack(b, 3.05, -4.62, 0);
    // Mesa de ahumado con ahumador y sartenes colgadas
    this.table(b, 4.6, -4.55, 2.2, 0.8);
    b.box(0.6, 0.02, 0.4, m.board, 5.4, TOP + 0.01, -4.5);
    b.box(0.5, 0.34, 0.4, m.black, 3.85, TOP + 0.17, -4.72);
    b.box(0.52, 0.03, 0.42, m.steelDark, 3.85, TOP + 0.355, -4.72);
    b.cyl(0.03, 0.03, 0.3, m.steelDark, 3.75, TOP + 0.5, -4.82, 8);
    b.box(4.4 - 2.4, 0.02, 0.02, m.steelDark, 4.6, 1.98, -4.97);
    const pan = G.get('pan', () => new THREE.CylinderGeometry(0.13, 0.11, 0.045, 20).rotateX(Math.PI / 2));
    const panSmall = G.get('panS', () => new THREE.CylinderGeometry(0.1, 0.085, 0.04, 18).rotateX(Math.PI / 2));
    [[3.85, pan, m.copper], [4.25, panSmall, m.steelPan], [4.62, pan, m.steelPan], [5.0, panSmall, m.copper], [5.35, pan, m.copper]].forEach(([x, g, mt]) => {
      const gg = g as THREE.BufferGeometry;
      const r = gg === pan ? 0.13 : 0.1;
      b.add(gg, mt as THREE.Material, x as number, 1.72 - r, -4.94);
      b.box(0.025, 0.2, 0.01, mt as THREE.Material, x as number, 1.82, -4.95);
    });
    // Cucharones colgados
    for (const x of [5.55, 5.65]) {
      b.box(0.012, 0.32, 0.008, m.steelPan, x, 1.8, -4.96);
      b.add(G.get('ladle', () => new THREE.SphereGeometry(0.04, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)), m.steelPan, x, 1.66, -4.93);
    }
    // Basurero entre la línea fría y los combis
    this.brute(b, -0.1, -4.62);
  }

  /** Carro alto de bandejas (speed rack). */
  private speedRack(b: Batch, x: number, z: number, ry: number) {
    const m = this.m;
    const w = 0.52, d = 0.68, h = 1.7;
    for (const dx of [-w / 2, w / 2])
      for (const dz of [-d / 2, d / 2]) {
        b.box(0.025, h, 0.025, m.aluminum, x + dx, h / 2 + 0.08, z + dz);
        b.cyl(0.04, 0.04, 0.05, m.black, x + dx, 0.04, z + dz, 10);
      }
    b.box(w, 0.02, d, m.aluminum, x, h + 0.08, z, ry);
    const fills = [m.fFish, null, m.fCream, m.fCarrot, null, m.fMush, null, m.fHerb, null, null];
    for (let i = 0; i < 10; i++) {
      const y = 0.25 + i * 0.15;
      this.sheetTray(b, 0.46, 0.66, x, y, z, Math.PI / 2 + ry);
      const f = fills[i];
      if (f) for (let k = 0; k < 4; k++) b.box(0.1, 0.03, 0.12, f, x - 0.12 + (k % 2) * 0.24, y + 0.02, z - 0.15 + Math.floor(k / 2) * 0.3);
    }
  }

  /** Bote de basura gris (tipo Brute). */
  private brute(b: Batch, x: number, z: number) {
    const m = this.m;
    b.cyl(0.25, 0.22, 0.72, m.brute, x, 0.36, z, 18);
    b.cyl(0.265, 0.265, 0.04, m.brute, x, 0.72, z, 18);
    b.cyl(0.235, 0.235, 0.01, m.black, x, 0.735, z, 18);
  }

  private buildRange(b: Batch) {
    const m = this.m;
    // Bloque de cocina (estufa francesa + freidora) contra la pared izquierda
    b.box(0.95, TOP - 0.05, 3.6, m.steel, -6.45, (TOP - 0.05) / 2, -0.2);
    for (let i = 0; i < 4; i++) {
      b.box(0.02, 0.6, 0.8, m.steelPan, -5.97, 0.42, -1.6 + i * 0.9);
      b.box(0.03, 0.03, 0.4, m.steelDark, -5.95, 0.66, -1.6 + i * 0.9);
    }
    // Perillas a lo largo del frente
    for (let i = 0; i < 9; i++) b.cyl(0.025, 0.025, 0.03, m.black, -5.96, 0.8, -1.8 + i * 0.4, 10, 0, Math.PI / 2);
    b.box(0.03, 0.05, 3.6, m.steelDark, -5.97, 0.8, -0.2);
    // Plancha francesa (hierro) con anillos concéntricos
    // Hierro curado, con el centro un poco más caliente (brillo tenue)
    const iron = new THREE.MeshStandardMaterial({ color: '#57514c', metalness: 0.7, roughness: 0.45, emissive: '#ff5a1e', emissiveMap: hotPlateTex(), emissiveIntensity: 0.22 });
    if (this.scene.environment) {
      iron.envMap = this.scene.environment;
      iron.envMapIntensity = 0.5;
    }
    const ironBody = new THREE.MeshStandardMaterial({ color: '#57514c', metalness: 0.7, roughness: 0.45, envMap: iron.envMap, envMapIntensity: 0.5 });
    b.box(0.9, 0.05, 1.7, ironBody, -6.45, TOP - 0.02, -0.75);
    b.add(G.get('ironTop', () => new THREE.PlaneGeometry(0.9, 1.7).rotateX(-Math.PI / 2)), iron, -6.45, TOP + 0.0055, -0.75);
    for (const r of [0.08, 0.17, 0.26]) {
      const ring = G.get(`ring${r}`, () => new THREE.TorusGeometry(r, 0.006, 4, 40).rotateX(Math.PI / 2));
      b.add(ring, m.steelDark, -6.4, TOP + 0.006, -0.75);
    }
    // Freidora
    b.box(0.9, 0.05, 0.9, m.steel, -6.45, TOP - 0.02, 1.0);
    const oilMat = new THREE.MeshStandardMaterial({ color: '#c08a26', metalness: 0.2, roughness: 0.08, emissive: '#5a3400' });
    b.box(0.56, 0.012, 0.62, oilMat, -6.4, TOP + 0.006, 1.0);
    b.box(0.6, 0.03, 0.02, m.steelPan, -6.4, TOP + 0.015, 0.68);
    b.box(0.6, 0.03, 0.02, m.steelPan, -6.4, TOP + 0.015, 1.32);
    b.box(0.02, 0.03, 0.66, m.steelPan, -6.71, TOP + 0.015, 1.0);
    b.box(0.02, 0.03, 0.66, m.steelPan, -6.09, TOP + 0.015, 1.0);
    b.box(0.9, 0.3, 0.06, m.steel, -6.85, TOP + 0.13, 1.0);
    // Salamandra / estantes sobre la estufa
    b.box(0.5, 0.02, 3.4, m.steel, -6.75, 1.6, -0.2);
    for (let i = 0; i < 8; i++) b.cyl(0.09, 0.09, 0.03, m.ceramic, -6.75, 1.63 + (i % 4) * 0.03, -1.4 + Math.floor(i / 4) * 0.5, 16);
    for (let i = 0; i < 3; i++) this.insert(b, 0.3, 0.17, 0.1, null, -6.75, 1.61, 0.4 + i * 0.36);
    // Campana extractora (angosta y alta: no tapa al jugador desde la cámara de seguimiento)
    b.box(1.1, 0.5, 3.9, m.steelHood, -6.45, 2.55, -0.2);
    b.box(1.04, 0.02, 3.8, m.steelDark, -6.45, 2.3, -0.2);
    for (let i = 0; i < 6; i++) b.box(0.3, 0.01, 0.55, m.black, -6.2, 2.29, -1.9 + i * 0.6);
    // Ollas en la estufa (decorado): fondo de caldo, salsera de cobre
    b.add(G.get('potOpen', () => new THREE.CylinderGeometry(0.16, 0.15, 0.22, 24, 1, true)), m.steelPan, -6.6, TOP + 0.13, -1.45);
    b.cyl(0.155, 0.155, 0.01, m.fMush, -6.6, TOP + 0.2, -1.45, 20);
    b.cyl(0.11, 0.1, 0.09, m.copper, -6.55, TOP + 0.05, 0.2, 18);
    b.cyl(0.1, 0.1, 0.01, m.fPepper, -6.55, TOP + 0.085, 0.2, 16);
    b.box(0.2, 0.015, 0.025, m.copper, -6.32, TOP + 0.08, 0.2);
    // Cubeta de servicio con pinzas junto a la freidora
    this.insert(b, 0.3, 0.26, 0.065, null, -6.65, TOP, 1.9 - 0.25);
  }

  private buildRight(b: Batch) {
    const m = this.m;
    // Puerta de la cámara fría (walk-in) con ventanilla
    b.box(0.08, 2.4, 1.8, m.steel, 6.96, 1.2, -1.0);
    b.box(0.06, 2.1, 1.0, m.steelPan, 6.9, 1.1, -1.0);
    b.box(0.02, 0.3, 0.3, m.blackGlass, 6.865, 1.6, -1.0);
    b.box(0.08, 0.06, 0.25, m.black, 6.84, 1.1, -0.65);
    b.box(0.02, 0.06, 0.12, m.steelDark, 6.86, 1.95, -1.3);
    // Carrito de entregas
    b.box(0.9, 0.03, 0.6, m.steel, 5.7, TOP - 0.06, -0.6);
    b.box(0.86, 0.02, 0.56, m.steelDark, 5.7, 0.2, -0.6);
    for (const dx of [-0.42, 0.42])
      for (const dz of [-0.27, 0.27]) {
        b.cyl(0.015, 0.015, TOP - 0.1, m.steelDark, 5.7 + dx, (TOP - 0.1) / 2 + 0.03, -0.6 + dz, 6);
        b.cyl(0.035, 0.035, 0.04, m.black, 5.7 + dx, 0.03, -0.6 + dz, 10);
      }
    // Tarima con cambros (contenedores grandes) junto al almacén
    b.box(0.62, 0.05, 0.62, m.aluminum, 6.5, 0.2, 0.65);
    for (const dx of [-0.25, 0.25]) for (const dz of [-0.25, 0.25]) b.box(0.04, 0.18, 0.04, m.aluminum, 6.5 + dx, 0.09, 0.65 + dz);
    const camFill = [m.fCream, m.fCarrot, m.fHerb, m.fMush];
    for (let i = 0; i < 4; i++) {
      const x = 6.35 + (i % 2) * 0.3, z = 0.5 + Math.floor(i / 2) * 0.3;
      b.box(0.24, 0.22, 0.24, camFill[i], x, 0.34, z);
      b.box(0.28, 0.34, 0.28, m.cambro, x, 0.395, z);
      b.box(0.29, 0.025, 0.29, m.lidRed, x, 0.575, z);
    }
    b.box(0.28, 0.34, 0.28, m.cambro, 6.5, 0.77, 0.65);
    b.box(0.24, 0.24, 0.24, m.fLemon, 6.5, 0.73, 0.65);
    b.box(0.29, 0.025, 0.29, m.lidRed, 6.5, 0.955, 0.65);
    // Almacén seco: estanterías con latas (las latas son instanciadas aparte)
    for (const y of [0.3, 0.75, 1.2, 1.65, 2.1]) b.box(0.5, 0.02, 2.6, m.steelDark, 6.7, y, 2.3);
    for (const dz of [-1.28, 1.28]) for (const dx of [-0.23, 0.23]) b.cyl(0.012, 0.012, 2.2, m.steelDark, 6.7 + dx, 1.1, 2.3 + dz, 6);
    // Racks azules apilados
    for (let i = 0; i < 4; i++) b.box(0.5, 0.2, 0.5, i % 2 ? m.brownRack : m.blueRack, 5.9, 0.1 + i * 0.21, 3.9);
    // Speed rack en la esquina
    this.speedRack(b, 6.55, 4.55, 0);
  }

  private buildFront(b: Batch) {
    const m = this.m;
    // Puerta de entrada y lockers
    b.box(1.0, 2.15, 0.06, m.white, -4.2, 1.07, 4.97);
    b.box(0.12, 0.04, 0.05, m.steelDark, -3.8, 1.05, 4.92);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 3; j++) {
        b.box(0.38, 0.6, 0.45, i % 2 ? m.steelPan : m.steel, -6.6 + i * 0.4, 0.35 + j * 0.62, 4.75);
        b.box(0.2, 0.012, 0.005, m.black, -6.6 + i * 0.4, 0.55 + j * 0.62, 4.523);
      }
    }
    // Mesa de oficina con impresora
    b.box(1.4, 0.04, 0.7, m.wood, 3.8, TOP - 0.05, 4.6);
    for (const dx of [-0.65, 0.65]) b.box(0.04, TOP - 0.07, 0.65, m.steelDark, 3.8 + dx, (TOP - 0.07) / 2, 4.6);
    b.box(0.03, 0.4, 0.3, m.white, 3.2, TOP + 0.15, 4.7);
    b.box(0.22, 0.3, 0.004, m.white, 4.35, 1.5, 4.985);
    b.box(0.22, 0.3, 0.004, m.greenTape, 4.62, 1.45, 4.985);
    // Lavadero de vajilla en la esquina
    this.table(b, 1.2, 4.55, 2.2, 0.8, 0, false);
    b.box(0.5, 0.02, 0.4, m.steelDark, 1.0, TOP + 0.002, 4.5);
    b.cyl(0.012, 0.012, 0.5, m.steelPan, 1.0, TOP + 0.25, 4.85, 6);
    this.plates(b, 10, 1.8, TOP, 4.5, 0.13);
    this.plates(b, 7, 2.1, TOP, 4.45, 0.11);
    b.box(0.5, 0.1, 0.5, m.blueRack, 0.4, TOP + 0.05, 4.55);
    this.brute(b, 2.72, 4.62);
  }

  /** El pase: mesa con lámparas de calor, platos en espera y riel de comandas. */
  private buildPass(b: Batch) {
    const m = this.m;
    const cx = -1.8, cz = 2.9, w = 2.4;
    this.table(b, cx, cz, w, 0.6);
    for (const dx of [-w / 2 + 0.08, w / 2 - 0.08]) b.box(0.04, 0.66, 0.04, m.steel, cx + dx, TOP + 0.33, cz - 0.05);
    b.box(w - 0.08, 0.025, 0.38, m.steel, cx, TOP + 0.67, cz - 0.05);
    for (let i = 0; i < 3; i++) {
      const x = cx - 0.75 + i * 0.75;
      b.box(0.6, 0.05, 0.14, m.steelDark, x, TOP + 0.63, cz - 0.05);
      b.box(0.54, 0.01, 0.07, m.heatLamp, x, TOP + 0.603, cz - 0.05);
      b.add(G.get('glow', () => new THREE.PlaneGeometry(0.8, 0.55).rotateX(-Math.PI / 2)), m.lampGlow, x, TOP + 0.004, cz);
    }
    // Platos esperando servicio
    for (let i = 0; i < 4; i++) {
      const x = cx - 0.9 + i * 0.58, z = cz + 0.03;
      b.cyl(0.13, 0.1, 0.016, m.ceramic, x, TOP + 0.008, z, 22);
      b.box(0.08, 0.025, 0.05, m.fFish, x, TOP + 0.03, z);
      b.cyl(0.02, 0.02, 0.012, m.fHerb, x + 0.03, TOP + 0.047, z - 0.01, 8);
      b.cyl(0.025, 0.025, 0.006, m.fPepper, x - 0.06, TOP + 0.02, z + 0.04, 8);
    }
    // Pilas de platos sobre el estante
    for (const dx of [-0.8, 0, 0.8]) this.plates(b, 6, cx + dx, TOP + 0.683, cz - 0.05, 0.12);
    // Comandas mirando a la cámara
    this.tickets(b, cx - w / 2 + 0.15, cx + w / 2 - 0.15, TOP + 0.64, cz + 0.15, 7);
  }

  private buildColliders() {
    const C = (minX: number, maxX: number, minZ: number, maxZ: number) => this.colliders.push({ minX, maxX, minZ, maxZ });
    // Paredes
    C(-7.5, 7.5, -5.5, -4.98);
    C(-7.5, 7.5, 4.98, 5.5);
    C(-7.5, -6.98, -5.5, 5.5);
    C(6.98, 7.5, -5.5, 5.5);
    // Isla de prep (tablero 1.0 de fondo; el cuerpo puede meterse bajo el vuelo del tablero)
    C(-1.62, 1.62, -0.36, 0.36);
    // Línea fría, combis, speed rack, mesa de ahumado
    C(-5.02, -0.58, -5, -4.33);
    C(-0.37, 0.17, -4.89, -4.35); // basurero
    C(0.38, 2.62, -5, -4.08);
    C(2.77, 3.33, -4.98, -4.26);
    C(3.48, 5.72, -5, -4.26);
    // Estufa + freidora
    C(-7, -6.05, -2.02, 1.62);
    // Cámara fría, carrito, cambros, almacén, racks, speed rack de esquina
    C(6.82, 7, -1.92, -0.08);
    C(5.4, 6.12, -0.88, -0.32);
    C(6.17, 6.85, 0.32, 0.98);
    C(6.42, 7, 0.98, 3.62);
    C(5.63, 6.17, 3.63, 4.17);
    C(6.27, 6.85, 4.19, 4.91);
    // Frente: lockers, lavadero, basurero, oficina
    C(-6.82, -5.38, 4.5, 5);
    C(0.08, 2.32, 4.17, 4.97);
    C(2.45, 2.99, 4.35, 4.9);
    C(3.08, 4.52, 4.33, 4.97);
    // Pase
    C(-3.02, -0.58, 2.62, 3.18);
  }

  private buildDynamic() {
    const m = this.m;
    // Latas y frascos instanciados (1 draw call) en el almacén seco
    const can = new THREE.CylinderGeometry(0.05, 0.05, 0.13, 10);
    const colors = ['#c8372d', '#e9b23a', '#2f6db0', '#d9d4c5', '#3b8a4a', '#8b1d1d', '#f0e9d8', '#1d1d1d'];
    const count = 5 * 2 * 22;
    const inst = new THREE.InstancedMesh(can, new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.4 }), count);
    const mtx = new THREE.Matrix4(), col = new THREE.Color();
    let n = 0;
    for (const y of [0.3, 0.75, 1.2, 1.65, 2.1])
      for (const dx of [-0.1, 0.12])
        for (let k = 0; k < 22; k++) {
          if (rnd() < 0.15) continue;
          mtx.makeScale(1, 0.8 + rnd() * 0.8, 1).setPosition(6.7 + dx, y + 0.08, 1.15 + k * 0.105);
          inst.setMatrixAt(n, mtx);
          inst.setColorAt(n, col.set(colors[(k * 7 + Math.floor(y * 3)) % colors.length]));
          n++;
        }
    inst.count = n;
    inst.castShadow = inst.receiveShadow = true;
    this.root.add(inst);

    // Terminal del reloj checador
    this.terminal = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.24, 0.03), [m.steelDark, m.steelDark, m.steelDark, m.steelDark, new THREE.MeshBasicMaterial({ map: terminalScreen(['6:50 AM', 'Toca para fichar']) }), m.steelDark]);
    this.terminal.position.set(-2.8, 1.35, 4.97);
    this.terminal.rotation.y = Math.PI;
    this.terminal.name = 'terminal';
    this.root.add(this.terminal);
    // Locker abierto (interacción vestirse)
    this.lockers = new THREE.Mesh(new THREE.BoxGeometry(0.38, 1.2, 0.03), m.steelPan);
    this.lockers.position.set(-5.4, 1.0, 4.5);
    this.lockers.name = 'locker';
    this.root.add(this.lockers);
    // Impresora
    this.printer = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.35), m.white);
    this.printer.position.set(3.8, TOP + 0.08, 4.6);
    this.printer.name = 'printer';
    this.root.add(this.printer);
    for (const o of [this.lockers, this.printer]) o.castShadow = o.receiveShadow = true;

    // Cartel EXIT
    const exit = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.14), new THREE.MeshBasicMaterial({ map: labelTex('EXIT', '#2a0a08', '#ff4b3a', 128, 52) }));
    exit.position.set(-4.2, 2.4, 4.95);
    exit.rotation.y = Math.PI;
    this.root.add(exit);
    const exit2 = exit.clone();
    exit2.position.set(4.5, 2.5, -4.95);
    exit2.rotation.y = 0;
    this.root.add(exit2);
  }

  private buildCooks() {
    const a = new Cook({ hair: '#151311', hat: 'cap' });
    a.place(-1.6, -3.95, Math.PI); // de espaldas, trabajando en garde manger
    a.work = 'chop';
    const bb = new Cook({ hair: '#3a2a1c', skin: '#efc6a4', hairStyle: 'bun' });
    bb.place(-5.55, -1.9, -Math.PI / 2);
    bb.work = 'stir';
    const c = new Cook({ hair: '#1e1a16', skin: '#a8714f', hat: 'bandana' });
    c.place(1.1, -0.85, 0);
    c.work = 'chop';
    const d = new Cook({ hair: '#8a5a32', skin: '#f0c8a8', hairStyle: 'short' });
    d.place(3.6, -3.95, Math.PI);
    d.work = 'idle';
    this.chef = new Cook({ hair: '#5b5550', skin: '#f2c6a6', chef: true, hairStyle: 'short' });
    this.chef.place(-1.4, 3.55, Math.PI); // el chef "expedita" desde el pase
    this.chef.work = 'idle';
    this.cooks = [a, bb, c, d, this.chef];
    this.home = this.cooks.map((k) => ({ x: k.root.position.x, z: k.root.position.z, ry: k.root.rotation.y, work: k.work }));
    for (const k of this.cooks) this.root.add(k.root);
  }

  resetCooks() {
    this.cooks.forEach((k, i) => {
      const h = this.home[i];
      k.place(h.x, h.z, h.ry);
      k.work = h.work;
    });
  }

  setFlame(intensity: number, pos?: THREE.Vector3) {
    this.flameLight.intensity = intensity;
    if (pos) this.flameLight.position.copy(pos);
  }

  update(dt: number, t: number) {
    for (const c of this.cooks) c.update(dt, t);
  }
}

/** Remapea las UV de un plano a una mitad del atlas de comandas. */
function uvAtlas(g: THREE.BufferGeometry, u0: number) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * 0.5);
}
