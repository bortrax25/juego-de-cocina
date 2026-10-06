import * as THREE from 'three/webgpu';
import { updateTweens, tween, ease, lerp } from './tween';

export interface View {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov?: number;
}

/**
 * Motor: renderer WebGPU (con fallback automático a WebGL2), cámara POV "celular en mano",
 * entrada unificada (mouse/touch/pen) y resolución dinámica para sostener 60 fps.
 */
export class Engine {
  renderer!: THREE.WebGPURenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 1, 0.03, 60);
  raycaster = new THREE.Raycaster();
  canvas: HTMLCanvasElement;
  backendName = '';

  // Rig de cámara
  private camPos = new THREE.Vector3(0, 1.6, 4);
  private camLook = new THREE.Vector3(0, 1, 0);
  private shakeAmt = 0;
  private time = 0;
  private walkBob = 0;
  handheld = 1;

  // Entrada
  pointer = new THREE.Vector2(); // NDC
  pointerPx = new THREE.Vector2();
  pointerDown = false;
  private downH = new Set<(e: PointerEvent) => void>();
  private moveH = new Set<(e: PointerEvent) => void>();
  private upH = new Set<(e: PointerEvent) => void>();

  private updaters = new Set<(dt: number, t: number) => void>();

  // Resolución dinámica
  private maxDpr = Math.min(window.devicePixelRatio || 1, 2);
  private dpr = this.maxDpr;
  private frameAcc = 0;
  private frameCount = 0;
  private lastT = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async init() {
    // WebGPU primero; si el navegador no lo soporta (o falló en una sesión previa) usamos WebGL2.
    const forceWebGL = new URLSearchParams(location.search).has('webgl') || sessionStorage.getItem('mise-webgl') === '1' || !('gpu' in navigator);
    const renderer = new THREE.WebGPURenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance', forceWebGL });
    await renderer.init();
    this.renderer = renderer;
    const backend = (renderer as unknown as { backend: { isWebGPUBackend?: boolean } }).backend;
    this.backendName = backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(this.dpr);
    this.resize();
    window.addEventListener('resize', () => this.resize());

    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      this.setPointer(e);
      this.pointerDown = true;
      c.setPointerCapture(e.pointerId);
      this.downH.forEach((h) => h(e));
    });
    c.addEventListener('pointermove', (e) => {
      this.setPointer(e);
      this.moveH.forEach((h) => h(e));
    });
    const up = (e: PointerEvent) => {
      this.setPointer(e);
      if (!this.pointerDown) return;
      this.pointerDown = false;
      this.upH.forEach((h) => h(e));
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  }

  private setPointer(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.pointerPx.set(e.clientX - r.left, e.clientY - r.top);
    this.pointer.set((this.pointerPx.x / r.width) * 2 - 1, -(this.pointerPx.y / r.height) * 2 + 1);
  }

  onDown(h: (e: PointerEvent) => void) { this.downH.add(h); return () => this.downH.delete(h); }
  onMove(h: (e: PointerEvent) => void) { this.moveH.add(h); return () => this.moveH.delete(h); }
  onUp(h: (e: PointerEvent) => void) { this.upH.add(h); return () => this.upH.delete(h); }
  addUpdate(fn: (dt: number, t: number) => void) { this.updaters.add(fn); return () => this.updaters.delete(fn); }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // En vertical (celular) abrimos el FOV para encuadrar la estación como en el video.
    this.camera.updateProjectionMatrix();
  }

  /** Rayo desde el puntero contra objetos. */
  hit(objects: THREE.Object3D[], recursive = true) {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(objects, recursive);
  }

  private plane = new THREE.Plane();
  private tmpV = new THREE.Vector3();
  /** Punto del puntero sobre un plano horizontal a altura y. */
  pointOnPlaneY(y: number, out = new THREE.Vector3()) {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.plane.set(new THREE.Vector3(0, 1, 0), -y);
    return this.raycaster.ray.intersectPlane(this.plane, out) ?? out.copy(this.tmpV);
  }

  /** Proyecta un punto 3D a píxeles de pantalla (para anclar UI HTML). */
  toScreen(p: THREE.Vector3, out = new THREE.Vector2()) {
    this.tmpV.copy(p).project(this.camera);
    return out.set((this.tmpV.x * 0.5 + 0.5) * window.innerWidth, (-this.tmpV.y * 0.5 + 0.5) * window.innerHeight);
  }

  setView(v: View) {
    this.camPos.copy(v.pos);
    this.camLook.copy(v.look);
    if (v.fov) this.camera.fov = v.fov;
    this.camera.updateProjectionMatrix();
  }

  /** Viaje de cámara entre estaciones con balanceo de caminata. */
  async moveTo(v: View, dur = 0.8) {
    const p0 = this.camPos.clone(), l0 = this.camLook.clone();
    const f0 = this.camera.fov, f1 = v.fov ?? f0;
    const dist = p0.distanceTo(v.pos);
    const d = Math.min(1.6, dur * (0.6 + dist * 0.12));
    const mid = p0.clone().lerp(v.pos, 0.5);
    mid.y = Math.max(p0.y, v.pos.y) + 0.12; // levantamos la vista al caminar
    await tween(d, (k) => {
      // curva cuadrática para que se sienta como girar el cuerpo
      const a = p0.clone().lerp(mid, k), b = mid.clone().lerp(v.pos, k);
      this.camPos.copy(a.lerp(b, k));
      this.camLook.copy(l0).lerp(v.look, ease.inOutCubic(Math.min(1, k * 1.15)));
      this.camera.fov = lerp(f0, f1, k);
      this.camera.updateProjectionMatrix();
      this.walkBob = Math.sin(k * Math.PI) * Math.min(1, dist * 0.3);
    }, ease.inOutCubic);
    this.walkBob = 0;
  }

  shake(a: number) {
    this.shakeAmt = Math.max(this.shakeAmt, a);
  }

  start(render: (dt: number) => void) {
    this.lastT = performance.now();
    const loop = () => {
      const now = performance.now();
      let dt = (now - this.lastT) / 1000;
      this.lastT = now;
      if (dt > 0.1) dt = 0.1;
      this.time += dt;
      updateTweens(dt);
      this.updaters.forEach((u) => u(dt, this.time));
      render(dt);
      this.applyCamera(dt);
      try {
        this.renderer.render(this.scene, this.camera);
      } catch (err) {
        this.fallback(err);
      }
      this.adaptResolution(dt);
    };
    this.renderer.setAnimationLoop(loop);
  }

  /** Si WebGPU falla en este navegador, recargamos una vez con el backend WebGL2. */
  fallback(err: unknown) {
    if (this.backendName === 'WebGPU' && sessionStorage.getItem('mise-webgl') !== '1') {
      console.warn('WebGPU falló, usando WebGL2', err);
      sessionStorage.setItem('mise-webgl', '1');
      location.reload();
      return;
    }
    throw err;
  }

  private applyCamera(dt: number) {
    const t = this.time;
    const h = this.handheld;
    // Ruido de "celular en mano": suma de senos lentos (barato y suave)
    const nx = (Math.sin(t * 1.3) * 0.6 + Math.sin(t * 2.7 + 1.3) * 0.4) * 0.004 * h;
    const ny = (Math.sin(t * 1.7 + 0.5) * 0.6 + Math.sin(t * 3.1) * 0.4) * 0.003 * h;
    const bob = Math.sin(t * 9) * 0.025 * this.walkBob;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 3);
    const s = this.shakeAmt * this.shakeAmt;
    const sx = (Math.random() - 0.5) * s * 0.03, sy = (Math.random() - 0.5) * s * 0.03;
    this.camera.position.set(this.camPos.x + nx + sx, this.camPos.y + ny + bob + sy, this.camPos.z);
    this.tmpV.set(this.camLook.x + nx * 0.5, this.camLook.y + ny * 0.5, this.camLook.z);
    this.camera.lookAt(this.tmpV);
    this.camera.rotateZ(Math.sin(t * 0.9) * 0.004 * h + sx * 2);
  }

  private adaptResolution(dt: number) {
    this.frameAcc += dt;
    this.frameCount++;
    if (this.frameAcc < 1.5) return;
    const avg = this.frameAcc / this.frameCount;
    this.frameAcc = 0;
    this.frameCount = 0;
    let next = this.dpr;
    if (avg > 1 / 50) next = Math.max(0.6, this.dpr - 0.2);
    else if (avg < 1 / 58 && this.dpr < this.maxDpr) next = Math.min(this.maxDpr, this.dpr + 0.1);
    if (Math.abs(next - this.dpr) > 0.01) {
      this.dpr = next;
      this.renderer.setPixelRatio(next);
      this.resize();
    }
  }
}
