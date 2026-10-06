import * as THREE from 'three/webgpu';
import * as T from './textures';

// Materiales compartidos (una sola instancia por tipo => menos cambios de estado en GPU).

let cache: ReturnType<typeof build> | null = null;

function build() {
  const brushed = T.brushedRoughness();
  brushed.repeat.set(2, 2);
  const brushedC = T.brushedColor();
  brushedC.repeat.set(2, 2);
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  const tile = T.subwayTile();
  const floor = T.floorTile();
  floor.repeat.set(14, 10);
  const ceil = T.ceilingTile();
  ceil.repeat.set(14, 10);
  const board = T.cuttingBoard();
  const mat = T.rubberMat();
  mat.repeat.set(6, 2);
  const diced = T.dicedTex();
  const herb = T.herbTex();
  // Comida en cubetas: color vivo sobre textura de picado (se ve "mise en place" desde arriba)
  const food = (color: string, map = diced, rough = 0.55) => std({ color, map, roughness: rough });
  return {
    steel: std({ color: '#d6dadd', map: brushedC, metalness: 0.92, roughness: 0.32, roughnessMap: brushed }),
    steelDark: std({ color: '#a7acb1', map: brushedC, metalness: 0.9, roughness: 0.4, roughnessMap: brushed }),
    steelPan: std({ color: '#dfe2e4', metalness: 0.95, roughness: 0.24 }),
    /** Igual que steel pero no proyecta sombra (campanas: si no, oscurecen toda la línea). */
    steelHood: std({ color: '#d6dadd', map: brushedC, metalness: 0.92, roughness: 0.32, roughnessMap: brushed }),
    tile: std({ map: tile, roughness: 0.22, metalness: 0 }),
    floor: std({ map: floor, roughness: 0.62 }),
    ceiling: std({ map: ceil, roughness: 0.9, emissive: '#b4b6b8', emissiveMap: ceil }),
    light: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.7, 2.85) }),
    board: std({ map: board, roughness: 0.75 }),
    blackGlass: std({ color: '#141618', metalness: 0.2, roughness: 0.08 }),
    black: std({ color: '#1b1c1e', roughness: 0.6 }),
    rubber: std({ color: '#2a2b2d', roughness: 0.9 }),
    white: std({ color: '#f4f4f2', roughness: 0.6 }),
    ceramic: std({ color: '#e9e8e3', roughness: 0.3 }),
    jacket: std({ color: '#efeee9', roughness: 0.85 }),
    apron: std({ color: '#22305a', roughness: 0.9 }),
    pants: std({ color: '#17181b', roughness: 0.9 }),
    skin: std({ color: '#e0b48f', roughness: 0.7 }),
    hair: std({ color: '#141210', roughness: 0.8 }),
    glove: std({ color: '#f1f1f4', roughness: 0.45, transparent: true, opacity: 0.95 }),
    towel: std({ color: '#ece8df', roughness: 1 }),
    blueRack: std({ color: '#2a6fd0', roughness: 0.55 }),
    brownRack: std({ color: '#6a5240', roughness: 0.7 }),
    redTape: std({ color: '#c42a2a', roughness: 0.6 }),
    greenTape: std({ color: '#9fd25a', roughness: 0.7 }),
    caviarTin: std({ color: '#1b62c9', metalness: 0.6, roughness: 0.3 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.05, transmission: 0, transparent: true, opacity: 0.28, metalness: 0 }),
    plastic: std({ color: '#f3f5f7', roughness: 0.3, transparent: true, opacity: 0.55 }),
    cambro: std({ color: '#eef3f6', roughness: 0.35, transparent: true, opacity: 0.8 }),
    lidRed: std({ color: '#d23a2e', roughness: 0.5 }),
    wood: std({ color: '#9a7650', roughness: 0.65 }),
    aluminum: std({ color: '#c9ccce', metalness: 0.75, roughness: 0.5 }),
    copper: std({ color: '#e08a5a', metalness: 1, roughness: 0.3 }),
    rubberMat: std({ color: '#ffffff', map: mat, roughness: 0.92 }),
    drain: std({ map: T.drainTex(), metalness: 0.6, roughness: 0.45 }),
    ticket: std({ map: T.ticketTex(), roughness: 0.9, side: THREE.DoubleSide }),
    brute: std({ color: '#7d8287', roughness: 0.65 }),
    heatLamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.25, 0.45) }),
    lampGlow: new THREE.MeshBasicMaterial({ map: T.glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    fCarrot: food('#f07a24'),
    fPepper: food('#d8382c'),
    fLemon: food('#f2cf3a'),
    fShallot: food('#c98fa8'),
    fBeet: food('#8e1f45'),
    fCream: food('#f1e8d2', diced, 0.4),
    fChive: food('#3e9a3a', herb, 0.7),
    fHerb: food('#5fae3e', herb, 0.7),
    fMush: food('#a98a68'),
    fFish: food('#f39a74', diced, 0.35),
    exitSign: new THREE.MeshBasicMaterial({ color: '#ff3b2f' }),
    shadow: new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.25, depthWrite: false }),
  };
}

/** Metales que reflejan el entorno con más fuerza que el resto (el inox debe brillar). */
export function metalMats(m: Mats) {
  return [m.steel, m.steelDark, m.steelPan, m.steelHood, m.aluminum, m.copper];
}

export function mats() {
  if (!cache) cache = build();
  return cache;
}

export type Mats = ReturnType<typeof build>;
