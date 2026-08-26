"use client";
/**
 * Infraestructura compartida de los charts SVG propios (sin librería).
 *
 * El problema que resuelve: los charts se escribían en un viewBox fijo de 560px
 * y se escalaban como imagen — en un móvil de 360px el texto de 10px quedaba en
 * ~5,2px (ilegible) y la altura declarada se aplastaba a la mitad. La solución
 * es medir el contenedor y usar ESE ancho como sistema de coordenadas (escala
 * 1:1): 11px son 11px reales en cualquier pantalla.
 */
import { useEffect, useRef, useState } from "react";

/** Ancho real del contenedor en px CSS, con ResizeObserver. 320 hasta medir. */
export function useChartSize(defaultW = 320): { ref: React.RefObject<HTMLDivElement>; w: number } {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(defaultW);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width;
      if (width && Math.abs(width - w) > 1) setW(width);
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { ref, w };
}

/** Ticks "bonitos" (algoritmo 1-2-5) que cubren [min, max], incluyendo el 0 si
 *  el dominio lo cruza. Devuelve valores ordenados. */
export function niceTicks(min: number, max: number, n = 4): number[] {
  if (!isFinite(min) || !isFinite(max)) return [];
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / Math.max(1, n - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const lo = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= max + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  if (min < 0 && max > 0 && !out.some((v) => v === 0)) out.push(0);
  return out.sort((a, b) => a - b);
}

/**
 * Decimación min/max por columna de píxel: preserva picos y valles (lo que
 * importa en una curva de equity o drawdown) y reduce 6000 puntos a ~2 por px.
 */
export function decimate(points: { x: number; y: number }[], targetPx: number): { x: number; y: number }[] {
  if (points.length <= targetPx * 2 || targetPx < 4) return points;
  const xmin = points[0].x, xmax = points[points.length - 1].x;
  if (xmax === xmin) return points;
  const cols = new Map<number, { min: typeof points[0]; max: typeof points[0] }>();
  for (const p of points) {
    const c = Math.floor(((p.x - xmin) / (xmax - xmin)) * (targetPx - 1));
    const e = cols.get(c);
    if (!e) cols.set(c, { min: p, max: p });
    else {
      if (p.y < e.min.y) e.min = p;
      if (p.y > e.max.y) e.max = p;
    }
  }
  const out: { x: number; y: number }[] = [];
  for (const [, e] of Array.from(cols.entries()).sort((a, b) => a[0] - b[0])) {
    if (e.min === e.max) out.push(e.min);
    else out.push(...(e.min.x <= e.max.x ? [e.min, e.max] : [e.max, e.min]));
  }
  return out;
}

/** Índice del punto con x más cercano (búsqueda binaria; pts ordenados por x). */
export function nearestIdx(pts: { x: number }[], x: number): number {
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].x < x) lo = mid; else hi = mid;
  }
  return x - pts[lo].x <= pts[hi].x - x ? lo : hi;
}

export const fmtDateTick = (t: number) =>
  new Date(t).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });

export const fmtDateFull = (t: number) =>
  new Date(t).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
