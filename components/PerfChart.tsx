"use client";
/**
 * Chart de rendimiento en %: varias series, línea de 0%, marcador de entrada y
 * crosshair con tooltip (ratón y dedo). SVG propio, sin librería.
 * Escala 1:1: el viewBox usa el ancho REAL del contenedor — el texto no se
 * encoge en móvil y la altura declarada es la altura real.
 */
import { useMemo, useState } from "react";
import { useChartSize, niceTicks, decimate, nearestIdx, fmtDateTick, fmtDateFull } from "@/lib/chart";

export type Series = { label: string; color: string; points: { x: number; y: number }[] };

const fmtPctTick = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(Math.abs(v) % 1 === 0 ? 0 : 1)}%`;

export default function PerfChart({
  series, height = 210, markerX, markerLabel,
}: {
  series: Series[];
  height?: number;
  markerX?: number | null;
  markerLabel?: string;
}) {
  const { ref, w } = useChartSize();
  const [hover, setHover] = useState<number | null>(null); // x en ms
  const H = height, L = 46, R = 8, T = 10, B = 22;
  const W = Math.max(280, w);

  const plotted = useMemo(
    () => series.map((s) => ({ ...s, points: decimate(s.points, Math.max(50, W - L - R)) })),
    [series, W],
  );
  const all = plotted.flatMap((s) => s.points);
  if (all.length < 2)
    return <div className="muted" style={{ fontSize: 13 }}>Aún no hay suficientes datos</div>;

  const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
  let ymin = Math.min(...ys, 0), ymax = Math.max(...ys, 0);
  if (ymax === ymin) { ymax += 1; ymin -= 1; }
  const pad = (ymax - ymin) * 0.06; ymin -= pad; ymax += pad;
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  if (xmax === xmin)
    return <div className="muted" style={{ fontSize: 13 }}>Aún no hay suficientes datos</div>;
  const X = (x: number) => L + ((x - xmin) / (xmax - xmin)) * (W - L - R);
  const Y = (y: number) => T + (1 - (y - ymin) / (ymax - ymin)) * (H - T - B);
  const path = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  const yTicks = niceTicks(ymin, ymax, 4);
  const nx = W < 380 ? 3 : W < 500 ? 4 : 5;
  const xTicks = Array.from({ length: nx }, (_, i) => xmin + ((xmax - xmin) * i) / (nx - 1));

  // valores bajo el cursor (punto más cercano por serie)
  const hovered = hover == null ? null : plotted
    .filter((s) => s.points.length > 1)
    .map((s) => ({ ...s, p: s.points[nearestIdx(s.points, hover)] }));

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < L || px > W - R) { setHover(null); return; }
    setHover(xmin + ((px - L) / (W - L - R)) * (xmax - xmin));
  };

  const resumen = `Rendimiento: ${plotted.map((s) =>
    `${s.label} ${fmtPctTick(s.points[s.points.length - 1]?.y ?? 0)}`).join(", ")}`;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block", touchAction: "pan-y" }}
        role="img" aria-label={resumen}
        onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="var(--grid)" strokeWidth="1" />
            <text x={L - 6} y={Y(v) + 3.5} textAnchor="end" fill="var(--muted)" fontSize="11">{fmtPctTick(v)}</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={X(t)} y={H - 6}
            textAnchor={i === 0 ? "start" : i === nx - 1 ? "end" : "middle"}
            fill="var(--muted)" fontSize="11">{fmtDateTick(t)}</text>
        ))}
        <line x1={L} x2={W - R} y1={Y(0)} y2={Y(0)}
          stroke="var(--muted)" strokeDasharray="4 4" strokeWidth="1" opacity=".7" />
        {markerX != null && markerX >= xmin && markerX <= xmax && (
          <g>
            <line x1={X(markerX)} x2={X(markerX)} y1={T} y2={H - B}
              stroke="var(--accent)" strokeDasharray="3 3" strokeWidth="1.2" />
            {markerLabel && (
              <text x={Math.min(X(markerX) + 4, W - 70)} y={T + 10} fill="var(--accent)" fontSize="11">{markerLabel}</text>
            )}
          </g>
        )}
        {plotted.map((s) => (
          <path key={s.label} d={path(s.points)} fill="none" stroke={s.color} strokeWidth="2" />
        ))}
        {hovered && hovered.length > 0 && (
          <g>
            <line x1={X(hovered[0].p.x)} x2={X(hovered[0].p.x)} y1={T} y2={H - B}
              stroke="var(--muted)" strokeWidth="1" opacity=".8" />
            {hovered.map((s) => (
              <circle key={s.label} cx={X(s.p.x)} cy={Y(s.p.y)} r="4" fill={s.color} stroke="var(--bg)" strokeWidth="1.5" />
            ))}
          </g>
        )}
      </svg>
      {hovered && hovered.length > 0 && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, display: "flex", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <div style={{
            background: "var(--panel)", border: "1px solid var(--accent)", borderRadius: 8,
            padding: "4px 10px", fontSize: 12, display: "flex", gap: 12, flexWrap: "wrap",
            fontVariantNumeric: "tabular-nums",
          }}>
            <span className="muted">{fmtDateFull(hovered[0].p.x)}</span>
            {hovered.map((s) => (
              <span key={s.label} style={{ color: s.color }}>{fmtPctTick(s.p.y)}</span>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8, fontSize: 12 }}>
        {series.map((s) => (
          <span key={s.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 3, background: s.color, display: "inline-block", borderRadius: 2 }} />
            <span className="muted">{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
