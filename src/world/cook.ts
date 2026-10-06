import * as THREE from 'three/webgpu';
import { mats } from './materials';
import { tween, ease } from '../core/tween';

interface CookOpts {
  hair?: string;
  skin?: string;
  chef?: boolean;
}

const geo = {
  leg: new THREE.CapsuleGeometry(0.075, 0.7, 4, 8),
  torso: new THREE.CapsuleGeometry(0.19, 0.42, 6, 14),
  apron: new THREE.BoxGeometry(0.34, 0.75, 0.03),
  arm: new THREE.CapsuleGeometry(0.055, 0.26, 4, 8),
  fore: new THREE.CapsuleGeometry(0.045, 0.24, 4, 8),
  head: new THREE.SphereGeometry(0.115, 18, 14),
  hair: new THREE.SphereGeometry(0.122, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
  neck: new THREE.CylinderGeometry(0.05, 0.055, 0.08, 10),
  button: new THREE.SphereGeometry(0.012, 6, 4),
  shoe: new THREE.BoxGeometry(0.1, 0.06, 0.24),
};

/** Cocinero low-poly con chaqueta blanca y delantal azul marino (como el equipo del video). */
export class Cook {
  root = new THREE.Group();
  body = new THREE.Group();
  armL = new THREE.Group();
  armR = new THREE.Group();
  foreL = new THREE.Group();
  foreR = new THREE.Group();
  head = new THREE.Group();
  work: 'chop' | 'stir' | 'idle' | 'talk' = 'idle';
  private phase = Math.random() * 10;
  walking = false;

  constructor(o: CookOpts = {}) {
    const m = mats();
    const skin = o.skin ? new THREE.MeshStandardMaterial({ color: o.skin, roughness: 0.7 }) : m.skin;
    const hair = o.hair ? new THREE.MeshStandardMaterial({ color: o.hair, roughness: 0.85 }) : m.hair;
    for (const x of [-0.09, 0.09]) {
      const leg = new THREE.Mesh(geo.leg, m.pants);
      leg.position.set(x, 0.45, 0);
      this.root.add(leg);
      const shoe = new THREE.Mesh(geo.shoe, m.black);
      shoe.position.set(x, 0.03, 0.04);
      this.root.add(shoe);
    }
    this.body.position.y = 0.9;
    this.root.add(this.body);
    const torso = new THREE.Mesh(geo.torso, m.jacket);
    torso.position.y = 0.36;
    torso.scale.set(1, 1, 0.72);
    this.body.add(torso);
    if (!o.chef) {
      const apron = new THREE.Mesh(geo.apron, m.apron);
      apron.position.set(0, 0.12, 0.145);
      this.body.add(apron);
      const bib = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.02), m.apron);
      bib.position.set(0, 0.5, 0.13);
      this.body.add(bib);
    } else {
      // Chaqueta cruzada: doble fila de botones
      for (let i = 0; i < 4; i++)
        for (const x of [-0.07, 0.07]) {
          const btn = new THREE.Mesh(geo.button, m.white);
          btn.position.set(x, 0.55 - i * 0.09, 0.14);
          this.body.add(btn);
        }
      const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.2, 0.25, 14), m.jacket);
      hem.scale.z = 0.72;
      hem.position.y = 0.05;
      this.body.add(hem);
    }
    const neck = new THREE.Mesh(geo.neck, skin);
    neck.position.y = 0.72;
    this.body.add(neck);
    this.head.position.y = 0.84;
    this.body.add(this.head);
    const h = new THREE.Mesh(geo.head, skin);
    h.scale.set(0.92, 1.05, 0.98);
    this.head.add(h);
    const hr = new THREE.Mesh(geo.hair, hair);
    hr.rotation.x = -0.25;
    hr.position.set(0, 0.02, -0.01);
    this.head.add(hr);

    for (const [grp, fore, x] of [[this.armL, this.foreL, -0.23], [this.armR, this.foreR, 0.23]] as const) {
      grp.position.set(x, 0.62, 0);
      this.body.add(grp);
      const up = new THREE.Mesh(geo.arm, m.jacket);
      up.position.y = -0.15;
      grp.add(up);
      fore.position.y = -0.3;
      grp.add(fore);
      const f = new THREE.Mesh(geo.fore, o.chef ? m.jacket : skin);
      f.position.y = -0.13;
      fore.add(f);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), skin);
      hand.position.y = -0.28;
      fore.add(hand);
    }
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
    this.walking = true;
    await tween(0.25, (k) => (this.root.rotation.y = r0 + shortAngle(r0, face) * k));
    await tween(p0.distanceTo(p1) / speed, (k) => this.root.position.lerpVectors(p0, p1, k), ease.linear);
    this.walking = false;
    await tween(0.3, (k) => (this.root.rotation.y = face + shortAngle(face, ry) * k));
  }

  update(dt: number, t: number) {
    const p = t * 1 + this.phase;
    this.body.position.y = 0.9 + Math.sin(p * 1.6) * 0.004;
    if (this.walking) {
      const s = Math.sin(t * 9);
      this.armL.rotation.x = s * 0.5;
      this.armR.rotation.x = -s * 0.5;
      this.foreL.rotation.x = this.foreR.rotation.x = -0.3;
      this.body.position.y = 0.9 + Math.abs(s) * 0.02;
      return;
    }
    switch (this.work) {
      case 'chop': {
        this.armL.rotation.x = -0.7;
        this.foreL.rotation.x = -0.9;
        const c = Math.max(0, Math.sin(p * 9));
        this.armR.rotation.x = -0.6 - c * 0.25;
        this.foreR.rotation.x = -0.9 + c * 0.3;
        this.head.rotation.x = 0.35;
        break;
      }
      case 'stir':
        this.armR.rotation.x = -0.8 + Math.sin(p * 3) * 0.15;
        this.armR.rotation.z = Math.cos(p * 3) * 0.15;
        this.foreR.rotation.x = -0.8;
        this.armL.rotation.x = -0.2;
        this.head.rotation.x = 0.3;
        break;
      case 'talk':
        this.armR.rotation.x = -0.5 + Math.sin(p * 4) * 0.2;
        this.foreR.rotation.x = -1.0 + Math.sin(p * 5) * 0.2;
        this.armL.rotation.x = -0.1;
        this.head.rotation.x = Math.sin(p * 2) * 0.05;
        this.head.rotation.y = Math.sin(p * 1.3) * 0.1;
        break;
      default:
        this.armL.rotation.x = this.armR.rotation.x = Math.sin(p) * 0.04;
        this.foreL.rotation.x = this.foreR.rotation.x = -0.15;
        this.head.rotation.y = Math.sin(p * 0.4) * 0.35;
        this.head.rotation.x = 0.05;
    }
    void dt;
  }
}

function shortAngle(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
