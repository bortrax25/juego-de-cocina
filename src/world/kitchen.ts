import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mats, type Mats } from './materials';
import { labelTex, terminalScreen } from './textures';
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

export const OVERVIEW = { pos: V(0.4, 1.68, 3.6), look: V(-0.4, 1.05, -2.5), fov: 68 };

function uvScale(g: THREE.BufferGeometry, sx: number, sy: number) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  return g;
}

/** Junta geometrías estáticas por material y las fusiona: ~1 draw call por material. */
class Batch {
  private groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0) {
    const g = geo.clone();
    if (g.index === null) return;
    const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
    g.applyMatrix4(m);
    let arr = this.groups.get(mat);
    if (!arr) this.groups.set(mat, (arr = []));
    arr.push(g);
  }
  box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, ry = 0) {
    this.add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, ry);
  }
  build(scene: THREE.Scene) {
    for (const [mat, geos] of this.groups) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
    }
  }
}

export class Kitchen {
  root = new THREE.Group();
  cooks: Cook[] = [];
  chef!: Cook;
  terminal!: THREE.Mesh;
  lockers!: THREE.Mesh;
  printer!: THREE.Mesh;
  frenchTop = V(-6.3, TOP + 0.04, -0.75);
  m: Mats;
  private flameLight: THREE.PointLight;
  private home: { x: number; z: number; ry: number; work: Cook['work'] }[] = [];

  constructor(private scene: THREE.Scene, renderer: THREE.WebGPURenderer) {
    this.m = mats();
    scene.background = new THREE.Color('#d8dcdf');
    scene.fog = new THREE.Fog('#d8dcdf', 9, 22);
    this.buildEnvironment(renderer);
    const b = new Batch();
    this.buildRoom(b);
    this.buildPrep(b);
    this.buildColdLine(b);
    this.buildRange(b);
    this.buildRight(b);
    this.buildFront(b);
    b.build(scene);
    this.buildDynamic();
    this.buildCooks();

    const hemi = new THREE.HemisphereLight('#ffffff', '#5b5e60', 0.45);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fffaf2', 1.1);
    sun.position.set(1, 6, 2);
    scene.add(sun);
    this.flameLight = new THREE.PointLight('#ff8a3a', 0, 3, 2);
    scene.add(this.flameLight);
    scene.add(this.root);
  }

