import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { tween, ease } from '../core/tween';

export interface CookOpts {
  hair?: string;
  skin?: string;
  /** Chef: chaqueta cruzada sin delantal, mangas largas. */
  chef?: boolean;
  /** Color del delantal (por defecto azul marino). */
  apron?: string;
  hairStyle?: 'crop' | 'short' | 'bun';
  hat?: 'none' | 'cap' | 'bandana';
}

// ---------------------------------------------------------------------------
// Geometrías base compartidas por todos los cocineros
// ---------------------------------------------------------------------------
const B = {
  thigh: new THREE.CapsuleGeometry(0.074, 0.3, 4, 10),
  shin: new THREE.CapsuleGeometry(0.06, 0.3, 4, 10),
  shoe: new THREE.CapsuleGeometry(0.052, 0.13, 4, 10).rotateX(Math.PI / 2),
  sole: new THREE.BoxGeometry(0.1, 0.022, 0.25),
  pelvis: new THREE.CylinderGeometry(0.16, 0.15, 0.18, 14),
  torso: new THREE.CapsuleGeometry(0.17, 0.3, 6, 16),
  hem: new THREE.CylinderGeometry(0.175, 0.18, 0.2, 16),
  band: new THREE.CylinderGeometry(0.178, 0.178, 0.028, 16),
  bib: new THREE.BoxGeometry(0.24, 0.27, 0.02),
  strap: new THREE.BoxGeometry(0.02, 0.2, 0.012),
  skirt: new THREE.CylinderGeometry(0.19, 0.235, 0.5, 12, 1, true, -Math.PI * 0.4, Math.PI * 0.8),
  bowLoop: new THREE.SphereGeometry(0.03, 8, 6),
  tie: new THREE.BoxGeometry(0.022, 0.16, 0.008),
  towel: new THREE.BoxGeometry(0.012, 0.22, 0.13),
  stripe: new THREE.BoxGeometry(0.014, 0.025, 0.132),
  collar: new THREE.CylinderGeometry(0.068, 0.078, 0.06, 14),
  button: new THREE.SphereGeometry(0.011, 6, 4),
  shoulder: new THREE.SphereGeometry(0.052, 12, 8),
  upper: new THREE.CapsuleGeometry(0.049, 0.18, 4, 10),
  cuff: new THREE.CylinderGeometry(0.056, 0.054, 0.05, 12),
  fore: new THREE.CapsuleGeometry(0.041, 0.17, 4, 10),
  hand: new THREE.SphereGeometry(0.04, 10, 8),
  thumb: new THREE.SphereGeometry(0.014, 6, 4),
  neck: new THREE.CylinderGeometry(0.046, 0.05, 0.09, 10),
  head: new THREE.SphereGeometry(0.118, 20, 16),
  hairCap: new THREE.SphereGeometry(0.126, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.56),
  hatCap: new THREE.SphereGeometry(0.131, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.46),
  bun: new THREE.SphereGeometry(0.05, 10, 8),
  ear: new THREE.SphereGeometry(0.026, 8, 6),
  nose: new THREE.SphereGeometry(0.02, 8, 6),
  eye: new THREE.SphereGeometry(0.0135, 8, 6),
  brow: new THREE.BoxGeometry(0.038, 0.009, 0.012),
  mouth: new THREE.BoxGeometry(0.032, 0.007, 0.01),
  blade: new THREE.BoxGeometry(0.004, 0.035, 0.17),
  handle: new THREE.BoxGeometry(0.018, 0.022, 0.09),
};

type Piece = [geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, s?: [number, number, number], r?: [number, number, number]];

const geoCache = new Map<string, THREE.BufferGeometry>();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _sv = new THREE.Vector3(), _c = new THREE.Color();

/**
 * Fusiona todas las piezas del cocinero en UNA geometría con colores por vértice y skinning
 * rígido (cada pieza pesa 1.0 en su hueso): 1 draw call por cocinero en vez de ~15.
 */
