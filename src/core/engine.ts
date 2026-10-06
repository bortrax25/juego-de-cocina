import * as THREE from 'three/webgpu';
import { updateTweens, tween, ease, lerp } from './tween';

export interface View {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov?: number;
}

interface Transition {
  t: number;
  dur: number;
  p0: THREE.Vector3;
  l0: THREE.Vector3;
  f0: number;
  to: () => { pos: THREE.Vector3; look: THREE.Vector3; fov: number };
  resolve: () => void;
}

const D2R = Math.PI / 180;
/** Parámetros de la cámara de seguimiento en tercera persona. */
export const FOLLOW = {
  pitch: 52 * D2R, // ángulo ideal hacia abajo
  pitchMin: 40 * D2R, // lo mínimo que bajamos por el techo
  pitchFloor: 24 * D2R, // lo mínimo que bajamos para esquivar campanas
  fov: 46,
  fovMax: 70,
  fovMaxPortrait: 80,
  focusY: 0.5, // altura del foco (cintura del personaje)
  maxY: 2.85,
  zoomMin: 3.5,
  zoomMax: 8,
  smooth: 0.24, // tiempo de suavizado del foco (s)
  lookAhead: 0.42, // segundos de anticipación
  lookAheadMax: 0.9,
  lead: 0.4, // el foco va por delante del personaje (m)
  leadPortrait: 0.75,
  bounds: { minX: -6.6, maxX: 6.6, minZ: -4.6, maxZ: 4.8 },
};

/** SmoothDamp críticamente amortiguado (estable con dt variable). Devuelve [valor, velocidad]. */
function damp(cur: number, target: number, vel: number, smooth: number, dt: number): [number, number] {
  const omega = 2 / Math.max(1e-4, smooth);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target;
  const temp = (vel + omega * change) * dt;
  return [target + (change + temp) * exp, (vel - omega * temp) * exp];
}