  /** Mapa de entorno "cocina con fluorescentes" para que el acero refleje como en el video. */
  private buildEnvironment(renderer: THREE.WebGPURenderer) {
    const env = new THREE.Scene();
    const room = new THREE.Mesh(new THREE.BoxGeometry(14, 3.2, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 1.12, 1.15), side: THREE.BackSide }));
    room.position.y = 0.1; // la cámara del PMREM está en el origen: sala centrada en y≈0
    env.add(room);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.76, 0.77) }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.45;
    env.add(floor);
    const lm = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5, 5) });
    for (let x = -5; x <= 5; x += 2.5)
      for (let z = -3.5; z <= 3.5; z += 2.3) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.5), lm);
        p.rotation.x = Math.PI / 2;
        p.position.set(x, 1.65, z);
        env.add(p);
      }
    const wall = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.4, 2.4) });
    for (const [x, z, ry] of [[0, -4.95, 0], [0, 4.95, Math.PI], [-6.95, 0, Math.PI / 2], [6.95, 0, -Math.PI / 2]] as const) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.6), wall);
      w.position.set(x, 0.3, z);
      w.rotation.y = ry;
      env.add(w);
    }
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(env, 0.03).texture;
    this.scene.environmentIntensity = 0.7;
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
    // Zócalo de acero
    b.box(14, 0.12, 0.02, m.steelDark, 0, 0.06, -4.99);
    b.box(14, 0.12, 0.02, m.steelDark, 0, 0.06, 4.99);
    // Luminarias fluorescentes empotradas
    for (let x = -5; x <= 5; x += 2.5)
      for (let z = -3.5; z <= 3.5; z += 2.3) {
        b.box(1.2, 0.02, 0.6, m.steelDark, x, 2.995, z);
        b.box(1.1, 0.02, 0.5, m.light, x, 2.985, z);
      }
    // Rejillas de aire
    for (const [x, z] of [[-2.5, 1], [2.5, -1.2], [0, 3.6]]) b.box(0.6, 0.01, 0.6, m.steelDark, x, 2.99, z);
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
        b.add(new THREE.CylinderGeometry(0.02, 0.02, TOP - 0.04, 8), m.steelDark, x, (TOP - 0.04) / 2, z);
      }
  }

  private buildPrep(b: Batch) {
    const m = this.m;
    this.table(b, 0, 0, 3.2, 1.0);
    // Contenedores bajo la mesa (racks azules/marrones como en el video)
    b.box(0.5, 0.18, 0.4, m.blueRack, -1, 0.36, 0);
    b.box(0.5, 0.18, 0.4, m.brownRack, -0.4, 0.36, 0);
    b.box(0.5, 0.18, 0.4, m.blueRack, 0.6, 0.36, 0.1);
    // Tabla de picar fija + toalla húmeda debajo
    b.box(0.62, 0.02, 0.42, m.board, 0, TOP + 0.01, 0.05);
    b.box(0.3, 0.006, 0.3, m.towel, 0.55, TOP + 0.003, 0.15);
    // Bandejas y cubetas sobre la mesa (lado lejano)
    b.box(0.53, 0.06, 0.32, m.steelPan, -0.95, TOP + 0.03, -0.22);
    b.box(0.53, 0.1, 0.32, m.steelPan, 0.95, TOP + 0.05, -0.22);
    b.add(new THREE.CylinderGeometry(0.06, 0.055, 0.12, 14), m.plastic, 1.35, TOP + 0.06, 0.25);
    b.add(new THREE.CylinderGeometry(0.06, 0.055, 0.12, 14), m.plastic, 1.2, TOP + 0.06, 0.3);
    // Estante superior (sobre la isla) con cubetas
    for (const x of [-1.3, 1.3]) b.add(new THREE.CylinderGeometry(0.012, 0.012, 1.3, 6), m.steelDark, x, TOP + 0.65, -0.45);
    b.box(2.8, 0.02, 0.32, m.steel, 0, TOP + 0.7, -0.45);
    for (let i = 0; i < 6; i++) b.box(0.3, 0.1, 0.25, m.steelPan, -1.1 + i * 0.44, TOP + 0.76, -0.45);
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
    }
    // Riel de cubetas refrigeradas
    b.box(4.2, 0.03, 0.2, m.steelDark, -2.8, TOP + 0.01, -4.85);
    for (let i = 0; i < 9; i++) b.box(0.32, 0.06, 0.17, m.steelPan, -4.7 + i * 0.47, TOP + 0.04, -4.85);
    // Tabla en garde manger
    b.box(0.6, 0.02, 0.4, m.board, -3, TOP + 0.01, -4.5);
    // Estantes de pared con recipientes
    b.box(4.4, 0.02, 0.3, m.steel, -2.8, 1.75, -4.85);
    b.box(4.4, 0.02, 0.3, m.steel, -2.8, 2.15, -4.85);
    for (let i = 0; i < 12; i++) {
      b.add(new THREE.CylinderGeometry(0.06, 0.055, 0.14, 12), m.plastic, -4.8 + i * 0.36, 1.83, -4.85);
      if (i % 2) b.box(0.3, 0.12, 0.22, m.steelPan, -4.7 + i * 0.36, 2.22, -4.85);
    }
    // Combis (hornos) contra la pared trasera derecha
    for (const x of [0.9, 2.1]) {
      b.box(1.0, 0.7, 0.85, m.steel, x, 0.35, -4.5);
      b.box(1.0, 0.95, 0.85, m.steel, x, 1.2, -4.5);
      b.box(0.62, 0.62, 0.02, m.blackGlass, x - 0.1, 1.2, -4.07);
      b.box(0.2, 0.5, 0.02, m.black, x + 0.36, 1.25, -4.07);
      b.box(0.04, 0.5, 0.05, m.steelDark, x + 0.23, 1.2, -4.03);
    }
    // Mesa de ahumado
    this.table(b, 4.6, -4.55, 2.2, 0.8);
    b.box(0.6, 0.02, 0.4, m.board, 5.4, TOP + 0.01, -4.5);
    // Campana sobre combis
    b.box(2.6, 0.4, 1.1, m.steel, 1.5, 2.45, -4.4);
  }

  private buildRange(b: Batch) {
    const m = this.m;
    // Bloque de cocina (estufa francesa + freidora) contra la pared izquierda
    b.box(0.95, TOP - 0.05, 3.6, m.steel, -6.45, (TOP - 0.05) / 2, -0.2);
    for (let i = 0; i < 4; i++) b.box(0.02, 0.6, 0.8, m.steelPan, -5.97, 0.42, -1.6 + i * 0.9);
    // Plancha francesa (hierro) con anillos concéntricos
    const iron = new THREE.MeshStandardMaterial({ color: '#2a2a2b', metalness: 0.7, roughness: 0.55 });
    b.box(0.9, 0.05, 1.7, iron, -6.45, TOP - 0.02, -0.75);
    for (const r of [0.08, 0.17, 0.26]) {
      const ring = new THREE.TorusGeometry(r, 0.006, 4, 40);
      ring.rotateX(Math.PI / 2);
      b.add(ring, m.steelDark, -6.4, TOP + 0.006, -0.75);
    }
    // Freidora
    b.box(0.9, 0.05, 0.9, m.steel, -6.45, TOP - 0.02, 1.0);
    const oilMat = new THREE.MeshStandardMaterial({ color: '#c08a26', metalness: 0.2, roughness: 0.08, emissive: '#3a2200' });
    b.box(0.56, 0.012, 0.62, oilMat, -6.4, TOP + 0.006, 1.0);
    b.box(0.6, 0.03, 0.02, m.steelPan, -6.4, TOP + 0.015, 0.68);
    b.box(0.6, 0.03, 0.02, m.steelPan, -6.4, TOP + 0.015, 1.32);
    b.box(0.02, 0.03, 0.66, m.steelPan, -6.71, TOP + 0.015, 1.0);
    b.box(0.02, 0.03, 0.66, m.steelPan, -6.09, TOP + 0.015, 1.0);
    b.box(0.9, 0.3, 0.06, m.steel, -6.85, TOP + 0.13, 1.0);
    // Salamandra / estantes sobre la estufa
    b.box(0.5, 0.02, 3.4, m.steel, -6.75, 1.6, -0.2);
    for (let i = 0; i < 8; i++) b.add(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 16), m.white, -6.75, 1.63 + (i % 4) * 0.03, -1.4 + Math.floor(i / 4) * 0.5);
    // Campana extractora gigante
    b.box(1.6, 0.55, 3.9, m.steel, -6.2, 2.45, -0.2);
    b.box(1.5, 0.02, 3.8, m.steelDark, -6.2, 2.17, -0.2);
    for (let i = 0; i < 6; i++) b.box(0.3, 0.01, 0.55, m.black, -5.8, 2.16, -1.9 + i * 0.6);
    // Ollas en la estufa (decorado)
    b.add(new THREE.CylinderGeometry(0.16, 0.15, 0.22, 24, 1, true), m.steelPan, -6.5, TOP + 0.13, -1.45);
  }

  private buildRight(b: Batch) {
    const m = this.m;
    // Puerta de la cámara fría (walk-in)
    b.box(0.08, 2.4, 1.8, m.steel, 6.96, 1.2, -1.0);
    b.box(0.06, 2.1, 1.0, m.steelPan, 6.9, 1.1, -1.0);
    b.box(0.08, 0.06, 0.25, m.black, 6.84, 1.1, -0.65);
    b.box(0.02, 0.06, 0.12, m.steelDark, 6.86, 1.95, -1.3);
    // Carrito de entregas
    b.box(0.9, 0.03, 0.6, m.steel, 5.7, TOP - 0.06, -0.6);
    b.box(0.86, 0.02, 0.56, m.steelDark, 5.7, 0.2, -0.6);
    for (const dx of [-0.42, 0.42]) for (const dz of [-0.27, 0.27]) b.add(new THREE.CylinderGeometry(0.015, 0.015, TOP - 0.1, 6), m.steelDark, 5.7 + dx, (TOP - 0.1) / 2 + 0.03, -0.6 + dz);
    // Almacén seco: estanterías con latas (las latas son instanciadas aparte)
    for (const y of [0.3, 0.75, 1.2, 1.65, 2.1]) b.box(0.5, 0.02, 2.6, m.steelDark, 6.7, y, 2.3);
    for (const dz of [-1.28, 1.28]) for (const dx of [-0.23, 0.23]) b.add(new THREE.CylinderGeometry(0.012, 0.012, 2.2, 6), m.steelDark, 6.7 + dx, 1.1, 2.3 + dz);
    // Racks azules apilados
    for (let i = 0; i < 4; i++) b.box(0.5, 0.2, 0.5, i % 2 ? m.brownRack : m.blueRack, 5.9, 0.1 + i * 0.21, 3.9);
  }

  private buildFront(b: Batch) {
    const m = this.m;
    // Puerta de entrada y lockers
    b.box(1.0, 2.15, 0.06, m.white, -4.2, 1.07, 4.97);
    b.box(0.12, 0.04, 0.05, m.steelDark, -3.8, 1.05, 4.92);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 3; j++) b.box(0.38, 0.6, 0.45, i % 2 ? m.steelPan : m.steel, -6.6 + i * 0.4, 0.35 + j * 0.62, 4.75);
    }
    // Mesa de oficina con impresora
    b.box(1.4, 0.04, 0.7, m.wood, 3.8, TOP - 0.05, 4.6);
    for (const dx of [-0.65, 0.65]) b.box(0.04, TOP - 0.07, 0.65, m.steelDark, 3.8 + dx, (TOP - 0.07) / 2, 4.6);
    b.box(0.03, 0.4, 0.3, m.white, 3.2, TOP + 0.15, 4.7);
    // Lavadero de vajilla en la esquina
    this.table(b, 1.2, 4.55, 2.2, 0.8, 0, false);
    b.box(0.5, 0.02, 0.4, m.steelDark, 1.0, TOP + 0.002, 4.5);
    b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), m.steelPan, 1.0, TOP + 0.25, 4.85);
    for (let i = 0; i < 10; i++) b.add(new THREE.CylinderGeometry(0.13, 0.11, 0.015, 24), m.white, 1.8, TOP + 0.01 + i * 0.016, 4.5);
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
          if (Math.random() < 0.15) continue;
          mtx.makeScale(1, 0.8 + Math.random() * 0.8, 1).setPosition(6.7 + dx, y + 0.08, 1.15 + k * 0.105);
          inst.setMatrixAt(n, mtx);
          inst.setColorAt(n, col.set(colors[(k * 7 + Math.floor(y * 3)) % colors.length]));
          n++;
        }
    inst.count = n;
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
    const a = new Cook({ hair: '#151311' });
    a.place(-1.6, -3.95, Math.PI); // de espaldas, trabajando en garde manger
    a.work = 'chop';
    const bb = new Cook({ hair: '#3a2a1c', skin: '#efc6a4' });
    bb.place(-5.55, -1.9, -Math.PI / 2);
    bb.work = 'stir';
    const c = new Cook({ hair: '#1e1a16', skin: '#c99872' });
    c.place(1.1, -0.85, 0);
    c.work = 'chop';
    const d = new Cook({ hair: '#5b3b22', skin: '#f0c8a8' });
    d.place(3.6, -3.95, Math.PI);
    d.work = 'idle';
    this.chef = new Cook({ hair: '#4a3020', skin: '#f2c6a6', chef: true });
    this.chef.place(-0.2, -2.6, 0.3);
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