function skinnedGeo(pieces: [Piece, number, THREE.Matrix4][]) {
  const geos = pieces.map(([[geo, color, x, y, z, s, r], bone, boneWorld]) => {
    const c = geo.clone();
    _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(...(r ?? [0, 0, 0]))), _sv.set(...(s ?? [1, 1, 1])));
    c.applyMatrix4(_m.premultiply(boneWorld));
    _c.set(color);
    const n = c.attributes.position.count;
    const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
      si[i * 4] = bone;
      sw[i * 4] = 1;
    }
    c.setAttribute('color', new THREE.BufferAttribute(col, 3));
    c.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    c.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    return c;
  });
  const g = mergeGeometries(geos, false)!;
  geos.forEach((x) => x.dispose());
  return g;
}

let sharedMat: THREE.MeshStandardMaterial | null = null;
function cookMat() {
  return (sharedMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 }));
}

let knifeG: THREE.BufferGeometry | null = null;
function knifeGeo() {
  if (knifeG) return knifeG;
  const parts: [THREE.BufferGeometry, string, number][] = [[B.blade, '#dfe3e6', 0.11], [B.handle, '#1b1c1e', 0]];
  const geos = parts.map(([g, col, z]) => {
    const c = g.clone().translate(0, 0, z);
    _c.set(col);
    const n = c.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([_c.r, _c.g, _c.b], i * 3);
    c.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return c;
  });
  return (knifeG = mergeGeometries(geos, false)!);
}

const JACKET = '#f1f0eb', PANTS = '#1d1f24', SHOE = '#16171a', SOLE = '#3a3b3e', TOWEL = '#f4f1ea', STRIPE = '#3a64b8';

// Índices de articulaciones para mezclar poses (idle/trabajo ↔ caminata)
const J = {
  hipY: 0, hipRX: 1, hipRY: 2, hipRZ: 3, torRX: 4, torRY: 5, torRZ: 6, headRX: 7, headRY: 8,
  armLX: 9, armLZ: 10, foreLX: 11, armRX: 12, armRZ: 13, foreRX: 14,
  thighLX: 15, shinLX: 16, thighRX: 17, shinRX: 18, armLY: 19, armRY: 20,
} as const;
const NJ = 21;

/** Cocinero estilizado: chaqueta blanca, delantal azul marino, trapo en la cintura. Barato: ~12 draw calls. */
export class Cook {
  root = new THREE.Group();
  /** Pelvis (todo cuelga de aquí). */
  hips = new THREE.Bone();
  /** Torso (pecho, brazos, cabeza). Se mantiene el nombre `body` por compatibilidad. */
  body = new THREE.Bone();
  armL = new THREE.Bone();
  armR = new THREE.Bone();
  foreL = new THREE.Bone();
  foreR = new THREE.Bone();
  head = new THREE.Bone();
  thighL = new THREE.Bone();
  thighR = new THREE.Bone();
  shinL = new THREE.Bone();
  shinR = new THREE.Bone();
  apron = new THREE.Bone();
  knife: THREE.Mesh;
  mesh: THREE.SkinnedMesh;
  work: 'chop' | 'stir' | 'idle' | 'talk' = 'idle';
  walking = false;
  /** Velocidad de caminata en m/s (marca el ritmo y la amplitud de la zancada). */
  speed = 1.4;
  private phase = Math.random() * 10;
  private gait = 0;
  private walkW = 0;
  private idleP = new Float32Array(NJ);
  private walkP = new Float32Array(NJ);
  private look = 0;
  private lookT = 0;
  private lookTimer = 0;
  private hipBase = 0.9;

