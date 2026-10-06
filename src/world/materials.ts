import * as THREE from 'three/webgpu';
import * as T from './textures';

// Materiales compartidos (una sola instancia por tipo => menos cambios de estado en GPU).

let cache: ReturnType<typeof build> | null = null;

function build() {
  const brushed = T.brushedRoughness();
  brushed.repeat.set(2, 2);
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  const tile = T.subwayTile();
  const floor = T.floorTile();
  floor.repeat.set(14, 10);
  const ceil = T.ceilingTile();
  ceil.repeat.set(14, 10);
  const board = T.cuttingBoard();
  return {
    steel: std({ color: '#b4b9bd', metalness: 1, roughness: 0.4, roughnessMap: brushed }),
    steelDark: std({ color: '#8c9196', metalness: 1, roughness: 0.42, roughnessMap: brushed }),
    steelPan: std({ color: '#c9cdd0', metalness: 1, roughness: 0.28 }),
    tile: std({ map: tile, roughness: 0.25, metalness: 0 }),
    floor: std({ map: floor, roughness: 0.75 }),
    ceiling: std({ map: ceil, roughness: 0.9, emissive: '#9a9c9e', emissiveMap: ceil }),
    light: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    board: std({ map: board, roughness: 0.8 }),
    blackGlass: std({ color: '#141618', metalness: 0.2, roughness: 0.08 }),
    black: std({ color: '#1b1c1e', roughness: 0.6 }),
    rubber: std({ color: '#2a2b2d', roughness: 0.9 }),
    white: std({ color: '#f4f4f2', roughness: 0.6 }),
    jacket: std({ color: '#f3f3f0', roughness: 0.85 }),
    apron: std({ color: '#1f2a44', roughness: 0.9 }),
    pants: std({ color: '#17181b', roughness: 0.9 }),
    skin: std({ color: '#e0b48f', roughness: 0.7 }),
    hair: std({ color: '#141210', roughness: 0.8 }),
    glove: std({ color: '#f1f1f4', roughness: 0.45, transparent: true, opacity: 0.95 }),
    towel: std({ color: '#ece8df', roughness: 1 }),
    blueRack: std({ color: '#1f5fbf', roughness: 0.6 }),
    brownRack: std({ color: '#5a4636', roughness: 0.7 }),
    redTape: std({ color: '#c42a2a', roughness: 0.6 }),
    caviarTin: std({ color: '#1b62c9', metalness: 0.6, roughness: 0.3 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.05, transmission: 0, transparent: true, opacity: 0.28, metalness: 0 }),
    plastic: std({ color: '#f3f5f7', roughness: 0.3, transparent: true, opacity: 0.55 }),
    wood: std({ color: '#8a6a48', roughness: 0.7 }),
    exitSign: new THREE.MeshBasicMaterial({ color: '#ff3b2f' }),
    shadow: new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.25, depthWrite: false }),
  };
}

export function mats() {
  if (!cache) cache = build();
  return cache;
}

export type Mats = ReturnType<typeof build>;
