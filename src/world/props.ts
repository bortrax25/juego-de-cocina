import * as THREE from 'three/webgpu';
import { mats } from './materials';
import * as T from './textures';

// Fábrica de objetos de cocina low-poly pero con proporciones reales (metros).

const std = (color: string, roughness = 0.6, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

let texCache: Record<string, THREE.Texture> = {};
function cachedTex(key: string, make: () => THREE.Texture) {
  return (texCache[key] ??= make());
}

export const PM = {
  carrot: std('#f0731c', 0.55, 0, { emissive: '#3a1200', emissiveIntensity: 0.25 }),
  carrotCore: std('#f7a04a', 0.5),
  leaf: std('#3f8a2a', 0.7),
  potato: std('#c99a5c', 0.85),
  potatoIn: std('#f1dfa6', 0.6),
  salmon: () => std('#ffffff', 0.45, 0, { map: cachedTex('salmon', () => T.salmonFlesh()) }),
  trout: () => std('#ffffff', 0.45, 0, { map: cachedTex('trout', () => T.salmonFlesh('#f39a6b', 'rgba(255,240,225,0.7)')) }),
  whiteFish: () => std('#ffffff', 0.5, 0, { map: cachedTex('wf', () => T.whiteFish()) }),
  sword: () => std('#ffffff', 0.5, 0, { map: cachedTex('sw', () => T.swordfish()) }),
  skin: std('#a7aeb2', 0.3, 0.3),
  bone: std('#ffffff', 0.3, 0, { emissive: '#d8d4cc', emissiveIntensity: 0.5 }),
  shell: std('#8d8a80', 0.95),
  shellIn: std('#e8e2d6', 0.25, 0.1),
  oysterMeat: std('#c9bfa2', 0.3, 0, { transparent: true, opacity: 0.95 }),
  langoustine: std('#f19a7b', 0.4),
  langoustineDark: std('#d9674a', 0.45),
  lobsterRaw: std('#2d4a55', 0.4, 0.1),
  lobsterBand: std('#f5d321', 0.5),
  scallop: std('#f2dcc0', 0.35),
  scallopMuscle: std('#ffffff', 0.4, 0, { emissive: '#ffffff', emissiveIntensity: 0.35 }),
  clam: std('#b9b2a2', 0.7),
  clamDark: std('#5e574b', 0.8),
  caviar: () => std('#ffffff', 0.25, 0.1, { map: cachedTex('cav', () => T.caviarTex()) }),
  stock: std('#c4632a', 0.15, 0, { transparent: true, opacity: 0.88 }),
  bag: std('#f6f8fa', 0.15, 0, { transparent: true, opacity: 0.35 }),
  flour: std('#f6f3ec', 0.95),
  foam: std('#efe2c8', 0.8),
  dirt: std('#6e5a3e', 0.9),
  tinLid: std('#1b5fc4', 0.3, 0.6),
  styro: std('#f2f2ee', 0.9),
  ice: std('#e8f4fb', 0.1, 0, { transparent: true, opacity: 0.7 }),
};

export function knife() {
  const m = mats();
  const g = new THREE.Group();
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0, 0);
  bladeShape.lineTo(0.22, 0);
  bladeShape.quadraticCurveTo(0.25, 0.005, 0.26, 0.02);
  bladeShape.lineTo(0.0, 0.045);
  bladeShape.lineTo(0, 0);
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(bladeShape, { depth: 0.002, bevelEnabled: false }), std('#e3e7ea', 0.12, 1));
  blade.position.z = -0.001;
  g.add(blade);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.022, 0.018), m.black);
  handle.position.set(-0.06, 0.03, 0);
  g.add(handle);
  // Filo en y=0 hacia abajo, punta en +x
  return g;
}

export function oysterKnife() {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.07, 4), std('#dfe3e6', 0.15, 1));
  blade.rotation.z = Math.PI / 2;
  blade.position.x = 0.05;
  g.add(blade);
  const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.07, 4, 8), std('#f0a33a', 0.5));
  handle.rotation.z = Math.PI / 2;
  handle.position.x = -0.02;
  g.add(handle);
  return g;
}