  constructor(o: CookOpts = {}) {
    const skin = o.skin ?? '#e0b48f';
    const hair = o.hair ?? '#141210';
    const apron = o.apron ?? '#22305a';
    const chef = !!o.chef;
    const style = o.hairStyle ?? 'crop';
    const hat = o.hat ?? 'none';

    // Esqueleto en pose de reposo
    this.hips.position.y = this.hipBase;
    for (const [th, sh, x] of [[this.thighL, this.shinL, -0.085], [this.thighR, this.shinR, 0.085]] as const) {
      th.position.set(x, -0.04, 0);
      sh.position.y = -0.42;
      th.add(sh);
      this.hips.add(th);
    }
    this.apron.position.set(0, 0.08, 0);
    this.hips.add(this.apron);
    this.body.position.y = 0.1;
    this.hips.add(this.body);
    this.head.position.y = 0.6;
    this.body.add(this.head);
    for (const [grp, fore, x] of [[this.armL, this.foreL, -0.188], [this.armR, this.foreR, 0.188]] as const) {
      grp.position.set(x, 0.49, 0);
      fore.position.y = -0.27;
      grp.add(fore);
      this.body.add(grp);
    }
    const bones = [this.hips, this.thighL, this.shinL, this.thighR, this.shinR, this.apron, this.body, this.head, this.armL, this.foreL, this.armR, this.foreR];
    this.root.add(this.hips);
    this.root.updateMatrixWorld(true);

    const key = JSON.stringify([skin, hair, apron, chef, style, hat]);
    let geo = geoCache.get(key);
    if (!geo) {
      const list: [Piece, number, THREE.Matrix4][] = [];
      const add = (bone: THREE.Bone, ps: Piece[]) => {
        const i = bones.indexOf(bone);
        for (const p of ps) list.push([p, i, bone.matrixWorld]);
      };
      // Piernas: muslo y pantorrilla con zueco
      for (const [th, sh] of [[this.thighL, this.shinL], [this.thighR, this.shinR]] as const) {
        add(th, [[B.thigh, PANTS, 0, -0.21, 0]]);
        add(sh, [
          [B.shin, PANTS, 0, -0.2, 0],
          [B.shoe, SHOE, 0, -0.43, 0.035, [1.05, 0.78, 1]],
          [B.sole, SOLE, 0, -0.472, 0.035],
        ]);
      }
      // Pelvis + cintura: pantalón, cinta del delantal con moño atrás, trapo colgando
      const hp: Piece[] = [[B.pelvis, PANTS, 0, 0.0, 0, [1, 1, 0.78]]];
      if (chef) hp.push([B.hem, JACKET, 0, 0.08, 0, [1, 1, 0.78]]);
      else {
        hp.push([B.band, apron, 0, 0.09, 0, [1, 1, 0.8]]);
        hp.push([B.bowLoop, apron, -0.03, 0.09, -0.15, [1.2, 0.8, 0.5]], [B.bowLoop, apron, 0.03, 0.09, -0.15, [1.2, 0.8, 0.5]]);
        hp.push([B.tie, apron, -0.02, 0.0, -0.152, undefined, [0, 0, 0.12]], [B.tie, apron, 0.025, -0.01, -0.152, undefined, [0, 0, -0.1]]);
        hp.push([B.towel, TOWEL, 0.18, -0.02, 0.02], [B.stripe, STRIPE, 0.181, -0.08, 0.02], [B.stripe, STRIPE, 0.181, -0.05, 0.02]);
        // Falda del delantal (se mece con las piernas)
        add(this.apron, [[B.skirt, apron, 0, -0.25, 0, [1, 1, 0.78]]]);
      }
      add(this.hips, hp);
      // Torso
      const tp: Piece[] = [
        [B.torso, JACKET, 0, 0.27, 0, [1.02, 1, 0.74]],
        [B.collar, JACKET, 0, 0.58, 0.0, [1, 1, 0.9]],
      ];
      if (chef) {
        // Chaqueta cruzada: doble fila de botones y vivo oscuro en el cuello
        for (let i = 0; i < 4; i++) for (const x of [-0.06, 0.07]) tp.push([B.button, '#202226', x, 0.47 - i * 0.09, 0.125]);
        tp.push([B.band, '#22305a', 0, 0.608, 0, [0.4, 0.5, 0.36]]);
      } else {
        tp.push([B.hem, JACKET, 0, -0.03, 0, [0.97, 0.6, 0.76]]);
        tp.push([B.bib, apron, 0, 0.33, 0.137, [1, 1.15, 1], [-0.1, 0, 0]]);
        tp.push([B.strap, apron, -0.072, 0.54, 0.088, [1, 0.75, 1], [-0.6, 0, 0.3]], [B.strap, apron, 0.072, 0.54, 0.088, [1, 0.75, 1], [-0.6, 0, -0.3]]);
        for (const x of [-0.13, 0.13]) tp.push([B.button, '#dcdcd6', x * 0.6, 0.5, 0.12]);
      }
      add(this.body, tp);
      // Cabeza: cara simple (ojos, cejas, nariz, boca), orejas y pelo/gorro
      const hd: Piece[] = [
        [B.neck, skin, 0, 0.03, 0],
        [B.head, skin, 0, 0.16, 0.005, [0.93, 1.02, 0.96]],
        [B.ear, skin, -0.108, 0.155, -0.005, [0.6, 1, 0.9]],
        [B.ear, skin, 0.108, 0.155, -0.005, [0.6, 1, 0.9]],
        [B.nose, skin, 0, 0.145, 0.116, [0.9, 1.1, 1]],
        [B.eye, '#1b1714', -0.042, 0.172, 0.1],
        [B.eye, '#1b1714', 0.042, 0.172, 0.1],
        [B.brow, hair, -0.044, 0.203, 0.104, undefined, [0, 0, 0.08]],
        [B.brow, hair, 0.044, 0.203, 0.104, undefined, [0, 0, -0.08]],
        [B.mouth, '#9b5a4c', 0, 0.112, 0.108],
      ];
      if (hat === 'none') {
        hd.push([B.hairCap, hair, 0, 0.175, -0.012, [1, style === 'short' ? 0.95 : 1.05, 1.02], [-0.32, 0, 0]]);
        if (style === 'bun') hd.push([B.bun, hair, 0, 0.26, -0.09]);
      } else {
        const hc = hat === 'cap' ? '#1a1c22' : '#2f4f9a';
        hd.push([B.hairCap, hair, 0, 0.17, -0.014, [1, 0.9, 1.02], [-0.4, 0, 0]]);
        hd.push([B.hatCap, hc, 0, 0.183, -0.008, [1, 1.05, 1.04], [-0.22, 0, 0]]);
        if (hat === 'bandana') hd.push([B.bowLoop, hc, 0, 0.17, -0.13, [0.9, 0.7, 0.6]]);
      }
      add(this.head, hd);
      // Brazos: hombro + manga; antebrazo arremangado (o manga larga en el chef) y mano
      for (const [up, fore] of [[this.armL, this.foreL], [this.armR, this.foreR]] as const) {
        add(up, [
          [B.shoulder, JACKET, 0, -0.01, 0],
          [B.upper, JACKET, 0, -0.14, 0],
        ]);
        add(fore, [
          [B.cuff, JACKET, 0, -0.02, 0],
          [B.fore, chef ? JACKET : skin, 0, -0.13, 0],
          ...(chef ? ([[B.cuff, JACKET, 0, -0.2, 0, [0.85, 1, 0.85]]] as Piece[]) : []),
          [B.hand, skin, 0, -0.265, 0.004, [0.82, 1.08, 0.62]],
          [B.thumb, skin, 0.012, -0.25, 0.022, [1, 1.5, 1]],
        ]);
      }
      geo = skinnedGeo(list);
      geoCache.set(key, geo);
    }
    this.mesh = new THREE.SkinnedMesh(geo, cookMat());
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    this.mesh.bind(new THREE.Skeleton(bones));

    // Cuchillo en la mano derecha (sólo visible al picar)
    this.knife = new THREE.Mesh(knifeGeo(), cookMat());
    this.knife.castShadow = true;
    this.knife.position.set(0, -0.28, 0.02);
    this.knife.rotation.x = -1.2;
    this.knife.visible = false;
    this.foreR.add(this.knife);
  }

