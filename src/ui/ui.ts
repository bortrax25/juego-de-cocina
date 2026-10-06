import { fmtTime } from '../game/clock';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
};

export interface TaskView {
  uid: number;
  title: string;
  icon: string;
  stationName: string;
  deadline: number;
  unlockAt: number;
  urgent: boolean;
  family: boolean;
  status: 'open' | 'active' | 'done' | 'failed' | 'locked';
  quality?: number;
}

export interface Gauge {
  el: HTMLElement;
  set(value: number, zoneA?: number, zoneB?: number): void;
  setLabel(t: string): void;
  remove(): void;
}

export interface Ring {
  el: HTMLElement;
  set(p: number, state: 'idle' | 'cook' | 'ready' | 'burn' | 'done'): void;
  move(x: number, y: number): void;
  remove(): void;
}

/** Capa HTML sobre el canvas. Se actualiza sólo cuando cambia algo (sin reflow por frame). */
export class UI {
  root: HTMLElement;
  private clockEl: HTMLElement;
  private dayEl: HTMLElement;
  private apprFill: HTMLElement;
  private apprVal: HTMLElement;
  private caption: HTMLElement;
  private instr: HTMLElement;
  private progress: HTMLElement;
  private list: HTMLElement;
  private listWrap: HTMLElement;
  private toasts: HTMLElement;
  private chef: HTMLElement;
  private flashEl: HTMLElement;
  private screen: HTMLElement;
  private lastMinute = -1;
  private cards = new Map<number, HTMLElement>();
  onSelectTask: (uid: number) => void = () => {};
  onPause: () => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
    const hud = h('div', 'hud');
    this.dayEl = h('div', 'hud-day');
    this.clockEl = h('div', 'hud-clock', '6:40 am');
    const appr = h('div', 'hud-appr', '<span class="lbl">CHEF</span><div class="bar"><i></i></div><b>70</b>');
    this.apprFill = appr.querySelector('i')!;
    this.apprVal = appr.querySelector('b')!;
    const pause = h('button', 'hud-btn', '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/></svg>');
    pause.setAttribute('aria-label', 'Pausa');
    pause.type = 'button';
    pause.onclick = () => this.onPause();
    const left = h('div', 'hud-left');
    left.append(this.dayEl, appr);
    hud.append(left, this.clockEl, pause);
    this.caption = h('div', 'caption');
    this.instr = h('div', 'instr');
    this.progress = h('div', 'progress');
    this.listWrap = h('aside', 'prep');
    this.listWrap.innerHTML = '<header><span>LISTA DE PREP</span><small></small></header>';
    this.list = h('div', 'prep-list');
    this.listWrap.append(this.list);
    this.listWrap.querySelector('header')!.onclick = () => this.listWrap.classList.toggle('collapsed');
    this.toasts = h('div', 'toasts');
    this.chef = h('div', 'chef-say');
    this.flashEl = h('div', 'flash');
    this.screen = h('div', 'screen hidden');
    root.append(hud, this.caption, this.instr, this.progress, this.listWrap, this.toasts, this.chef, this.flashEl, this.screen);
  }

  private promptEl: HTMLButtonElement | null = null;
  private promptCb: (() => void) | null = null;
  private promptText = '';
  /** Botón de interacción contextual (cerca de una estación con ticket). */
  setPrompt(text: string | null, cb?: () => void) {
    if (!this.promptEl) {
      const b = h('button', 'prompt');
      b.onclick = () => this.promptCb?.();
      this.root.append(b);
      this.promptEl = b;
    }
    this.promptCb = cb ?? null;
    const t = text ?? '';
    if (t === this.promptText) return;
    this.promptText = t;
    const touch = matchMedia('(pointer: coarse)').matches;
    this.promptEl.innerHTML = t ? `<kbd>${touch ? 'TOCA' : 'E'}</kbd><span>${t}</span>` : '';
    this.promptEl.classList.toggle('show', !!t);
  }

  /** Durante un minijuego la lista se repliega para dejar ver la estación. */
  setInTask(v: boolean) {
    this.root.classList.toggle('in-task', v);
  }

  showHud(v: boolean) {
    this.root.classList.toggle('playing', v);
  }

  setDay(label: string) {
    this.dayEl.textContent = label;
  }

  setClock(min: number) {
    const m = Math.floor(min);
    if (m === this.lastMinute) return;
    this.lastMinute = m;
    this.clockEl.textContent = fmtTime(m);
  }

  setApproval(v: number) {
    const r = Math.round(v);
    this.apprFill.style.transform = `scaleX(${Math.max(0, Math.min(1, v / 100))})`;
    this.apprFill.style.background = v >= 80 ? '#7fd36e' : v >= 55 ? '#f2c94c' : '#ef5a4c';
    this.apprVal.textContent = String(r);
  }

  /** Subtítulo al estilo del video: hora + acción en minúsculas. */
  showCaption(time: string, text: string, hold = 2.6) {
    this.caption.innerHTML = `<span>${time}</span><span>${text}</span>`;
    this.caption.classList.remove('show');
    void this.caption.offsetWidth;
    this.caption.classList.add('show');
    this.caption.style.animationDuration = `${hold}s`;
  }

  setInstruction(t: string) {
    this.instr.textContent = t;
    this.instr.classList.toggle('show', !!t);
  }

  setProgress(done: number, total: number) {
    if (total <= 0) {
      this.progress.innerHTML = '';
      return;
    }
    let s = '';
    for (let i = 0; i < total; i++) s += `<i class="${i < done ? 'on' : ''}"></i>`;
    this.progress.innerHTML = s;
  }

  renderTasks(tasks: TaskView[], now: number) {
    const visible = tasks.filter((t) => t.status !== 'locked');
    const seen = new Set<number>();
    for (const t of visible) {
      seen.add(t.uid);
      let c = this.cards.get(t.uid);
      if (!c) {
        c = h('button', 'card');
        c.onclick = () => this.onSelectTask(t.uid);
        this.cards.set(t.uid, c);
        this.list.prepend(c);
        c.classList.add('enter');
      }
      const st = t.status;
      c.className = `card ${st}${t.urgent ? ' urgent' : ''}${t.family ? ' family' : ''}`;
      const q = t.quality !== undefined ? Math.round(t.quality * 100) : 0;
      const right = st === 'done' ? `<b class="q">${q}%</b>` : st === 'failed' ? '<b class="q x">✕</b>' : `<b class="dl">${fmtTime(t.deadline)}</b>`;
      const key = `${st}|${right}`;
      if (c.dataset.k !== key) {
        c.dataset.k = key;
        c.innerHTML = `<span class="ic">${t.icon}</span><span class="tx"><span class="t">${t.title}</span><span class="s">${t.family ? 'comida de personal · ' : ''}${t.stationName}</span></span>${right}<span class="tl"><i></i></span>`;
      }
      const bar = c.querySelector('.tl i') as HTMLElement | null;
      if (bar && (st === 'open' || st === 'active')) {
        const k = Math.max(0, Math.min(1, (t.deadline - now) / Math.max(1, t.deadline - t.unlockAt)));
        bar.style.transform = `scaleX(${k})`;
        c.classList.toggle('late', k < 0.25);
      }
    }
    for (const [uid, el] of this.cards) if (!seen.has(uid)) { el.remove(); this.cards.delete(uid); }
    // orden: abiertas/activas primero por deadline, luego terminadas
    const order = [...visible].sort((a, b) => {
      const rank = (s: string) => (s === 'active' ? 0 : s === 'open' ? 1 : 2);
      return rank(a.status) - rank(b.status) || (rank(a.status) < 2 ? a.deadline - b.deadline : b.uid - a.uid);
    });
    order.forEach((t, i) => {
      const el = this.cards.get(t.uid)!;
      if (this.list.children[i] !== el) this.list.insertBefore(el, this.list.children[i] ?? null);
    });
    const open = visible.filter((t) => t.status === 'open').length;
    this.listWrap.querySelector('small')!.textContent = open ? `${open} pendiente${open > 1 ? 's' : ''}` : 'al día';
  }

  clearTasks() {
    this.cards.forEach((c) => c.remove());
    this.cards.clear();
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' | 'urgent' = 'info') {
    const t = h('div', `toast ${kind}`, text);
    this.toasts.append(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3100);
  }

  chefSay(text: string, mood: 'ok' | 'happy' | 'angry' = 'ok', who = 'Chef') {
    const face = mood === 'happy' ? '😄' : mood === 'angry' ? '😠' : '🧑‍🍳';
    this.chef.innerHTML = `<span class="face">${face}</span><span class="txt"><b>${who}</b>${text}</span>`;
    this.chef.className = `chef-say show ${mood}`;
    clearTimeout((this.chef as unknown as { _t: number })._t);
    (this.chef as unknown as { _t: number })._t = window.setTimeout(() => this.chef.classList.remove('show'), 3800);
  }

  popup(x: number, y: number, text: string, cls: string) {
    const p = h('div', `pop ${cls}`, text);
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    this.root.append(p);
    setTimeout(() => p.remove(), 900);
  }

  flash() {
    this.flashEl.classList.remove('on');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('on');
  }

  gauge(vertical = false): Gauge {
    const el = h('div', `gauge${vertical ? ' v' : ''}`, '<div class="zone"></div><div class="fill"></div><div class="mark"></div><span class="lbl"></span>');
    this.root.append(el);
    const zone = el.querySelector('.zone') as HTMLElement, fill = el.querySelector('.fill') as HTMLElement, mark = el.querySelector('.mark') as HTMLElement;
    const lbl = el.querySelector('.lbl') as HTMLElement;
    const prop = vertical ? 'bottom' : 'left', size = vertical ? 'height' : 'width';
    return {
      el,
      set(v, a, b) {
        fill.style.transform = vertical ? `scaleY(${v})` : `scaleX(${v})`;
        mark.style[prop] = `${v * 100}%`;
        if (a !== undefined && b !== undefined) {
          zone.style[prop] = `${a * 100}%`;
          zone.style[size] = `${(b - a) * 100}%`;
        }
      },
      setLabel(t) { lbl.textContent = t; },
      remove() { el.remove(); },
    };
  }

  ring(): Ring {
    const el = h('div', 'ring', '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" class="bg"/><circle cx="20" cy="20" r="16" class="fg"/><circle cx="20" cy="20" r="16" class="zone"/></svg><span></span>');
    this.root.append(el);
    const fg = el.querySelector('.fg') as SVGCircleElement;
    const txt = el.querySelector('span')!;
    const C = 2 * Math.PI * 16;
    fg.style.strokeDasharray = `${C}`;
    return {
      el,
      set(p, state) {
        fg.style.strokeDashoffset = `${C * (1 - Math.min(1, p))}`;
        el.dataset.s = state;
        txt.textContent = state === 'ready' ? '¡YA!' : state === 'burn' ? '🔥' : state === 'done' ? '✓' : state === 'idle' ? '+' : '';
      },
      move(x, y) { el.style.transform = `translate(${x}px, ${y}px)`; },
      remove() { el.remove(); },
    };
  }

  /** Etiqueta anclada a un objeto 3D (se posiciona desde el bucle). */
  tag(text: string, cls = '') {
    const el = h('div', `tag ${cls}`, text);
    this.root.append(el);
    return {
      el,
      move(x: number, y: number) { el.style.transform = `translate(${x}px, ${y}px)`; },
      set(t: string) { el.innerHTML = t; },
      remove() { el.remove(); },
    };
  }

  /** Pantallas completas (título, pausa, resumen). */
  showScreen(html: string, cls = '') {
    this.screen.className = `screen ${cls}`;
    this.screen.innerHTML = html;
    return this.screen;
  }

  hideScreen() {
    this.screen.className = 'screen hidden';
    this.screen.innerHTML = '';
  }
}