export function tweezers() {
  const g = new THREE.Group();
  const mat = std('#d6dadd', 0.15, 1);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.11, 0.008), mat);
    arm.position.set(s * 0.006, 0.055, 0);
    arm.rotation.z = s * 0.06;
    g.add(arm);
  }
  return g;
}

/** Mano enguantada (para la "garra" que sostiene el producto al cortar). */
export function glovedHand() {
  const g = new THREE.Group();
  const mat = mats().glove;
  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), mat);
  palm.scale.set(1.1, 0.6, 1.3);
  g.add(palm);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.035, 3, 6), mat);
    f.position.set(0.035, -0.012, -0.03 + i * 0.02);
    f.rotation.z = -1.2;
    g.add(f);
  }
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.12, 10), mats().jacket);
  wrist.rotation.z = Math.PI / 2;
  wrist.position.x = -0.09;
  wrist.position.y = 0.02;
  g.add(wrist);
  return g;
}

/** Cubeta gastronómica (hotel pan) abierta. */
export function hotelPan(w = 0.32, d = 0.26, h = 0.065, mat: THREE.Material = mats().steelPan) {
  const g = new THREE.Group();
  const t = 0.004;
  const add = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    b.position.set(x, y, z);
    g.add(b);
  };
  add(w, t, d, 0, t / 2, 0);
  add(w, h, t, 0, h / 2, d / 2);
  add(w, h, t, 0, h / 2, -d / 2);
  add(t, h, d, w / 2, h / 2, 0);
  add(t, h, d, -w / 2, h / 2, 0);
  add(w + 0.03, t, 0.015, 0, h, d / 2 + 0.007);
  add(w + 0.03, t, 0.015, 0, h, -d / 2 - 0.007);
  return g;
}

export function stockPot(r = 0.2, h = 0.3) {
  const g = new THREE.Group();
  const m = mats();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.97, h, 32, 1, true), m.steelPan);
  body.position.y = h / 2;
  g.add(body);
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.98, r * 0.95, h, 32, 1, true), new THREE.MeshStandardMaterial({ color: '#9aa0a4', metalness: 1, roughness: 0.4, side: THREE.BackSide }));
  inner.position.y = h / 2;
  g.add(inner);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(r, 32), m.steelDark);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.005;
  g.add(bottom);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.006, 6, 40), m.steelPan);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = h;
  g.add(rim);
  for (const s of [-1, 1]) {
    const hd = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.007, 6, 12, Math.PI), m.steelPan);
    hd.position.set(s * (r + 0.02), h * 0.82, 0);
    hd.rotation.set(Math.PI / 2, 0, s > 0 ? -Math.PI / 2 : Math.PI / 2);
    g.add(hd);
  }
  return g;
}

/** Lata de caviar (azul con banda roja, como la del video). */
export function caviarTinBig() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.07, 32), mats().caviarTin);
  body.position.y = 0.035;
  g.add(body);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.1115, 0.1115, 0.02, 32, 1, true), mats().redTape);
  band.position.y = 0.04;
  g.add(band);
  const top = new THREE.Mesh(new THREE.CircleGeometry(0.1, 32), PM.caviar());
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.0705;
  g.add(top);
  return g;
}

/** Recipiente de vidrio pequeño para porcionar caviar. Devuelve el grupo y la malla de relleno. */
export function smallJar() {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.043, 0.055, 24, 1, true), mats().glass);
  glass.position.y = 0.0275;
  g.add(glass);
  const base = new THREE.Mesh(new THREE.CircleGeometry(0.043, 24), mats().glass);
  base.rotation.x = -Math.PI / 2;
  base.position.y = 0.002;
  g.add(base);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.002, 4, 28), std('#ffffff', 0.1, 0, { transparent: true, opacity: 0.5 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.055;
  g.add(rim);
  const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.041, 1, 24), PM.caviar());
  fill.scale.y = 0.0001;
  fill.position.y = 0.003;
  g.add(fill);
  return { group: g, fill };
}

