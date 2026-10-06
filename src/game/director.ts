import * as THREE from 'three/webgpu';
import type { Engine, View } from '../core/engine';
import { STATIONS, OVERVIEW, type Kitchen, type StationId } from '../world/kitchen';
import type { FX } from '../world/fx';
import type { UI, TaskView } from '../ui/ui';
import { TASKS, EVENTS, DAY_NAMES, LAST_DAY, type TaskDef, type EventDef } from './tasks';
import { fmtTime, hm } from './clock';
import { audio } from '../core/audio';
import { wait, pick, clamp } from '../core/tween';
import type { Minigame, MGContext } from '../minigames/base';
import { SliceGame } from '../minigames/slice';
import { FillGame } from '../minigames/fill';
import { CookGame } from '../minigames/cook';
import { PickGame } from '../minigames/pick';
import { CoatGame } from '../minigames/coat';
import { SortGame } from '../minigames/sort';
import { ShuckGame } from '../minigames/shuck';
import { SwipeGame } from '../minigames/swipe';
import { SequenceGame } from '../minigames/sequence';
import { load, save, type SaveData } from './save';
import type { Player } from '../world/player';
import { standPoint } from '../world/player';
import type { Input } from '../core/input';

type Status = 'locked' | 'open' | 'active' | 'done' | 'failed';

interface TaskInst {
  uid: number;
  def: TaskDef;
  status: Status;
  unlockAt: number;
  deadline: number;
  urgent: boolean;
  quality?: number;
  doneAt?: number;
}

const GAMES = {
  slice: SliceGame, fill: FillGame, cook: CookGame, pick: PickGame, coat: CoatGame,
  sort: SortGame, shuck: ShuckGame, swipe: SwipeGame, sequence: SequenceGame,
} as const;

const PRAISE = ['Así se hace.', 'Limpio. Me gusta.', 'Eso es nivel Michelin.', 'Bien, sigue así.', 'Perfecto, chef.'];
const MEH = ['Aceptable. Puede estar mejor.', 'Más prolijo la próxima.', 'Ok. Concéntrate.'];
const BAD = ['¿Esto es nivel Michelin?', 'No puedo servir eso.', 'Más cuidado. Rehacemos mañana.'];
const LATE = ['¿Dónde está lo que te pedí?', 'Llegamos tarde con eso. Inaceptable.', 'El servicio no espera a nadie.'];

/** Orquesta el día: reloj, tickets, imprevistos, viajes entre estaciones y la nota del chef. */
export class Director {
  save: SaveData = load();
  day = 1;
  clock = hm(6, 40);
  rate = 1; // minutos de juego por segundo real
  tasks: TaskInst[] = [];
  approval = 70;
  running = false;
  paused = false;
  private uid = 0;
  private busy = false; // viajando o en minijuego
  private idle = 0;
  private events: { at: number; def: EventDef; fired: boolean }[] = [];
  private listT = 0;
  private injuries = 0;
  private familyQ: number[] = [];
  private familyPraised = false;
  private where: StationId | null = null;
  private hint = '';
  private player: Player | null = null;
  private input: Input | null = null;
  private near: TaskInst | null = null;
  private walkingTo = 0;
  private marker = new THREE.Group();
  private guide = new THREE.Group();
  private current: Minigame | null = null;
  private log: { at: number; text: string }[] = [];
  onEnd: (summary: string, stars: number) => void = () => {};

  constructor(private eng: Engine, private kitchen: Kitchen, private fx: FX, private ui: UI) {
    ui.onSelectTask = (uid) => this.select(uid);
    audio.setMuted(this.save.muted);
    eng.handheld = this.save.reduceMotion ? 0 : 1;
  }