  place(x: number, z: number, ry: number) {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = ry;
  }

  async walkTo(x: number, z: number, ry: number, speed = 1.4) {
    const p0 = this.root.position.clone();
    const p1 = new THREE.Vector3(x, 0, z);
    const r0 = this.root.rotation.y;
    const face = Math.atan2(p1.x - p0.x, p1.z - p0.z);
    this.speed = speed;
    this.walking = true;
    await tween(0.25, (k) => (this.root.rotation.y = r0 + shortAngle(r0, face) * k));
    await tween(p0.distanceTo(p1) / speed, (k) => this.root.position.lerpVectors(p0, p1, k), ease.linear);
    this.walking = false;
    await tween(0.3, (k) => (this.root.rotation.y = face + shortAngle(face, ry) * k));
  }

  update(dt: number, t: number) {
    dt = Math.min(dt, 0.1);
    const p = t + this.phase;
    this.walkW += ((this.walking && this.speed > 0.05 ? 1 : 0) - this.walkW) * Math.min(1, dt * 9);
    this.poseIdle(p, dt);
    if (this.walkW > 0.001) this.poseWalk(dt);
    const w = this.walkW, a = this.idleP, b = this.walkP;
    const q = (i: number) => a[i] + (b[i] - a[i]) * w;
    this.hips.position.y = this.hipBase + q(J.hipY);
    this.hips.rotation.set(q(J.hipRX), q(J.hipRY), q(J.hipRZ));
    this.body.rotation.set(q(J.torRX), q(J.torRY), q(J.torRZ));
    this.head.rotation.set(q(J.headRX), q(J.headRY), 0);
    this.armL.rotation.set(q(J.armLX), q(J.armLY), q(J.armLZ));
    this.armR.rotation.set(q(J.armRX), q(J.armRY), q(J.armRZ));
    this.foreL.rotation.x = q(J.foreLX);
    this.foreR.rotation.x = q(J.foreRX);
    this.thighL.rotation.x = q(J.thighLX);
    this.thighR.rotation.x = q(J.thighRX);
    this.shinL.rotation.x = q(J.shinLX);
    this.shinR.rotation.x = q(J.shinRX);
    // El delantal acompaña al muslo que va adelante
    this.apron.rotation.x = Math.min(0, this.thighL.rotation.x, this.thighR.rotation.x) * 0.75 - 0.02;
    this.knife.visible = this.work === 'chop' && w < 0.5;
  }

