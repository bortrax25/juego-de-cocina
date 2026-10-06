// Progreso local (sólo comodidad por jugador; el juego funciona igual sin almacenamiento).

export interface SaveData {
  unlocked: number;
  stars: Record<number, number>;
  muted: boolean;
  reduceMotion: boolean;
}

const KEY = 'mise-en-place-nyc/v1';
const DEF: SaveData = { unlocked: 1, stars: {}, muted: false, reduceMotion: false };

export function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEF, stars: {} };
    return { ...DEF, ...JSON.parse(raw) };
  } catch {
    return { ...DEF, stars: {} };
  }
}

export function save(d: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* almacenamiento no disponible: seguimos sin guardar */
  }
}
