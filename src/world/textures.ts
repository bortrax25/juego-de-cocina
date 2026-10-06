import * as THREE from 'three/webgpu';

// Texturas procedurales en canvas: nada que descargar y todo en memoria de GPU al instante.

function canvas(w: number, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function tex(c: HTMLCanvasElement, repeat = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Memoiza texturas pedidas muchas veces (evita un CanvasTexture nuevo por llamada). */
const memo = new Map<string, THREE.Texture>();
function memoized<T extends THREE.Texture>(key: string, make: () => T): T {
  let t = memo.get(key) as T | undefined;
  if (!t) {
    t = make();
    memo.set(key, t);
  }
  return t;
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, alpha: number, light = false) {
  for (let i = 0; i < n; i++) {
    const v = light ? 255 : Math.floor(Math.random() * 60);
    g.fillStyle = `rgba(${v},${v},${v},${Math.random() * alpha})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

/** Azulejo blanco tipo metro (subway) con boquilla gris, como las paredes del video. */
export function subwayTile() {
  const [c, g] = canvas(512);
  g.fillStyle = '#c9ccce';
  g.fillRect(0, 0, 512, 512);
  const tw = 128, th = 64, gap = 4;
  for (let row = 0; row < 8; row++) {
    const off = row % 2 ? tw / 2 : 0;
    for (let col = -1; col < 5; col++) {
      const x = col * tw + off, y = row * th;
      const grd = g.createLinearGradient(x, y, x, y + th);
      grd.addColorStop(0, '#fbfbfa');
      grd.addColorStop(1, '#eceeed');
      g.fillStyle = grd;
      g.fillRect(x + gap / 2, y + gap / 2, tw - gap, th - gap);
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.fillRect(x + gap, y + gap, tw - gap * 2, 3);
    }
  }
  speckle(g, 512, 512, 300, 0.05);
  return tex(c);
}

/** Piso de baldosa de gres (quarry tile) gris cálido con boquilla, 4×4 piezas de 25 cm por repetición. */
export function floorTile() {
  const [c, g] = canvas(512);
  g.fillStyle = '#6f6760';
  g.fillRect(0, 0, 512, 512);
  const n = 4, s = 512 / n, gap = 5;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = Math.random() * 16 - 8;
      const r = 158 + v, gg = 149 + v, b = 139 + v;
      const x0 = x * s + gap / 2, y0 = y * s + gap / 2, w = s - gap;
      const grd = g.createLinearGradient(x0, y0, x0 + w, y0 + w);
      grd.addColorStop(0, `rgb(${r + 6},${gg + 6},${b + 6})`);
      grd.addColorStop(1, `rgb(${r - 6},${gg - 6},${b - 5})`);
      g.fillStyle = grd;
      g.fillRect(x0, y0, w, w);
      // bisel: borde levemente más oscuro
      g.strokeStyle = 'rgba(70,60,52,0.25)';
      g.lineWidth = 2;
      g.strokeRect(x0 + 1, y0 + 1, w - 2, w - 2);
    }
  speckle(g, 512, 512, 5000, 0.12);
  speckle(g, 512, 512, 1200, 0.06, true);
  // manchas de uso muy suaves
  for (let i = 0; i < 18; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = 20 + Math.random() * 60;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(60,50,40,0.06)');
    grd.addColorStop(1, 'rgba(60,50,40,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return tex(c);
}

/** Alfombra antifatiga de goma negra con agujeros hexagonales. */
export function rubberMat() {
  return memoized('rubberMat', () => {
    const [c, g] = canvas(128);
    g.fillStyle = '#34373a';
    g.fillRect(0, 0, 128, 128);
    for (let row = 0; row < 8; row++)
      for (let col = 0; col < 9; col++) {
        const x = col * 16 + (row % 2 ? 8 : 0), y = row * 16 + 8;
        g.fillStyle = '#141517';
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
          g.lineTo(x + Math.cos(a) * 5, y + Math.sin(a) * 5);
        }
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.08)';
        g.fillRect(x - 4, y - 7, 8, 1);
      }
    return tex(c);
  });
}

/** Rejilla de desagüe de piso. */
export function drainTex() {
  return memoized('drain', () => {
    const [c, g] = canvas(128);
    g.fillStyle = '#9ea3a7';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#2a2c2e';
    for (let i = 0; i < 9; i++) g.fillRect(14, 12 + i * 12, 100, 6);
    g.strokeStyle = '#6f7478';
    g.lineWidth = 4;
    g.strokeRect(2, 2, 124, 124);
    const t = tex(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** Comanda de papel térmico: encabezado, líneas de texto y una marca roja. */
export function ticketTex() {
  return memoized('ticket', () => {
    const [c, g] = canvas(256);
    // Atlas de 2 comandas lado a lado (u 0–0.5, 0.5–1)
    g.fillStyle = '#fbfaf5';
    g.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 2; k++) {
      const ox = k * 128;
      g.fillStyle = '#26262a';
      g.fillRect(ox + 14, 14, 100, 14);
      for (let i = 0; i < 11; i++) {
        const w = 30 + Math.random() * 70;
        g.fillStyle = i % 4 === 0 ? '#c3302a' : '#4a4a50';
        g.fillRect(ox + 14, 42 + i * 17, w, 6);
        if (Math.random() < 0.5) g.fillRect(ox + 98, 42 + i * 17, 14, 6);
      }
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(ox + 126, 0, 2, 256);
    }
    const t = tex(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** Cubitos (brunoise) en escala de grises: se tiñe con el color del material. */
export function dicedTex() {
  return memoized('diced', () => {
    const [c, g] = canvas(128);
    g.fillStyle = '#b8b8b8';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 420; i++) {
      const x = Math.random() * 128, y = Math.random() * 128, s = 4 + Math.random() * 4;
      const v = 200 + Math.floor(Math.random() * 55);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, y, s, s);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x, y + s - 1.5, s, 1.5);
      g.fillRect(x + s - 1.5, y, 1.5, s);
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillRect(x, y, s, 1);
    }
    return tex(c);
  });
}

/** Hierbas picadas (ciboulette, perejil): trazos finos. */
export function herbTex() {
  return memoized('herb', () => {
    const [c, g] = canvas(128);
    g.fillStyle = '#7a7a7a';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 700; i++) {
      const v = 140 + Math.floor(Math.random() * 115);
      g.strokeStyle = `rgb(${v},${v},${v})`;
      g.lineWidth = 1 + Math.random() * 1.5;
      const x = Math.random() * 128, y = Math.random() * 128, a = Math.random() * Math.PI, l = 2 + Math.random() * 6;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    return tex(c);
  });
}

/** Resplandor radial cálido (luz falsa de las lámparas del pase). */
export function glowTex() {
  return memoized('glow', () => {
    const [c, g] = canvas(128);
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,170,90,0.55)');
    grd.addColorStop(0.5, 'rgba(255,120,50,0.18)');
    grd.addColorStop(1, 'rgba(255,100,40,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Cielo raso: placas blancas con perfilería. */
export function ceilingTile() {
  const [c, g] = canvas(256);
  g.fillStyle = '#e9eaea';
  g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, 2500, 0.06);
  g.fillStyle = '#b9bcbe';
  g.fillRect(0, 0, 256, 5);
  g.fillRect(0, 0, 5, 256);
  return tex(c);
}

/** Acero inoxidable cepillado: mapa de rugosidad con vetas horizontales. */
export function brushedRoughness() {
  const [c, g] = canvas(256);
  g.fillStyle = '#6a6a6a';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const v = 80 + Math.floor(Math.random() * 90);
    g.strokeStyle = `rgba(${v},${v},${v},0.35)`;
    g.lineWidth = Math.random() * 1.2;
    const y = Math.random() * 256;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y + (Math.random() - 0.5) * 2);
    g.stroke();
  }
  // manchas de uso
  for (let i = 0; i < 25; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 10 + Math.random() * 40;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(150,150,150,0.25)');
    grd.addColorStop(1, 'rgba(150,150,150,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return tex(c, 1, false);
}

/** Calor en el centro de la plancha francesa (mapa emisivo opaco, elíptico para una tapa de 0.9×1.7 m). */
export function hotPlateTex() {
  return memoized('hotPlate', () => {
    const [c, g] = canvas(256);
    g.fillStyle = '#000000';
    g.fillRect(0, 0, 256, 256);
    g.save();
    g.translate(128, 128);
    g.scale(1, 0.9 / 1.7);
    const r = (0.34 / 0.9) * 256;
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, r);
    grd.addColorStop(0, 'rgb(255,255,255)');
    grd.addColorStop(0.45, 'rgb(120,120,120)');
    grd.addColorStop(1, 'rgb(0,0,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.restore();
    const t = tex(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** Acero cepillado (color): vetas horizontales muy suaves para que el inox "lea" de cerca. */
export function brushedColor() {
  return memoized('brushedColor', () => {
    const [c, g] = canvas(256);
    g.fillStyle = '#ececec';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1400; i++) {
      const v = 205 + Math.floor(Math.random() * 50);
      g.strokeStyle = `rgba(${v},${v},${v},0.5)`;
      g.lineWidth = 0.5 + Math.random();
      const y = Math.random() * 256, x = Math.random() * 256, l = 40 + Math.random() * 200;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + l, y + (Math.random() - 0.5));
      g.stroke();
    }
    return tex(c);
  });
}

/** Tabla de picar beige/amarillenta con marcas de cuchillo (como la del video). */
export function cuttingBoard() {
  const [c, g] = canvas(512);
  g.fillStyle = '#dccfa6';
  g.fillRect(0, 0, 512, 512);
  speckle(g, 512, 512, 3000, 0.07);
  for (let i = 0; i < 260; i++) {
    g.strokeStyle = `rgba(120,100,60,${Math.random() * 0.18})`;
    g.lineWidth = 0.6;
    const x = Math.random() * 512, y = Math.random() * 512, a = Math.random() * Math.PI, l = 10 + Math.random() * 60;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  return tex(c);
}

/** Carne de salmón/trucha: naranja con vetas de grasa blanca. */
export function salmonFlesh(base = '#f07a4a', fat = 'rgba(255,230,210,0.75)') {
  const [c, g] = canvas(256);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = fat;
  for (let i = 0; i < 18; i++) {
    g.lineWidth = 2 + Math.random() * 3;
    const x = i * 15 + Math.random() * 6;
    g.beginPath();
    g.moveTo(x, 0);
    g.bezierCurveTo(x + 30, 80, x - 20, 170, x + 15, 256);
    g.stroke();
  }
  speckle(g, 256, 256, 400, 0.05);
  return tex(c);
}

/** Pescado blanco (lenguado/merluza). */
export function whiteFish() {
  return memoized('whiteFish', buildWhiteFish);
}
function buildWhiteFish() {
  const [c, g] = canvas(256);
  g.fillStyle = '#efe6dc';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(220,180,170,0.4)';
  for (let i = 0; i < 12; i++) {
    g.lineWidth = 1 + Math.random() * 2;
    g.beginPath();
    g.arc(-40, 128, 40 + i * 22, -0.8, 0.8);
    g.stroke();
  }
  return tex(c);
}

/** Pez espada: carne rosada pálida con anillos. */
export function swordfish() {
  return memoized('swordfish', buildSwordfish);
}
function buildSwordfish() {
  const [c, g] = canvas(256);
  g.fillStyle = '#f2c2b8';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(200,120,110,0.35)';
  for (let i = 0; i < 9; i++) {
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(128, 128, 20 + i * 15, 14 + i * 11, 0, 0, Math.PI * 2);
    g.stroke();
  }
  return tex(c);
}

/** Etiqueta con texto (cinta de pintor verde/azul, como la del video). */
export function labelTex(text: string, bg = '#bfe66a', fg = '#1d2a12', w = 256, h = 64) {
  return memoized(`label|${text}|${bg}|${fg}|${w}|${h}`, () => buildLabel(text, bg, fg, w, h));
}
function buildLabel(text: string, bg: string, fg: string, w: number, h: number) {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.font = `600 ${Math.floor(h * 0.5)}px Oswald, Arial Narrow, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  return tex(c, 1);
}

/** Pantalla del reloj checador. */
export function terminalScreen(lines: string[]) {
  return memoized(`term|${lines.join('|')}`, () => buildTerminal(lines));
}
function buildTerminal(lines: string[]) {
  const [c, g] = canvas(256, 192);
  const grd = g.createLinearGradient(0, 0, 0, 192);
  grd.addColorStop(0, '#2b4a6d');
  grd.addColorStop(1, '#1a2c44');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 192);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.font = '600 30px Oswald, sans-serif';
  g.fillText(lines[0] ?? '', 128, 60);
  g.font = '400 18px Oswald, sans-serif';
  lines.slice(1).forEach((l, i) => g.fillText(l, 128, 100 + i * 26));
  g.fillStyle = '#7fb8ff';
  g.fillRect(48, 150, 160, 28);
  g.fillStyle = '#0d1a2b';
  g.font = '600 16px Oswald, sans-serif';
  g.fillText('TOCAR PARA FICHAR', 128, 170);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Textura editable para mecánicas de "pintar" (empanizar, curar, limpiar). */
export function paintCanvas(size = 256) {
  const [c, g] = canvas(size);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return { canvas: c, g, texture: t };
}

/** Sprite radial suave para partículas (vapor, harina, fuego). */
export function softDot() {
  return memoized('softDot', buildSoftDot);
}
function buildSoftDot() {
  const [c, g] = canvas(64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Perlas de caviar (verde oscuro/negro) para la superficie del relleno. */
export function caviarTex() {
  const [c, g] = canvas(256);
  g.fillStyle = '#1d2216';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 3 + Math.random() * 2;
    const grd = g.createRadialGradient(x - 1, y - 1, 0, x, y, r);
    grd.addColorStop(0, '#8a9468');
    grd.addColorStop(0.5, '#3a422a');
    grd.addColorStop(1, '#151a10');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c);
}