function dampV(cur: THREE.Vector3, target: THREE.Vector3, vel: THREE.Vector3, smooth: number, dt: number) {
  [cur.x, vel.x] = damp(cur.x, target.x, vel.x, smooth, dt);
  [cur.y, vel.y] = damp(cur.y, target.y, vel.y, smooth, dt);
  [cur.z, vel.z] = damp(cur.z, target.z, vel.z, smooth, dt);
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

  // Cámara de seguimiento en tercera persona
  /** Giro horizontal de la cámara de seguimiento (0 = mirando hacia -z, la pared del fondo). */
  followYaw = 0;
  /** Distancia de encuadre deseada (rueda / pellizco), en [ZOOM_MIN, ZOOM_MAX]. */
  followZoom = 5.5;
  /** Volúmenes altos (campanas, estantes) que no deben tapar al personaje: la cámara baja el ángulo para esquivarlos. */
  camOccluders: THREE.Box3[] = [];
  /** Punteros que otro sistema ya usa (p. ej. el joystick): no cuentan para el pellizco. */
  reservedPointers = new Set<number>();
  /** Si está definido, el bucle lo llama en vez de renderer.render (post-procesado). */
  renderOverride: (() => void) | null = null;
  private followTarget: THREE.Object3D | null = null;
  private camMode: 'follow' | 'locked' | 'free' = 'free';
  private fFocus = new THREE.Vector3();
  private fFocusVel = new THREE.Vector3();
  private fAhead = new THREE.Vector3();
  private fAheadVel = new THREE.Vector3();
  private fLastTarget = new THREE.Vector3();
  private fVel = new THREE.Vector3();
  private fDist = 5.5;
  private fDistVel = 0;
  private fPitch = FOLLOW.pitch;
  private fPitchVel = 0;
  private fFresh = true;
  private fPos = new THREE.Vector3();
  private fLook = new THREE.Vector3();
  private fFov = FOLLOW.fov;
  private trans: Transition | null = null;
  private touches = new Map<number, { x: number; y: number }>();
  private pinchD = 0;

  // Entrada
  pointer = new THREE.Vector2(); // NDC
  pointerPx = new THREE.Vector2();
  pointerDown = false;
  private activeId = -1;
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
  private upBlockedUntil = 0; // no subir resolución antes de este instante (anti-oscilación)
  private downCount = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async init() {
    // WebGPU primero; si el navegador no lo soporta (o falló en una sesión previa) usamos WebGL2.
    const forceWebGL = new URLSearchParams(location.search).has('webgl') || readFlag() || !('gpu' in navigator);
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
    // Sólo seguimos un puntero a la vez: un segundo dedo no debe cortar ni duplicar el gesto.
    c.addEventListener('pointerdown', (e) => {
      if (this.pointerDown) return;
      this.setPointer(e);
      this.pointerDown = true;
      this.activeId = e.pointerId;
      try { c.setPointerCapture(e.pointerId); } catch { /* puntero ya liberado */ }
      this.downH.forEach((h) => h(e));
    });
    c.addEventListener('pointermove', (e) => {
      if (this.pointerDown && e.pointerId !== this.activeId) return;
      this.setPointer(e);
      this.moveH.forEach((h) => h(e));
    });
    const up = (e: PointerEvent) => {
      if (this.pointerDown && e.pointerId !== this.activeId) return;
      this.setPointer(e);
      if (!this.pointerDown) return;
      this.pointerDown = false;
      this.activeId = -1;
      this.upH.forEach((h) => h(e));
    };
    c.addEventListener('lostpointercapture', up);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);

    // Zoom de la cámara de seguimiento: rueda del mouse y pellizco con dos dedos
    c.addEventListener('wheel', (e) => {
      if (this.camMode !== 'follow') return;
      e.preventDefault();
      this.zoomBy(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.pinchD = this.pinchDist();
    });
    c.addEventListener('pointermove', (e) => {
      const t = this.touches.get(e.pointerId);
      if (!t) return;
      t.x = e.clientX;
      t.y = e.clientY;
      const d = this.pinchDist();
      if (d > 0 && this.pinchD > 0 && this.camMode === 'follow') this.zoomBy(this.pinchD / d);
      this.pinchD = d;
    });
    const tEnd = (e: PointerEvent) => {
      if (!this.touches.delete(e.pointerId)) return;
      this.pinchD = this.pinchDist();
    };
    c.addEventListener('pointerup', tEnd);
    c.addEventListener('pointercancel', tEnd);
  }

  /** Distancia entre los dos primeros dedos libres (0 si no hay dos). */
  private pinchDist() {
    let a: { x: number; y: number } | null = null;
    for (const [id, t] of this.touches) {
      if (this.reservedPointers.has(id)) continue;
      if (!a) a = t;
      else return Math.hypot(t.x - a.x, t.y - a.y);
    }
    return 0;
  }

  /** ¿Hay un pellizco en curso? (para que la entrada no lo tome como toque) */
  get pinching() {
    return this.pinchDist() > 0;
  }

  private zoomBy(k: number) {
    this.followZoom = THREE.MathUtils.clamp(this.followZoom * k, FOLLOW.zoomMin, FOLLOW.zoomMax);
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
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpC = new THREE.Vector3();
  private tmpD = new THREE.Vector3();
  private ray = new THREE.Ray();
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

  /** Modo actual de la cámara. 'free' = setView/moveTo clásicos. */
  get mode() {
    return this.camMode;
  }

  /** Activa la cámara de seguimiento en tercera persona (null = volver a cámara libre). */
  setFollow(target: THREE.Object3D | null) {
    this.followTarget = target;
    this.fFresh = true;
    if (!target) {
      if (this.camMode === 'follow') this.camMode = 'free';
      return;
    }
    if (this.camMode !== 'locked') {
      this.endTransition();
      this.camMode = 'follow';
    }
  }

  /** Re-centra el seguimiento al instante (después de teletransportar al objetivo). */
  snapFollow() {
    this.fFresh = true;
  }

  /** Vuela suavemente a una vista fija (POV de minijuego) y se queda ahí. Suspende el seguimiento. */
  lockView(v: View, dur = 1.0): Promise<void> {
    this.camMode = 'locked';
    const to = { pos: v.pos.clone(), look: v.look.clone(), fov: v.fov ?? this.camera.fov };
    return this.startTransition(dur, () => to);
  }

  /** Vuelve volando al encuadre de seguimiento y lo reanuda. */
  releaseView(dur = 0.9): Promise<void> {
    if (!this.followTarget) {
      this.camMode = 'free';
      return Promise.resolve();
    }
    this.camMode = 'follow';
    this.fFresh = true;
    this.updateFollow(0); // encuadre destino actualizado (sigue al personaje durante el vuelo)
    return this.startTransition(dur, () => ({ pos: this.fPos, look: this.fLook, fov: this.fFov }));
  }

  private startTransition(dur: number, to: () => { pos: THREE.Vector3; look: THREE.Vector3; fov: number }) {
    this.endTransition();
    return new Promise<void>((resolve) => {
      const p0 = this.camPos.clone(), l0 = this.camLook.clone();
      const end = to();
      const dist = p0.distanceTo(end.pos);
      // duración proporcional al recorrido, sin exagerar
      const d = dur <= 0 ? 0 : THREE.MathUtils.clamp(dur * (0.65 + dist * 0.12), dur * 0.6, dur * 1.5);
      this.trans = { t: 0, dur: d, p0, l0, f0: this.camera.fov, to, resolve };
      if (d === 0) this.stepTransition(0);
    });
  }

  private endTransition() {
    const tr = this.trans;
    if (!tr) return;
    this.trans = null;
    tr.resolve();
  }

  /** Grúa: curva cuadrática que mantiene la altura al principio y baja al final (o al revés). */
  private stepTransition(dt: number) {
    const tr = this.trans!;
    tr.t += dt;
    const k = tr.dur > 0 ? Math.min(1, tr.t / tr.dur) : 1;
    const end = tr.to();
    const e = ease.inOutCubic(k);
    const ctrl = this.tmpC.copy(tr.p0).lerp(end.pos, 0.62);
    ctrl.y = Math.min(FOLLOW.maxY, Math.max(tr.p0.y, end.pos.y));
    const a = this.tmpA.copy(tr.p0).lerp(ctrl, e), b = this.tmpB.copy(ctrl).lerp(end.pos, e);
    this.camPos.copy(a.lerp(b, e));
    this.camLook.copy(tr.l0).lerp(end.look, ease.inOutCubic(Math.min(1, k * 1.12)));
    this.camera.fov = lerp(tr.f0, end.fov, 0.5 - Math.cos(Math.PI * k) / 2);
    this.camera.updateProjectionMatrix();
    if (k >= 1) {
      this.trans = null;
      tr.resolve();
    }
  }

  setView(v: View) {
    this.toFree();
    this.camPos.copy(v.pos);
    this.camLook.copy(v.look);
    if (v.fov) this.camera.fov = v.fov;
    this.camera.updateProjectionMatrix();
  }

  /** Viaje de cámara entre estaciones con balanceo de caminata. */
  async moveTo(v: View, dur = 0.8) {
    this.toFree();
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

  /** setView/moveTo toman el control: se suspende el seguimiento (releaseView lo retoma). */
  private toFree() {
    this.endTransition();
    this.camMode = 'free';
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
        if (this.renderOverride) this.renderOverride();
        else this.renderer.render(this.scene, this.camera);
      } catch (err) {
        this.fallback(err);
      }
      this.adaptResolution(dt);
    };
    this.renderer.setAnimationLoop(loop);
  }

  /** Si WebGPU falla en este navegador, recargamos una vez con el backend WebGL2. */
  fallback(err: unknown) {
    if (this.backendName === 'WebGPU' && !readFlag()) {
      console.warn('WebGPU falló, usando WebGL2', err);
      try {
        sessionStorage.setItem('mise-webgl', '1');
        location.reload();
      } catch {
        location.search = '?webgl';
      }
      return;
    }
    throw err;
  }

  private applyCamera(dt: number) {
    if (this.trans) {
      if (this.camMode === 'follow') this.updateFollow(dt);
      this.stepTransition(dt);
    } else if (this.camMode === 'follow') {
      this.updateFollow(dt);
      this.camPos.copy(this.fPos);
      this.camLook.copy(this.fLook);
      if (Math.abs(this.camera.fov - this.fFov) > 1e-3) {
        this.camera.fov = this.fFov;
        this.camera.updateProjectionMatrix();
      }
    }
    const t = this.time;
    // En seguimiento la cámara es "de juego": sólo una deriva lenta, sin temblor
    const follow = this.camMode === 'follow' && !this.trans;
    const h = this.handheld * (follow ? 0.35 : 1);
    // Ruido de "celular en mano": suma de senos lentos (barato y suave)
    const nx = (Math.sin(t * 1.3) * 0.6 + Math.sin(t * 2.7 + 1.3) * 0.4) * (follow ? 0.012 : 0.004) * h;
    const ny = (Math.sin(t * 1.7 + 0.5) * 0.6 + Math.sin(t * 3.1) * 0.4) * (follow ? 0.008 : 0.003) * h;
    const bob = Math.sin(t * 9) * 0.025 * this.walkBob;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 3);
    const s = this.shakeAmt * this.shakeAmt;
    const sx = (Math.random() - 0.5) * s * 0.03, sy = (Math.random() - 0.5) * s * 0.03;
    this.camera.position.set(this.camPos.x + nx + sx, this.camPos.y + ny + bob + sy, this.camPos.z);
    this.tmpV.set(this.camLook.x + nx * 0.5, this.camLook.y + ny * 0.5, this.camLook.z);
    this.camera.lookAt(this.tmpV);
    this.camera.rotateZ(Math.sin(t * 0.9) * (follow ? 0.0015 : 0.004) * h + sx * 2);
  }

  /**
   * Encuadre de seguimiento: foco con resorte críticamente amortiguado + anticipación hacia donde
   * camina el personaje. La sala tiene 3 m de alto, así que el ángulo y el FOV se ajustan para
   * mantener el encuadre pedido sin atravesar techo ni paredes.
   */
  private updateFollow(dt: number) {
    const tg = this.followTarget;
    if (!tg) return;
    const T = tg.getWorldPosition(this.tmpA);
    if (this.fFresh || dt <= 0) {
      if (this.fFresh) {
        const lead = this.camera.aspect < 1 ? FOLLOW.leadPortrait : FOLLOW.lead;
        this.fFocus.set(T.x - Math.sin(this.followYaw) * lead, FOLLOW.focusY, T.z - Math.cos(this.followYaw) * lead);
        this.fFocusVel.set(0, 0, 0);
        this.fAhead.set(0, 0, 0);
        this.fAheadVel.set(0, 0, 0);
        this.fVel.set(0, 0, 0);
        this.fDist = this.followZoom;
        this.fDistVel = 0;
        this.fPitch = this.bestPitch(this.fFocus, this.fDist);
        this.fPitchVel = 0;
        this.fLastTarget.copy(T);
        this.fFresh = false;
      }
    } else {
      // velocidad del objetivo (suavizada) -> anticipación
      this.tmpB.subVectors(T, this.fLastTarget).divideScalar(dt);
      this.tmpB.y = 0;
      if (this.tmpB.lengthSq() > 100) this.tmpB.set(0, 0, 0); // teletransporte
      this.fVel.lerp(this.tmpB, 1 - Math.exp(-dt * 8));
      this.fLastTarget.copy(T);
      this.tmpB.copy(this.fVel).multiplyScalar(FOLLOW.lookAhead);
      // hacia la cámara (+z) anticipamos menos: el personaje ya se ve de frente
      if (this.tmpB.z > 0) this.tmpB.z *= 0.45;
      this.tmpB.clampLength(0, FOLLOW.lookAheadMax);
      dampV(this.fAhead, this.tmpB, this.fAheadVel, 0.55, dt);
      // el foco va un poco por delante (hacia donde mira la cámara): se ve más cocina y menos piso
      const lead = this.camera.aspect < 1 ? FOLLOW.leadPortrait : FOLLOW.lead;
      this.tmpB.set(T.x + this.fAhead.x - Math.sin(this.followYaw) * lead, FOLLOW.focusY, T.z + this.fAhead.z - Math.cos(this.followYaw) * lead);
      dampV(this.fFocus, this.tmpB, this.fFocusVel, FOLLOW.smooth, dt);
      [this.fDist, this.fDistVel] = damp(this.fDist, this.followZoom, this.fDistVel, 0.2, dt);
      const wantPitch = this.bestPitch(this.fFocus, this.fDist);
      [this.fPitch, this.fPitchVel] = damp(this.fPitch, wantPitch, this.fPitchVel, 0.35, dt);
    }
    this.fFov = this.frame(this.fFocus, this.fDist, this.fPitch, this.fPos);
    this.fLook.copy(this.fFocus);
  }

  /** Primer ángulo (de más alto a más bajo) cuya línea de visión no cruza campanas/estantes. */
  private bestPitch(focus: THREE.Vector3, dist: number) {
    const top = this.ceilPitch(dist);
    if (!this.camOccluders.length) return top;
    for (let p = top; p >= FOLLOW.pitchFloor; p -= 0.035) {
      this.frame(focus, dist, p, this.tmpC);
      if (!this.occluded(focus, this.tmpC)) return p;
    }
    return top;
  }

  /** Ángulo preferido para una distancia: 52° si cabe bajo el techo, si no lo justo (mín. pitchMin). */
  private ceilPitch(dist: number) {
    const room = FOLLOW.maxY - FOLLOW.focusY;
    const p = dist * Math.sin(FOLLOW.pitch) <= room ? FOLLOW.pitch : Math.asin(room / dist);
    return Math.max(FOLLOW.pitchMin, Math.min(FOLLOW.pitch, p));
  }

  /** Calcula la posición de cámara para foco/distancia/ángulo dentro de la sala. Devuelve el FOV. */
  private frame(focus: THREE.Vector3, dist: number, pitch: number, out: THREE.Vector3) {
    const B = FOLLOW.bounds;
    let dy = Math.min(dist * Math.sin(pitch), FOLLOW.maxY - focus.y);
    let hz = dy / Math.tan(pitch);
    const sx = Math.sin(this.followYaw), sz = Math.cos(this.followYaw);
    // acortamos el brazo horizontal antes que salir de la sala (manteniendo la altura: más cenital)
    if (sz > 1e-4) hz = Math.min(hz, (B.maxZ - focus.z) / sz);
    if (sz < -1e-4) hz = Math.min(hz, (B.minZ - focus.z) / sz);
    if (sx > 1e-4) hz = Math.min(hz, (B.maxX - focus.x) / sx);
    if (sx < -1e-4) hz = Math.min(hz, (B.minX - focus.x) / sx);
    hz = Math.max(0.35, hz);
    out.set(
      THREE.MathUtils.clamp(focus.x + sx * hz, B.minX, B.maxX),
      focus.y + dy,
      THREE.MathUtils.clamp(focus.z + sz * hz, B.minZ, B.maxZ),
    );
    dy = out.y - focus.y;
    const eff = Math.hypot(hz, dy);
    // compensamos con FOV la distancia que no entra, para conservar el tamaño del encuadre;
    // en vertical (celular) abrimos más para que entre el ancho del pasillo
    const asp = this.camera.aspect;
    const k = asp < 1 ? Math.min(1.4, 0.8 / asp) : 1;
    const half = Math.atan((Math.tan(THREE.MathUtils.degToRad(FOLLOW.fov / 2)) * dist * k) / eff);
    return Math.min(asp < 1 ? FOLLOW.fovMaxPortrait : FOLLOW.fovMax, THREE.MathUtils.radToDeg(half * 2));
  }

  private occluded(a: THREE.Vector3, b: THREE.Vector3) {
    const dir = this.tmpB.subVectors(b, a);
    const len = dir.length();
    this.ray.set(a, dir.divideScalar(len));
    for (const box of this.camOccluders) {
      const hit = this.ray.intersectBox(box, this.tmpD);
      if (hit && hit.distanceTo(a) < len) return true;
    }
    return false;
  }

  private adaptResolution(dt: number) {
    this.frameAcc += dt;
    this.frameCount++;
    if (this.frameAcc < 1.5) return;
    const avg = this.frameAcc / this.frameCount;
    this.frameAcc = 0;
    this.frameCount = 0;
    let next = this.dpr;
    const now = performance.now();
    if (avg > 1 / 50) {
      next = Math.max(0.6, this.dpr - 0.2);
      // Cada bajada alarga la espera antes de volver a subir (evita el sube/baja constante)
      if (next < this.dpr) {
        this.downCount++;
        this.upBlockedUntil = now + Math.min(60000, 6000 * this.downCount);
      }
    } else if (avg < 1 / 58 && this.dpr < this.maxDpr && now > this.upBlockedUntil) next = Math.min(this.maxDpr, this.dpr + 0.1);
    if (Math.abs(next - this.dpr) > 0.01) {
      this.dpr = next;
      this.renderer.setPixelRatio(next);
      this.resize();
    }
  }
}

function readFlag() {
  try {
    return sessionStorage.getItem('mise-webgl') === '1';
  } catch {
    return false;
  }
}
