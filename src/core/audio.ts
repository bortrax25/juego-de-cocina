// Audio 100% procedural con Web Audio API: cero archivos, cero latencia de carga.

type SfxName =
  | 'chop' | 'board' | 'sizzle' | 'pour' | 'ding' | 'good' | 'bad' | 'whoosh' | 'ticket'
  | 'pop' | 'flame' | 'click' | 'pluck' | 'scrape' | 'thud' | 'seal' | 'bell' | 'beep';

class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfxBus!: GainNode;
  ambBus!: GainNode;
  private noise!: AudioBuffer;
  private loops = new Map<string, { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode }>();
  muted = false;

  unlock() {
    if (this.ctx) {
      // iOS Safari también deja el contexto en 'interrupted' (llamadas, bloqueo de pantalla)
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0.5;
    this.ambBus.connect(this.master);

    // 2 s de ruido blanco reutilizable
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // iOS: un buffer silencioso dentro del gesto del usuario termina de desbloquear el audio
    try {
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination);
      s.start(0);
    } catch { /* sin audio */ }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    // Al volver a la pestaña (o tras una interrupción) reanudamos el contexto en el siguiente toque
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    });
    this.startAmbience();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  private startAmbience() {
    const ctx = this.ctx!;
    // Campana extractora: ruido marrón filtrado + zumbido grave
    const hood = this.loop('hood', 'lowpass', 380, 0.16, this.ambBus);
    hood.filter.Q.value = 0.4;
    const hum = ctx.createOscillator();
    hum.frequency.value = 60;
    const hg = ctx.createGain();
    hg.gain.value = 0.025;
    hum.connect(hg).connect(this.ambBus);
    hum.start();
    // Ruido de cocina lejano (platos, utensilios) cada cierto tiempo
    const clatter = () => {
      if (!this.ctx) return;
      if (Math.random() < 0.6) this.metal(0.03 + Math.random() * 0.04, 2400 + Math.random() * 3000);
      setTimeout(clatter, 1800 + Math.random() * 4500);
    };
    setTimeout(clatter, 2500);
  }

  private loop(name: string, type: BiquadFilterType, freq: number, vol: number, bus: GainNode) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter).connect(gain).connect(bus);
    src.start();
    const l = { src, gain, filter };
    this.loops.set(name, l);
    return l;
  }

  /** Bucle continuo (fritura, hervor, chorro). vol=0 lo silencia suavemente. */
  setLoop(name: 'fry' | 'boil' | 'stream' | 'torch' | 'water', vol: number) {
    if (!this.ctx) return;
    let l = this.loops.get(name);
    if (!l) {
      if (vol <= 0) return;
      const cfg = {
        fry: ['highpass', 2500, 0],
        boil: ['lowpass', 500, 0],
        stream: ['bandpass', 1200, 0],
        torch: ['lowpass', 900, 0],
        water: ['bandpass', 2000, 0],
      } as const;
      const [t, f] = cfg[name];
      l = this.loop(name, t, f, 0, this.sfxBus);
      if (name === 'fry') this.crackle(l.gain);
    }
    l.gain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.08);
  }

  private crackle(_g: GainNode) {
    const tick = () => {
      const l = this.loops.get('fry');
      if (!this.ctx || !l) return;
      const v = l.gain.gain.value;
      if (v > 0.01) for (let i = 0; i < 3; i++) if (Math.random() < 0.7) this.burst(0.006, 4000 + Math.random() * 4000, v * 1.6, 'highpass', Math.random() * 0.05);
      setTimeout(tick, 60);
    };
    tick();
  }

  private burst(dur: number, freq: number, vol: number, type: BiquadFilterType = 'bandpass', delay = 0, q = 1) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random() * Math.max(0, 1.9 - dur), dur + 0.05);
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', delay = 0, slideTo?: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private metal(vol: number, freq: number) {
    this.tone(freq, 0.25, vol, 'triangle');
    this.tone(freq * 1.47, 0.18, vol * 0.6, 'sine');
    this.burst(0.03, freq, vol * 2);
  }

  play(name: SfxName, intensity = 1) {
    if (!this.ctx || this.muted) return;
    const v = intensity;
    switch (name) {
      case 'chop':
        this.burst(0.05, 1800, 0.5 * v, 'bandpass', 0, 0.8);
        this.tone(180, 0.06, 0.35 * v, 'sine', 0, 90);
        break;
      case 'board':
        this.tone(140, 0.08, 0.4 * v, 'sine', 0, 70);
        this.burst(0.04, 600, 0.3 * v, 'lowpass');
        break;
      case 'sizzle':
        this.burst(0.6, 5000, 0.25 * v, 'highpass');
        break;
      case 'pour':
        this.burst(0.25, 900, 0.2 * v, 'bandpass', 0, 3);
        break;
      case 'ding':
        this.tone(1320, 0.5, 0.18 * v, 'sine');
        this.tone(1980, 0.35, 0.08 * v, 'sine');
        break;
      case 'good':
        this.tone(660, 0.14, 0.16 * v, 'triangle');
        this.tone(990, 0.22, 0.14 * v, 'triangle', 0.08);
        break;
      case 'bad':
        this.tone(180, 0.28, 0.2 * v, 'sawtooth', 0, 120);
        break;
      case 'whoosh':
        this.burst(0.4, 700, 0.35 * v, 'bandpass', 0, 0.6);
        break;
      case 'ticket':
        for (let i = 0; i < 7; i++) this.burst(0.02, 3000, 0.15 * v, 'bandpass', i * 0.035, 2);
        this.tone(1760, 0.12, 0.06 * v, 'square', 0.28);
        break;
      case 'pop':
        this.tone(420, 0.09, 0.3 * v, 'sine', 0, 900);
        this.burst(0.03, 2500, 0.25 * v);
        break;
      case 'flame':
        this.burst(0.9, 300, 0.6 * v, 'lowpass');
        this.burst(0.5, 1200, 0.2 * v, 'bandpass', 0.05);
        break;
      case 'click':
        this.tone(2400, 0.03, 0.1 * v, 'square');
        break;
      case 'pluck':
        this.tone(900, 0.05, 0.18 * v, 'triangle', 0, 1800);
        break;
      case 'scrape':
        this.burst(0.12, 3200, 0.12 * v, 'bandpass', 0, 2);
        break;
      case 'thud':
        this.tone(90, 0.15, 0.45 * v, 'sine', 0, 50);
        this.burst(0.06, 400, 0.3 * v, 'lowpass');
        break;
      case 'seal':
        this.burst(0.5, 400, 0.15 * v, 'bandpass', 0, 4);
        this.tone(220, 0.4, 0.06 * v, 'sawtooth', 0, 110);
        break;
      case 'bell':
        this.metal(0.18 * v, 1800);
        break;
      case 'beep':
        this.tone(1046, 0.09, 0.12 * v, 'square');
        this.tone(1568, 0.12, 0.1 * v, 'square', 0.1);
        break;
    }
  }
}

export const audio = new AudioEngine();
