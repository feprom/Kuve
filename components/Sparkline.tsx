"use client";
/**
 * Sparkline mínima sin ejes. Mide el contenedor (escala 1:1): sin
 * preserveAspectRatio="none", que deformaba el trazo anisotrópicamente.
 * Marca el último valor con un punto para que la dirección se lea de un vistazo.
 */
import { useId } from "react";
import { useChartSize } from "@/lib/chart";

export default function Sparkline({
  points, color = "var(--accent)", height = 44,
}: {
  points: { x: number; y: number }[];
  color?: string;
  height?: number;
}) {
  const { ref, w } = useChartSize(240);
  const gid = useId().replace(/[^a-zA-Z0-9]/g, "");
  if (points.length < 2)
    return <div className="muted" style={{ fontSize: 11, height }}>Sin historial suficiente</div>;
  const W = Math.max(120, w), H = height;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  let ymin = Math.min(...ys), ymax = Math.max(...ys);
  if (ymax === ymin) { ymax += 1; ymin -= 1; }
  const pad = (ymax - ymin) * 0.1; ymin -= pad; ymax += pad;
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  if (xmax === xmin) return <div style={{ height }} />;
  const X = (x: number) => 2 + ((x - xmin) / (xmax - xmin)) * (W - 8);
  const Y = (y: number) => H - 2 - ((y - ymin) / (ymax - ymin)) * (H - 4);
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  const area = `${d} L${X(xmax).toFixed(1)},${H} L${X(xmin).toFixed(1)},${H} Z`;
  const last = points[points.length - 1];
  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block" }} aria-hidden>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`} stroke="none" />
        <path d={d} fill="none" stroke={color} strokeWidth="1.75" />
        <circle cx={X(last.x)} cy={Y(last.y)} r="2.5" fill={color} />
      </svg>
    </div>
  );
}