  /** Pose de pie según la tarea, con respiración y miradas ocasionales. */
  private poseIdle(p: number, dt: number) {
    const P = this.idleP;
    P.fill(0);
    const breath = Math.sin(p * 1.7);
    P[J.hipY] = breath * 0.003;
    P[J.torRX] = 0.02 + breath * 0.012;
    P[J.armLZ] = -0.07 - breath * 0.01;
    P[J.armRZ] = 0.07 + breath * 0.01;
    P[J.foreLX] = P[J.foreRX] = -0.15;
    P[J.thighLX] = P[J.thighRX] = 0.02;
    P[J.shinLX] = P[J.shinRX] = 0.03;
    // peso que cambia de pierna muy despacio
    const sway = Math.sin(p * 0.35);
    P[J.hipRZ] = sway * 0.025;
    P[J.thighLX] += sway * 0.02;
    P[J.shinLX] += Math.max(0, sway) * 0.08;
    P[J.shinRX] += Math.max(0, -sway) * 0.08;
    switch (this.work) {
      case 'chop': {
        const c = Math.max(0, Math.sin(p * 9));
        P[J.torRX] = 0.16;
        P[J.armLX] = -0.55;
        P[J.armLY] = 0.25;
        P[J.foreLX] = -1.05;
        P[J.armRX] = -0.45 - c * 0.22;
        P[J.armRY] = -0.15;
        P[J.foreRX] = -1.0 + c * 0.35;
        P[J.headRX] = 0.42;
        P[J.headRY] = Math.sin(p * 0.5) * 0.05;
        break;
      }
      case 'stir':
        P[J.torRX] = 0.1;
        P[J.armRX] = -0.75 + Math.sin(p * 3) * 0.14;
        P[J.armRZ] = 0.1 + Math.cos(p * 3) * 0.16;
        P[J.foreRX] = -0.85;
        P[J.armLX] = -0.25;
        P[J.foreLX] = -0.6;
        P[J.headRX] = 0.35;
        break;
      case 'talk':
        P[J.armRX] = -0.5 + Math.sin(p * 4) * 0.2;
        P[J.foreRX] = -1.0 + Math.sin(p * 5) * 0.25;
        P[J.armLX] = -0.15 + Math.sin(p * 2.3) * 0.08;
        P[J.foreLX] = -0.5;
        P[J.headRX] = Math.sin(p * 2) * 0.06;
        P[J.headRY] = Math.sin(p * 1.3) * 0.12;
        P[J.torRY] = Math.sin(p * 0.9) * 0.06;
        break;
      default: {
        // miradas: elige un objetivo nuevo cada pocos segundos y gira suave
        this.lookTimer -= dt;
        if (this.lookTimer <= 0) {
          this.lookT = (Math.random() - 0.5) * 1.0;
          this.lookTimer = 1.5 + Math.random() * 3;
        }
        this.look += (this.lookT - this.look) * Math.min(1, dt * 3);
        P[J.headRY] = this.look;
        P[J.torRY] = this.look * 0.15;
        P[J.headRX] = 0.04;
        P[J.armLX] = P[J.armRX] = breath * 0.03;
      }
    }
  }