export function oyster() {
  const g = new THREE.Group();
  const bottomGeo = new THREE.SphereGeometry(0.05, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  deform(bottomGeo, 0.006);
  const bottom = new THREE.Mesh(bottomGeo, PM.shell);
  bottom.scale.set(1.25, 0.45, 0.85);
  g.add(bottom);
  const meat = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 6), PM.oysterMeat);
  meat.scale.set(1.15, 0.18, 0.72);
  meat.position.y = 0.004;
  g.add(meat);
  const topG = new THREE.Group();
  topG.position.set(-0.06, 0.002, 0); // bisagra
  const topGeo = new THREE.SphereGeometry(0.05, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2.6);
  deform(topGeo, 0.005);
  const top = new THREE.Mesh(topGeo, PM.shell);
  top.scale.set(1.2, 0.25, 0.82);
  top.position.x = 0.06;
  topG.add(top);
  g.add(topG);
  return { group: g, top: topG, meat };
}

export function langoustine() {
  const g = new THREE.Group();
  const head = new THREE.Group();
  const carapace = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.05, 4, 8), PM.langoustine);
  carapace.rotation.z = Math.PI / 2;
  carapace.position.x = -0.035;
  head.add(carapace);
  for (const s of [-1, 1]) {
    const claw = new THREE.Mesh(new THREE.CapsuleGeometry(0.004, 0.09, 3, 6), PM.langoustineDark);
    claw.rotation.z = Math.PI / 2;
    claw.rotation.y = s * 0.35;
    claw.position.set(-0.1, 0, s * 0.02);
    head.add(claw);
  }
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, 0.12, 3), PM.langoustineDark);
  ant.rotation.z = Math.PI / 2 + 0.2;
  ant.position.set(-0.11, 0.01, 0);
  head.add(ant);
  g.add(head);
  const tail = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Mesh(new THREE.SphereGeometry(0.014 - i * 0.0015, 10, 6), i % 2 ? PM.langoustine : PM.langoustineDark);
    seg.scale.set(0.9, 0.75, 1.1);
    seg.position.x = 0.012 + i * 0.016;
    tail.add(seg);
  }
  const fan = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.022, 4), PM.langoustine);
  fan.rotation.z = Math.PI / 2;
  fan.position.x = 0.1;
  tail.add(fan);
  g.add(tail);
  return { group: g, head, tail };
}

export function lobster() {
  const g = new THREE.Group();
  const shellMat = PM.lobsterRaw.clone();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.032, 0.11, 6, 12), shellMat);
  body.rotation.z = Math.PI / 2;
  g.add(body);
  const tail = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Mesh(new THREE.SphereGeometry(0.03 - i * 0.003, 12, 8), shellMat);
    seg.scale.set(0.8, 0.65, 1.1);
    seg.position.x = 0.09 + i * 0.026;
    tail.add(seg);
  }
  g.add(tail);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.01, 0.07, 3, 6), shellMat);
    arm.rotation.set(0, s * 0.6, Math.PI / 2);
    arm.position.set(-0.1, 0, s * 0.04);
    g.add(arm);
    const claw = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), shellMat);
    claw.scale.set(1.6, 0.6, 0.9);
    claw.position.set(-0.17, 0, s * 0.08);
    g.add(claw);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 4, 10), PM.lobsterBand);
    band.rotation.y = Math.PI / 2;
    band.position.set(-0.15, 0, s * 0.075);
    g.add(band);
  }
  return { group: g, mat: shellMat, tail };
}

export function scallop() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.02, 18), PM.scallop);
  body.position.y = 0.01;
  g.add(body);
  const muscle = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.018, 0.012), PM.scallopMuscle.clone());
  muscle.position.set(0.025, 0.01, 0);
  g.add(muscle);
  return { group: g, muscle };
}

export function clam(open = false) {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.022, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  deform(geo, 0.002);
  const a = new THREE.Mesh(geo, open ? PM.clamDark : PM.clam);
  a.scale.set(1.2, 0.5, 1);
  g.add(a);
  const b = new THREE.Mesh(geo, open ? PM.clamDark : PM.clam);
  b.scale.set(1.2, -0.5, 1);
  g.add(b);
  if (open) {
    a.rotation.z = 0.5;
    a.position.y = 0.006;
  }
  return g;
}

export function potato() {
  const geo = new THREE.SphereGeometry(0.04, 14, 10);
  deform(geo, 0.004);
  const m = new THREE.Mesh(geo, PM.potato);
  m.scale.set(1.5, 0.8, 0.85);
  return m;
}

