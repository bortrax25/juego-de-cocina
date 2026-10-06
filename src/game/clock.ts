/** Minutos desde medianoche -> "7:10 am" (formato de los subtítulos del video). */
export function fmtTime(min: number) {
  const m = Math.floor(min);
  let hh = Math.floor(m / 60) % 24;
  const mm = m % 60;
  const ap = hh >= 12 ? 'pm' : 'am';
  hh = hh % 12 || 12;
  return `${hh}:${mm.toString().padStart(2, '0')} ${ap}`;
}

export const hm = (h: number, m = 0) => h * 60 + m;
