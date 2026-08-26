"use client";
/**
 * Line chart SVG propio con eje de fechas y eje numérico, área degradada,
 * crosshair táctil y escala 1:1 (mide el contenedor — el texto no se encoge
 * en móvil).
 */
import { useId, useMemo, useState } from "react";
import { useChartSize, niceTicks, decimate, nearestIdx, fmtDateTick, fmtDateFull } from "@/lib/chart";

const fmtTick = (v: number) =>
  Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : v.toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function LineChart({
  points, height = 200, color = "var(--accent)", baseline, suffix = "",
}: {
  points: { x: number; y: number }[];   // x = epoch ms
  height?: number;
  color?: string;
  baseline?: number;
  suffix?: string;                       // e.g. "%" for drawdown
}) {
  const { ref, w } = useChartSize();
  const gid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const H = height, L = 46, R = 8, T = 8, B = 22;
  const W = Math.max(280, w);
  const pts = useMemo(() => decimate(points, Math.max(50, W - L - R)), [points, W]);
  if (pts.length < 2)
    return <div className="muted" style={{ fontSize: 13 }}>Aún no hay suficientes datos</div>;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  let ymin = Math.min(...ys), ymax = Math.max(...ys);
  if (baseline != null) { ymin = Math.min(ymin, baseline); ymax = Math.max(ymax, baseline); }
  if (ymax === ymin) { ymax += 1; ymin -= 1; }
  const pad = (ymax - ymin) * 0.05; ymin -= pad; ymax += pad;
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  if (xmax === xmin)
    return <div className="muted" style={{ fontSize: 13 }}>Aún no hay suficientes datos</div>;
  const X = (x: number) => L + ((x - xmin) / (xmax - xmin)) * (W - L - R);
  const Y = (y: number) => T + (1 - (y - ymin) / (ymax - ymin)) * (H - T - B);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  const area = `${d} L${X(xmax).toFixed(1)},${H - B} L${X(xmin).toFixed(1)},${H - B} Z`;
  const yTicks = niceTicks(ymin, ymax, 4);
  const nx = Math.min(W < 380 ? 3 : 4, pts.length);
  const xTicks = Array.from({ length: nx }, (_, i) => xmin + ((xmax - xmin) * i) / (nx - 1));

  const hp = hover == null ? null : pts[nearestIdx(pts, hover)];
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < L || px > W - R) { setHover(null); return; }
    setHover(xmin + ((px - L) / (W - L - R)) * (xmax - xmin));
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block", touchAction: "pan-y" }}
        role="img" aria-label={`Serie: último valor ${fmtTick(pts[pts.length - 1].y)}${suffix}`}
        onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="var(--grid)" strokeWidth="1" />
            <text x={L - 6} y={Y(v) + 3.5} textAnchor="end" fill="var(--muted)" fontSize="11">
              {fmtTick(v)}{suffix}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={X(t)} y={H - 6}
            textAnchor={i === 0 ? "start" : i === nx - 1 ? "end" : "middle"}
            fill="var(--muted)" fontSize="11">
            {fmtDateTick(t)}
          </text>
        ))}
        {baseline != null && (
          <line x1={L} x2={W - R} y1={Y(baseline)} y2={Y(baseline)}
            stroke="var(--muted)" strokeDasharray="4 4" strokeWidth="1" opacity=".7" />
        )}
        <path d={area} fill={`url(#${gid})`} />
        <path d={d} fill="none" stroke={color} strokeWidth="2" />
        {hp && (
          <g>
            <line x1={X(hp.x)} x2={X(hp.x)} y1={T} y2={H - B} stroke="var(--muted)" strokeWidth="1" opacity=".8" />
            <circle cx={X(hp.x)} cy={Y(hp.y)} r="4" fill={color} stroke="var(--bg)" strokeWidth="1.5" />
          </g>
        )}
      </svg>
      {hp && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
          <div style={{
            background: "var(--panel)", border: "1px solid var(--accent)", borderRadius: 8,
            padding: "4px 10px", fontSize: 12, fontVariantNumeric: "tabular-nums", display: "flex", gap: 10,
          }}>
            <span className="muted">{fmtDateFull(hp.x)}</span>
            <span style={{ color }}>{fmtTick(hp.y)}{suffix}</span>
          </div>
        </div>
      )}
    </div>
  );
}