/** Filete plano con forma de lágrima (salmón, trucha, pescado blanco). */
export function filletGeo(len = 0.3, width = 0.1, thick = 0.025) {
  const s = new THREE.Shape();
  s.moveTo(-len / 2, 0);
  s.bezierCurveTo(-len / 2, width * 0.6, len * 0.1, width * 0.55, len / 2, width * 0.12);
  s.lineTo(len / 2, -width * 0.12);
  s.bezierCurveTo(len * 0.1, -width * 0.55, -len / 2, -width * 0.6, -len / 2, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.4, bevelSize: 0.006, bevelSegments: 3, curveSegments: 16 });
  geo.rotateX(-Math.PI / 2);
  // UVs planos desde arriba
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - bb.min.x) / (bb.max.x - bb.min.x), (pos.getZ(i) - bb.min.z) / (bb.max.z - bb.min.z));
  return geo;
}

export function deliveryBox() {
  const g = hotelPan(0.5, 0.36, 0.2, PM.styro);
  const ice = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.05, 0.34), PM.ice);
  ice.position.y = 0.05;
  g.add(ice);
  return g;
}

export function vacuumBag() {
  const g = new THREE.Group();
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.006, 0.26), PM.bag);
  g.add(bag);
  const fill = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1, 0.2), PM.stock);
  fill.position.z = 0.02;
  fill.scale.y = 0.0001;
  g.add(fill);
  const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.025), new THREE.MeshBasicMaterial({ map: T.labelTex('FONDO LANG.') }));
  lbl.rotation.x = -Math.PI / 2;
  lbl.position.set(0, 0.006, -0.1);
  g.add(lbl);
  return { group: g, fill };
}

export function can(color: string, label = '') {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 18), std(color, 0.35, 0.3));
  body.position.y = 0.07;
  g.add(body);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.005, 18), mats().steelPan);
  top.position.y = 0.142;
  g.add(top);
  if (label) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.0505, 0.0505, 0.06, 18, 1, true), new THREE.MeshStandardMaterial({ map: T.labelTex(label, '#f4efe2', '#333', 256, 64), roughness: 0.6 }));
    l.position.y = 0.07;
    g.add(l);
  }
  return g;
}

export function deli(color = '#ffffff', label?: string) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.052, 0.1, 18), mats().plastic);
  body.position.y = 0.05;
  g.add(body);
  const content = new THREE.Mesh(new THREE.CylinderGeometry(0.053, 0.05, 0.07, 18), std(color, 0.6));
  content.position.y = 0.037;
  g.add(content);
  if (label) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.018), new THREE.MeshBasicMaterial({ map: T.labelTex(label) }));
    l.position.set(0, 0.07, 0.057);
    g.add(l);
  }
  return g;
}

export function towel(w = 0.3, d = 0.24) {
  const geo = new THREE.PlaneGeometry(w, d, 8, 8);
  deform(geo, 0.004);
  geo.rotateX(-Math.PI / 2);
  return new THREE.Mesh(geo, mats().towel);
}

export function fryBasket() {
  const g = new THREE.Group();
  const wire = new THREE.MeshStandardMaterial({ color: '#b8bcbf', metalness: 1, roughness: 0.35, wireframe: true });
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.24, 6, 4, 6), wire);
  b.position.y = 0.06;
  g.add(b);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6), mats().steelDark);
  handle.rotation.x = Math.PI / 2 - 0.5;
  handle.position.set(0, 0.16, 0.24);
  g.add(handle);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 8), mats().black);
  grip.rotation.x = Math.PI / 2 - 0.5;
  grip.position.set(0, 0.25, 0.39);
  g.add(grip);
  return g;
}

/** Ruido determinista en vértices para que nada luzca perfecto. */
function deform(geo: THREE.BufferGeometry, amt: number) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * 97 + z * 53) * Math.cos(y * 71 + x * 13) * amt;
    p.setXYZ(i, x + n, y + n * 0.5, z + n);
  }
  geo.computeVertexNormals();
}

export function contactShadow(w: number, d: number) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.45)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = cachedTex('shadow', () => new THREE.CanvasTexture(c));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.001;
  return m;
}