  /** Ciclo de caminata: la frecuencia y la amplitud salen de la velocidad real. */
  private poseWalk(dt: number) {
    const P = this.walkP;
    const v = Math.max(0, this.speed);
    const cycle = 1.0 + 0.27 * v; // metros por ciclo (dos pasos)
    if (this.walking) this.gait += (dt * v * Math.PI * 2) / cycle;
    const f = this.gait;
    const a = Math.min(1.45, v / 2.2);
    const run = Math.max(0, Math.min(1, (v - 2.6) / 0.8));
    const s = Math.sin(f), c = Math.cos(f);
    P.fill(0);
    P[J.hipY] = (Math.cos(2 * f) * 0.022 - 0.012) * a - run * 0.03;
    P[J.hipRY] = s * 0.12 * a;
    P[J.hipRZ] = c * 0.035 * a;
    P[J.torRX] = 0.05 * a + run * 0.12;
    P[J.torRY] = -s * 0.2 * a;
    P[J.headRX] = -0.03 * a - run * 0.05;
    P[J.headRY] = s * 0.06 * a;
    const sw = 0.48 + run * 0.15;
    P[J.thighLX] = -s * sw * a;
    P[J.thighRX] = s * sw * a;
    P[J.shinLX] = (0.1 + Math.max(0, c) * (0.85 + run * 0.5)) * a;
    P[J.shinRX] = (0.1 + Math.max(0, -c) * (0.85 + run * 0.5)) * a;
    P[J.armLX] = s * (0.42 + run * 0.25) * a;
    P[J.armRX] = -s * (0.42 + run * 0.25) * a;
    P[J.armLZ] = -0.09;
    P[J.armRZ] = 0.09;
    P[J.foreLX] = -0.3 - (0.2 + run * 0.8) * a - Math.max(0, s) * 0.25 * a;
    P[J.foreRX] = -0.3 - (0.2 + run * 0.8) * a - Math.max(0, -s) * 0.25 * a;
  }
}

function shortAngle(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