  /** Conecta al jugador en tercera persona: caminar hasta la estación e interactuar. */
  attach(player: Player, input: Input) {
    this.player = player;
    this.input = input;
    input.onInteract(() => {
      if (this.near) this.select(this.near.uid);
    });
    input.onTapGround((pt) => {
      if (!this.running || this.busy || this.paused) return;
      this.walkingTo = 0;
      player.walkTo(pt.x, pt.z);
    });
    // Marcador del próximo ticket: aro en el piso + rombo flotante (estilo juego .io)
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffc94a', transparent: true, opacity: 0.85, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.34, 40), new THREE.MeshBasicMaterial({ color: '#ffc94a', transparent: true, opacity: 0.16, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.011;
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.11), new THREE.MeshStandardMaterial({ color: '#ffc94a', emissive: '#ff9d00', emissiveIntensity: 1.4, roughness: 0.3 }));
    gem.scale.y = 1.5;
    gem.position.y = 2.15;
    this.marker.add(ring, disc, gem);
    this.marker.visible = false;
    this.eng.scene.add(this.marker);
    // Flecha guía alrededor de los pies del jugador
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 3), new THREE.MeshBasicMaterial({ color: '#ffc94a', transparent: true, opacity: 0.9, depthWrite: false }));
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.set(0, 0.02, -0.62);
    this.guide.add(arrow);
    this.guide.visible = false;
    this.eng.scene.add(this.guide);
    this.eng.addUpdate((dt, time) => this.updateGuides(dt, time));
  }

  private updateGuides(_dt: number, time: number) {
    const p = this.player;
    const nt = this.running && !this.busy && !this.paused ? this.nextTask() : null;
    this.marker.visible = !!nt;
    this.guide.visible = false;
    if (!nt || !p) return;
    const sp = standPoint(STATIONS[nt.def.station]);
    this.marker.position.set(sp.x, 0, sp.z);
    const k = 1 + Math.sin(time * 4) * 0.06;
    this.marker.children[0].scale.setScalar(k);
    const gem = this.marker.children[2];
    gem.rotation.y = time * 1.6;
    gem.position.y = 2.1 + Math.sin(time * 2.4) * 0.08;
    const pp = p.position;
    const dx = sp.x - pp.x, dz = sp.z - pp.z;
    if (Math.hypot(dx, dz) > 1.6) {
      this.guide.visible = true;
      this.guide.position.set(pp.x, 0, pp.z);
      this.guide.rotation.y = Math.atan2(-dx, -dz);
    }
  }

  /** Ticket abierto cuyo punto de trabajo está al alcance del jugador. */
  private nearTask(): TaskInst | null {
    const p = this.player;
    if (!p) return null;
    let best: TaskInst | null = null, bd = 1.05;
    for (const t of this.tasks) {
      if (t.status !== 'open') continue;
      const sp = standPoint(STATIONS[t.def.station]);
      const d = Math.hypot(sp.x - p.position.x, sp.z - p.position.z);
      if (d < bd || (best && d === bd && t.urgent)) { bd = d; best = t; }
    }
    return best;
  }

  persist() {
    save(this.save);
  }

  view(id: StationId, wide = false): View {
    const s = STATIONS[id];
    const aspect = window.innerWidth / window.innerHeight;
    // en vertical alejamos la cámara para que el área de trabajo entre de lado a lado
    const k = aspect < 1 ? Math.min(1.75, 0.82 / aspect) : 1;
    if (wide) return { pos: new THREE.Vector3(0, 1.62, 1.35), look: new THREE.Vector3(0, 1.35, -1), fov: 64 };
    return { pos: s.work.clone().addScaledVector(s.eye, k), look: s.work.clone(), fov: s.fov };
  }

  startDay(day: number) {
    this.day = day;
    this.clock = hm(6, 40);
    this.approval = 70;
    this.injuries = 0;
    this.familyQ = [];
    this.familyPraised = false;
    this.log = [];
    this.tasks = [];
    this.ui.clearTasks();
    this.kitchen.resetCooks();
    this.where = null;
    // tareas del día: las fijas + una selección creciente del resto
    const eligible = TASKS.filter((t) => t.minDay <= day && (!t.onlyDay || t.onlyDay === day));
    const core = eligible.filter((t) => t.core || t.onlyDay);
    const extra = eligible.filter((t) => !core.includes(t)).sort(() => Math.random() - 0.5);
    const want = Math.min(eligible.length, 9 + day * 2);
    const chosen = new Set<TaskDef>(core);
    for (const t of extra) {
      if (chosen.size >= want) break;
      chosen.add(t);
      // incluimos la dependencia si hace falta
      if (t.after) {
        const dep = TASKS.find((x) => x.id === t.after);
        if (dep) chosen.add(dep);
      }
    }
    for (const def of TASKS) if (chosen.has(def)) this.addTask(def, def.at, def.window, false);
    // imprevistos
    this.events = [];
    const evs = EVENTS.filter((e) => e.minDay <= day).sort(() => Math.random() - 0.5).slice(0, Math.min(1 + Math.floor(day * 0.8), 4));
    for (const e of evs) this.events.push({ at: Math.floor(e.from + Math.random() * (e.to - e.from)), def: e, fired: false });
    this.ui.setDay(`DÍA ${day} · ${DAY_NAMES[day - 1].toUpperCase()}${day === LAST_DAY ? ' · ÚLTIMO DÍA' : ''}`);
    this.ui.setApproval(this.approval);
    this.ui.setClock(this.clock);
    this.ui.showHud(true);
    this.running = true;
    this.paused = false;
    this.busy = true;
    // Escena de llegada: el jugador entra por la puerta del vestidor y la cámara lo sigue
    if (this.player) {
      const sp = standPoint(STATIONS.entrada);
      this.player.teleport(sp.x, sp.z - 0.5, sp.ry);
      this.player.enabled = true;
      if (this.input) this.input.enabled = true;
      this.eng.setFollow(this.player.root);
      this.eng.releaseView(1.4);
    } else this.eng.setView(this.view('entrada'));
    this.ui.showCaption('6:40 am', day === LAST_DAY ? 'último día en un restaurante con estrella michelin' : 'llegando al restaurante · nueva york', 3);
    wait(1.2).then(() => (this.busy = false));
    this.renderList();
  }

  private addTask(def: TaskDef, at: number, window: number, urgent: boolean) {
    const w = urgent ? window : Math.max(35, window * (this.day === 1 ? 1.5 : 1 - (this.day - 1) * 0.04));
    const t: TaskInst = { uid: ++this.uid, def, status: 'locked', unlockAt: at, deadline: at + w, urgent };
    this.tasks.push(t);
    return t;
  }

  private depDone(t: TaskInst) {
    if (!t.def.after) return true;
    const dep = this.tasks.find((x) => x.def.id === t.def.after && !x.urgent);
    return !dep || dep.status === 'done' || dep.status === 'failed';
  }

  private renderList() {
    const views: TaskView[] = this.tasks.map((t) => ({
      uid: t.uid, title: t.def.title, icon: t.def.icon, stationName: STATIONS[t.def.station].name,
      deadline: t.deadline, unlockAt: t.unlockAt, urgent: t.urgent, family: !!t.def.family, status: t.status, quality: t.quality,
    }));
    this.ui.renderTasks(views, this.clock);
  }

  update(dt: number) {
    if (!this.running || this.paused) return;
    this.clock += dt * this.rate;
    this.ui.setClock(this.clock);
    let changed = false;
    for (const t of this.tasks) {
      if (t.status === 'locked' && this.clock >= t.unlockAt && this.depDone(t)) {
        t.status = 'open';
        // si la dependencia terminó tarde, el plazo corre desde ahora
        if (t.deadline - this.clock < 20) t.deadline = this.clock + Math.max(20, t.def.window * 0.6);
        changed = true;
        audio.play('ticket', 0.8);
        if (!t.urgent) this.ui.toast(`${t.def.icon} Nuevo ticket: ${t.def.title}`, 'info');
        // el primer ticket del día (fichar) arranca solo para que nadie se quede mirando la pared
        if (t.def.id === 'clockin' && !this.busy) queueMicrotask(() => this.select(t.uid));
      }
      if (t.status === 'open' && this.clock > t.deadline) {
        t.status = 'failed';
        changed = true;
        this.addApproval(t.urgent ? -14 : -10);
        this.ui.chefSay(pick(LATE), 'angry');
        this.ui.toast(`✕ Se pasó: ${t.def.title}`, 'bad');
        this.log.push({ at: this.clock, text: `✕ ${t.def.title}` });
      }
    }
    for (const e of this.events) {
      if (e.fired || this.clock < e.at || this.tooEarly()) continue;
      e.fired = true;
      this.ui.chefSay(e.def.chef, 'angry');
      audio.play('bell');
      if (e.def.task) {
        const def: TaskDef = { ...e.def.task, id: `ev-${e.def.id}`, at: this.clock, minDay: 1 } as TaskDef;
        const t = this.addTask(def, this.clock, def.window, true);
        t.status = 'open';
        t.deadline = this.clock + def.window;
        this.ui.toast(`🚨 ${def.title}`, 'urgent');
      }
      changed = true;
    }
    this.listT -= dt;
    if (changed || this.listT <= 0) {
      this.listT = 0.5;
      this.renderList();
    }
    // Indicación permanente de qué hacer cuando no hay minijuego en curso
    if (!this.busy && !this.current) {
      const nt = this.nextTask();
      this.near = this.nearTask();
      this.ui.setPrompt(this.near ? `${this.near.def.icon} ${this.near.def.title}` : null, () => this.near && this.select(this.near.uid));
      const touch = matchMedia('(pointer: coarse)').matches;
      const hint = this.walkingTo ? '' : this.near ? '' : nt ? `▶ Ve a ${STATIONS[nt.def.station].name} (${touch ? 'joystick o toca el ticket' : 'WASD / clic en el piso o en el ticket'}) · ${nt.def.title}` : '';
      if (hint !== this.hint) {
        this.hint = hint;
        this.ui.setInstruction(hint);
      }
    } else {
      this.hint = '';
      this.near = null;
      this.ui.setPrompt(null);
    }
    // Corte de edición: si no hay nada pendiente, saltamos al próximo ticket (como en el video)
    const open = this.tasks.some((t) => t.status === 'open' || t.status === 'active');
    if (!this.busy && !open) {
      this.idle += dt;
      if (this.idle > 0.9) this.jumpCut();
    } else this.idle = 0;
    // red de seguridad: el turno termina sí o sí
    if (this.clock > hm(20, 45) && !this.busy) this.endDay();
  }

  /** Tarea abierta más urgente; prioriza la estación donde ya estás. */
  private nextTask() {
    const open = this.tasks.filter((t) => t.status === 'open');
    if (!open.length) return null;
    open.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.deadline - b.deadline);
    return (!open[0].urgent && open.find((t) => t.def.station === this.where)) || open[0];
  }

  private tooEarly() {
    return this.clock < hm(7, 30);
  }

  private jumpCut() {
    this.idle = 0;
    const nextT = this.tasks.filter((t) => t.status === 'locked' && this.depDone(t)).map((t) => t.unlockAt);
    const nextE = this.events.filter((e) => !e.fired).map((e) => e.at);
    const next = Math.min(...nextT, ...nextE);
    if (!isFinite(next)) {
      this.endDay();
      return;
    }
    if (next - this.clock < 1.5) return;
    this.ui.flash();
    audio.play('whoosh', 0.6);
    this.clock = next;
    this.ui.setClock(this.clock);
  }

  private addApproval(d: number) {
    this.approval = clamp(this.approval + d, 0, 100);
    this.ui.setApproval(this.approval);
  }

  async select(uid: number) {
    if (this.busy || this.paused || !this.running) return;
    const t = this.tasks.find((x) => x.uid === uid);
    if (!t || t.status !== 'open') return;
    // En tercera persona primero caminamos hasta la estación (se cancela si el jugador se mueve)
    const p = this.player;
    if (p) {
      const sp = standPoint(STATIONS[t.def.station]);
      if (Math.hypot(sp.x - p.position.x, sp.z - p.position.z) > 0.35) {
        if (this.walkingTo === uid) return;
        this.walkingTo = uid;
        this.ui.setInstruction(`Caminando a ${STATIONS[t.def.station].name}…`);
        const ok = await p.walkTo(sp.x, sp.z, sp.ry);
        if (this.walkingTo === uid) this.walkingTo = 0;
        this.hint = '';
        if (!ok || this.busy || t.status !== 'open' || !this.running) return;
      }
      p.faceTo(STATIONS[t.def.station].work.x, STATIONS[t.def.station].work.z);
      p.enabled = false;
      if (this.input) this.input.enabled = false;
    }
    this.busy = true;
    this.hint = '';
    this.ui.setInstruction('');
    t.status = 'active';
    this.renderList();
    audio.play('click');
    const wide = t.def.params.kind === 'goodbye';
    if (p) await this.eng.lockView(this.view(t.def.station, wide), 0.85);
    else if (this.where !== t.def.station || wide) await this.eng.moveTo(this.view(t.def.station, wide), 0.9);
    this.where = wide ? null : t.def.station;
    this.ui.showCaption(fmtTime(this.clock), t.def.caption);
    this.ui.setInTask(true);
    const Game = GAMES[t.def.kind];
    const ctx: MGContext = { eng: this.eng, kitchen: this.kitchen, fx: this.fx, ui: this.ui, station: STATIONS[t.def.station], day: this.day, params: { ...t.def.params, now: this.clock } };
    const mg = new Game(ctx);
    this.current = mg;
    const res = await mg.run();
    this.current = null;
    this.ui.setInTask(false);
    let q = res.quality;
    const late = this.clock > t.deadline;
    if (late) q *= 0.75;
    t.quality = q;
    t.doneAt = this.clock;
    t.status = 'done';
    this.log.push({ at: this.clock, text: `${t.def.title}` });
    if (t.def.family) this.familyQ.push(q);
    // nota del chef
    this.addApproval((q - 0.62) * 22 + (t.urgent ? 3 : 0));
    if (res.injured) {
      this.injuries++;
      this.addApproval(-5);
      this.clock += 8;
    }
    audio.play(q >= 0.75 ? 'ding' : 'bad', 0.7);
    const pct = Math.round(q * 100);
    this.ui.toast(`${t.def.icon} ${t.def.title} · <b>${pct}%</b>${late ? ' (tarde)' : ''}`, q >= 0.75 ? 'good' : q >= 0.5 ? 'info' : 'bad');
    if (Math.random() < 0.55 || q < 0.5) this.ui.chefSay(pick(q >= 0.85 ? PRAISE : q >= 0.55 ? MEH : BAD), q >= 0.85 ? 'happy' : q >= 0.55 ? 'ok' : 'angry');
    // momento del video: "pastry team approved" por la comida del personal
    if (!this.familyPraised && t.def.id === 'fries') {
      this.familyPraised = true;
      const avg = this.familyQ.reduce((a, b) => a + b, 0) / this.familyQ.length;
      if (avg >= 0.7) {
        wait(1.6).then(() => {
          this.ui.chefSay('La comida del personal estuvo buenísima. 👍 Aprobada.', 'happy', 'Equipo de pastelería');
          this.addApproval(5);
        });
      }
    }
    await wait(0.4);
    mg.dispose();
    this.renderList();
    if (p && t.def.id !== 'clockout') {
      await this.eng.releaseView(0.8);
      p.enabled = true;
      if (this.input) this.input.enabled = true;
    }
    this.busy = false;
    if (t.def.id === 'clockout') this.endDay();
  }

  /** Depuración: abre cualquier tarea al instante (?debug en la URL). */
  debugTask(id: string) {
    const def = TASKS.find((t) => t.id === id) ?? EVENTS.find((e) => e.id === id)?.task as TaskDef | undefined;
    if (!def) return;
    const t = this.addTask({ ...def, id: def.id ?? id } as TaskDef, this.clock, 120, false);
    t.status = 'open';
    this.select(t.uid);
  }

  /** Minijuego en curso (útil para depurar y pruebas automáticas). */
  get game() {
    return this.current;
  }

  pause(v: boolean) {
    if (!this.running) return;
    this.paused = v;
  }

  private endDay() {
    if (!this.running) return;
    this.running = false;
    this.ui.showHud(false);
    this.ui.setPrompt(null);
    if (this.player) this.player.enabled = false;
    if (this.input) this.input.enabled = false;
    const done = this.tasks.filter((t) => t.status === 'done');
    const failed = this.tasks.filter((t) => t.status === 'failed' || t.status === 'open' || t.status === 'locked');
    const avg = done.length ? done.reduce((a, t) => a + (t.quality ?? 0), 0) / done.length : 0;
    const score = this.approval * 0.6 + avg * 40 - failed.length * 3;
    const stars = score >= 85 ? 3 : score >= 68 ? 2 : score >= 50 ? 1 : 0;
    this.save.stars[this.day] = Math.max(this.save.stars[this.day] ?? 0, stars);
    if (stars >= 1) this.save.unlocked = Math.max(this.save.unlocked, Math.min(LAST_DAY, this.day + 1));
    this.persist();
    const rows = this.tasks
      .filter((t) => t.status !== 'locked')
      .sort((a, b) => (a.doneAt ?? a.deadline) - (b.doneAt ?? b.deadline))
      .map((t) => `<tr class="${t.status}"><td>${t.doneAt ? fmtTime(t.doneAt) : '—'}</td><td>${t.def.icon} ${t.def.title}</td><td>${t.status === 'done' ? Math.round((t.quality ?? 0) * 100) + '%' : '✕'}</td></tr>`)
      .join('');
    const html = `
      <div class="sheet">
        <div class="sheet-head"><span>RESUMEN DEL TURNO</span><b>DÍA ${this.day} · ${DAY_NAMES[this.day - 1]}</b></div>
        <div class="stars">${'★'.repeat(stars)}<i>${'★'.repeat(3 - stars)}</i></div>
        <div class="kpis">
          <div><b>${Math.round(this.approval)}</b><span>nota del chef</span></div>
          <div><b>${Math.round(avg * 100)}%</b><span>calidad media</span></div>
          <div><b>${done.length}/${done.length + failed.length}</b><span>tareas</span></div>
          <div><b>${this.injuries}</b><span>cortes</span></div>
        </div>
        <table class="timesheet"><tbody>${rows}</tbody></table>
        <p class="verdict">${this.verdict(stars)}</p>
      </div>`;
    this.onEnd(html, stars);
  }

  private verdict(stars: number) {
    if (this.day === LAST_DAY) return stars >= 2 ? '“Fue un honor tenerte en mi cocina. Las puertas siempre están abiertas.” — Chef' : '“Gracias por todo. Sigue aprendiendo.” — Chef';
    return ['“Mañana a las 6:50. Y más vale que cambie la actitud.”', '“Pasable. Mañana quiero más.”', '“Buen turno. Así se trabaja aquí.”', '“Impecable. Esto es una cocina de tres estrellas.”'][stars];
  }

  /** Foto grupal del último día (como el inicio del video). */
  async teamPhoto() {
    const crew = this.kitchen.cooks;
    const spots = [-1.0, -0.5, 0, 0.5, 1.0];
    await Promise.all(crew.map((c, i) => c.walkTo(spots[i] ?? 0, -1.2, 0, 2.2)));
    crew.forEach((c) => (c.work = 'idle'));
    await this.eng.lockView({ pos: new THREE.Vector3(0, 1.5, 1.6), look: new THREE.Vector3(0, 1.2, -1.2), fov: 60 }, 1.2);
    await wait(0.6);
    audio.play('click', 2);
    this.ui.flash();
  }

  toOverview() {
    return this.eng.lockView(OVERVIEW, 1.2);
  }
}
