// Tweens mínimos basados en el bucle del juego (sin dependencias, sin asignaciones por frame).

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  inCubic: (t: number) => t * t * t,
};

interface Tween {
  t: number;
  dur: number;
  fn: (k: number) => void;
  ease: Ease;
  resolve: () => void;
}

const active: Tween[] = [];

export function tween(dur: number, fn: (k: number) => void, e: Ease = ease.outCubic): Promise<void> {
  return new Promise((resolve) => {
    if (dur <= 0) {
      fn(1);
      resolve();
      return;
    }
    active.push({ t: 0, dur, fn, ease: e, resolve });
  });
}

export function wait(sec: number): Promise<void> {
  return tween(sec, () => {}, ease.linear);
}

export function updateTweens(dt: number) {
  for (let i = active.length - 1; i >= 0; i--) {
    const tw = active[i];
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.dur);
    tw.fn(tw.ease(k));
    if (k >= 1) {
      active.splice(i, 1);
      tw.resolve();
    }
  }
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
